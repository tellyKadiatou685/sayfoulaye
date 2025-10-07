// src/controllers/AccountLineController.js
import prisma from '../config/database.js';

class AccountLineController {
  
  // Supprimer une ligne de compte (début ou sortie)
  async deleteAccountLine(req, res) {
    try {
      const { supervisorId, lineType } = req.params; // lineType: 'debut' ou 'sortie'
      const { accountKey } = req.body; // Ex: 'LIQUIDE', 'ORANGE_MONEY', 'part-nomPartenaire'
      const userId = req.user.id;

      console.log('🗑️ [CONTROLLER] deleteAccountLine:', {
        supervisorId,
        lineType,
        accountKey,
        userId,
        userRole: req.user.role
      });

      // Validation des données
      if (!accountKey) {
        return res.status(400).json({
          success: false,
          message: 'Clé de compte requise'
        });
      }

      if (!['debut', 'sortie'].includes(lineType)) {
        return res.status(400).json({
          success: false,
          message: 'Type de ligne invalide (debut/sortie requis)'
        });
      }

      // Vérification des permissions
      const permissionCheck = await this.checkDeletePermissions(req.user, supervisorId, accountKey);
      if (!permissionCheck.allowed) {
        return res.status(403).json({
          success: false,
          message: permissionCheck.reason
        });
      }

      // Exécuter la suppression
      const result = await this.executeAccountLineDeletion(
        supervisorId,
        lineType,
        accountKey,
        userId
      );

      res.json({
        success: true,
        message: `Ligne ${accountKey} (${lineType}) supprimée avec succès`,
        data: result
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur deleteAccountLine:', error);
      
      if (error.message.includes('non trouvé')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      if (error.message.includes('déjà à zéro')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la suppression de la ligne'
      });
    }
  }

  // Vérifier les permissions de suppression
  async checkDeletePermissions(user, supervisorId, accountKey) {
    try {
      // Admin peut tout supprimer
      if (user.role === 'ADMIN') {
        return { allowed: true };
      }

      // Superviseur peut supprimer ses propres lignes seulement
      if (user.role === 'SUPERVISEUR') {
        if (user.id !== supervisorId) {
          return { 
            allowed: false, 
            reason: 'Vous ne pouvez supprimer que vos propres comptes' 
          };
        }

        // Ne peut pas supprimer UV_MASTER
        if (accountKey === 'UV_MASTER') {
          return { 
            allowed: false, 
            reason: 'Impossible de supprimer le compte UV_MASTER' 
          };
        }

        // Vérifier si la ligne a des transactions récentes (< 24h)
        const hasRecentTransactions = await this.checkRecentTransactions(supervisorId, accountKey);
        if (hasRecentTransactions) {
          return { 
            allowed: false, 
            reason: 'Impossible de supprimer un compte avec des transactions récentes (< 24h)' 
          };
        }

        return { allowed: true };
      }

      return { 
        allowed: false, 
        reason: 'Permissions insuffisantes' 
      };

    } catch (error) {
      console.error('Erreur checkDeletePermissions:', error);
      return { 
        allowed: false, 
        reason: 'Erreur lors de la vérification des permissions' 
      };
    }
  }

  // Vérifier s'il y a des transactions récentes
  async checkRecentTransactions(supervisorId, accountKey) {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      let transactionCount = 0;

      if (accountKey.startsWith('part-')) {
        // Pour les partenaires, vérifier les transactions DEPOT/RETRAIT
        const partnerName = accountKey.replace('part-', '');
        const partner = await prisma.user.findFirst({
          where: { nomComplet: partnerName, role: 'PARTENAIRE' }
        });

        if (partner) {
          transactionCount = await prisma.transaction.count({
            where: {
              partenaireId: partner.id,
              destinataireId: supervisorId,
              createdAt: { gte: yesterday },
              type: { in: ['DEPOT', 'RETRAIT'] }
            }
          });
        }
      } else {
        // Pour les comptes standards
        const account = await prisma.account.findFirst({
          where: {
            userId: supervisorId,
            type: accountKey
          }
        });

        if (account) {
          transactionCount = await prisma.transaction.count({
            where: {
              compteDestinationId: account.id,
              createdAt: { gte: yesterday }
            }
          });
        }
      }

      return transactionCount > 0;

    } catch (error) {
      console.error('Erreur checkRecentTransactions:', error);
      return true; // Par sécurité, bloquer la suppression en cas d'erreur
    }
  }

  // Exécuter la suppression de ligne de compte
  async executeAccountLineDeletion(supervisorId, lineType, accountKey, deletedBy) {
    try {
      console.log('🗑️ [CONTROLLER] executeAccountLineDeletion:', {
        supervisorId,
        lineType,
        accountKey,
        deletedBy
      });

      // Vérifier que le superviseur existe
      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId, role: 'SUPERVISEUR' }
      });

      if (!supervisor) {
        throw new Error('Superviseur non trouvé');
      }

      let result = {};
      let oldValue = 0;

      if (accountKey.startsWith('part-')) {
        // Suppression d'une ligne partenaire
        result = await this.deletePartnerAccountLine(supervisorId, lineType, accountKey, deletedBy);
      } else {
        // Suppression d'un compte standard
        const account = await prisma.account.findFirst({
          where: {
            userId: supervisorId,
            type: accountKey
          }
        });

        if (!account) {
          throw new Error(`Compte ${accountKey} non trouvé`);
        }

        // Sauvegarder l'ancienne valeur
        oldValue = lineType === 'debut' 
          ? Number(account.initialBalance) / 100 
          : Number(account.balance) / 100;

        if (oldValue === 0) {
          throw new Error('Cette ligne est déjà à zéro, rien à supprimer');
        }

        // Mettre à jour le compte
        const updateData = {};
        if (lineType === 'debut') {
          updateData.initialBalance = 0;
        } else {
          updateData.balance = 0;
        }

        await prisma.account.update({
          where: { id: account.id },
          data: updateData
        });

        // Créer une transaction d'audit
        await prisma.transaction.create({
          data: {
            montant: Math.round(oldValue * 100),
            type: 'AUDIT_SUPPRESSION',
            description: `Suppression ligne ${accountKey} (${lineType}) - Valeur supprimée: ${oldValue} F`,
            envoyeurId: deletedBy,
            destinataireId: supervisorId,
            compteDestinationId: account.id,
            metadata: JSON.stringify({
              action: 'DELETE_ACCOUNT_LINE',
              lineType,
              accountKey,
              oldValue,
              deletedBy,
              deletedAt: new Date().toISOString(),
              reason: 'Suppression manuelle depuis le dashboard'
            })
          }
        });

        result = {
          accountId: account.id,
          accountKey,
          lineType,
          oldValue,
          newValue: 0
        };
      }

      console.log('✅ [CONTROLLER] Ligne supprimée avec succès:', result);

      return {
        ...result,
        supervisor: supervisor.nomComplet,
        deletedAt: new Date(),
        auditCreated: true
      };

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur executeAccountLineDeletion:', error);
      throw error;
    }
  }

  // Suppression d'une ligne partenaire
  async deletePartnerAccountLine(supervisorId, lineType, accountKey, deletedBy) {
    try {
      const partnerName = accountKey.replace('part-', '');
      
      // Trouver le partenaire
      const partner = await prisma.user.findFirst({
        where: { nomComplet: partnerName, role: 'PARTENAIRE' }
      });

      if (!partner) {
        throw new Error(`Partenaire ${partnerName} non trouvé`);
      }

      // Calculer la valeur à supprimer
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const transactionType = lineType === 'debut' ? 'DEPOT' : 'RETRAIT';
      
      const transactions = await prisma.transaction.findMany({
        where: {
          partenaireId: partner.id,
          destinataireId: supervisorId,
          type: transactionType,
          createdAt: { gte: yesterday }
        }
      });

      if (transactions.length === 0) {
        throw new Error(`Aucune transaction ${transactionType} récente trouvée pour ${partnerName}`);
      }

      const totalValue = transactions.reduce((sum, tx) => sum + Number(tx.montant), 0) / 100;

      // Supprimer les transactions (ou les marquer comme supprimées)
      for (const transaction of transactions) {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            description: `[SUPPRIMÉ] ${transaction.description}`,
            metadata: JSON.stringify({
              deleted: true,
              deletedBy,
              deletedAt: new Date().toISOString(),
              originalDescription: transaction.description
            })
          }
        });
      }

      // Créer une transaction d'audit
      await prisma.transaction.create({
        data: {
          montant: Math.round(totalValue * 100),
          type: 'AUDIT_SUPPRESSION',
          description: `Suppression transactions partenaire ${partnerName} (${lineType}) - ${transactions.length} transaction(s)`,
          envoyeurId: deletedBy,
          destinataireId: supervisorId,
          partenaireId: partner.id,
          metadata: JSON.stringify({
            action: 'DELETE_PARTNER_TRANSACTIONS',
            lineType,
            partnerName,
            transactionCount: transactions.length,
            totalValue,
            transactionIds: transactions.map(t => t.id),
            deletedBy,
            deletedAt: new Date().toISOString()
          })
        }
      });

      return {
        partnerName,
        lineType,
        transactionsDeleted: transactions.length,
        oldValue: totalValue,
        newValue: 0
      };

    } catch (error) {
      console.error('❌ Erreur deletePartnerAccountLine:', error);
      throw error;
    }
  }

  // Réinitialiser une ligne de compte (remettre à zéro)
  async resetAccountLine(req, res) {
    try {
      const { supervisorId, lineType } = req.params;
      const { accountKey, newValue = 0 } = req.body;
      const userId = req.user.id;

      console.log('🔄 [CONTROLLER] resetAccountLine:', {
        supervisorId,
        lineType,
        accountKey,
        newValue,
        userId
      });

      // Vérifications de base
      if (!accountKey) {
        return res.status(400).json({
          success: false,
          message: 'Clé de compte requise'
        });
      }

      if (newValue < 0) {
        return res.status(400).json({
          success: false,
          message: 'La nouvelle valeur ne peut pas être négative'
        });
      }

      // Permissions (admin seulement pour reset)
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Seuls les administrateurs peuvent réinitialiser les comptes'
        });
      }

      // Trouver et mettre à jour le compte
      const account = await prisma.account.findFirst({
        where: {
          userId: supervisorId,
          type: accountKey
        }
      });

      if (!account) {
        return res.status(404).json({
          success: false,
          message: `Compte ${accountKey} non trouvé`
        });
      }

      const oldValue = lineType === 'debut' 
        ? Number(account.initialBalance) / 100 
        : Number(account.balance) / 100;

      const newValueCentimes = Math.round(newValue * 100);

      const updateData = {};
      if (lineType === 'debut') {
        updateData.initialBalance = newValueCentimes;
      } else {
        updateData.balance = newValueCentimes;
      }

      await prisma.account.update({
        where: { id: account.id },
        data: updateData
      });

      // Audit de la réinitialisation
      await prisma.transaction.create({
        data: {
          montant: newValueCentimes,
          type: 'AUDIT_MODIFICATION',
          description: `Réinitialisation ${accountKey} (${lineType}) - ${oldValue} F → ${newValue} F`,
          envoyeurId: userId,
          destinataireId: supervisorId,
          compteDestinationId: account.id,
          metadata: JSON.stringify({
            action: 'RESET_ACCOUNT_LINE',
            lineType,
            accountKey,
            oldValue,
            newValue,
            resetBy: userId,
            resetAt: new Date().toISOString()
          })
        }
      });

      res.json({
        success: true,
        message: `Compte ${accountKey} (${lineType}) réinitialisé`,
        data: {
          accountKey,
          lineType,
          oldValue,
          newValue,
          resetAt: new Date()
        }
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur resetAccountLine:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la réinitialisation'
      });
    }
  }

  // Obtenir l'historique des suppressions
  async getAccountDeletionHistory(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const { page = 1, limit = 20, supervisorId } = req.query;

      const whereClause = {
        type: 'AUDIT_SUPPRESSION'
      };

      if (supervisorId) {
        whereClause.destinataireId = supervisorId;
      }

      const [auditRecords, totalCount] = await Promise.all([
        prisma.transaction.findMany({
          where: whereClause,
          include: {
            envoyeur: { select: { nomComplet: true } },
            destinataire: { select: { nomComplet: true } },
            partenaire: { select: { nomComplet: true } }
          },
          orderBy: { createdAt: 'desc' },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit)
        }),
        prisma.transaction.count({ where: whereClause })
      ]);

      const formattedHistory = auditRecords.map(record => ({
        id: record.id,
        description: record.description,
        createdAt: record.createdAt,
        deletedBy: record.envoyeur.nomComplet,
        superviseur: record.destinataire.nomComplet,
        partenaire: record.partenaire?.nomComplet || null,
        montant: Number(record.montant) / 100,
        metadata: record.metadata ? JSON.parse(record.metadata) : null
      }));

      res.json({
        success: true,
        message: `${auditRecords.length} enregistrement(s) trouvé(s)`,
        data: {
          history: formattedHistory,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalCount,
            limit: parseInt(limit)
          }
        }
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur getAccountDeletionHistory:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de l\'historique'
      });
    }
  }
}

export default new AccountLineController();