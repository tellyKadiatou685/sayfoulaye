// src/controllers/AccountLineController.js - VERSION COMPLÈTE CORRIGÉE
import prisma from '../config/database.js';
import NotificationService from '../services/NotificationService.js';

class AccountLineController {
  
  deleteAccountLine = async (req, res) => {
    try {
      const { supervisorId, lineType } = req.params;
      const { accountKey } = req.body;
      const userId = req.user.id;

      console.log('🗑️ [CONTROLLER] deleteAccountLine:', {
        supervisorId,
        lineType,
        accountKey,
        userId,
        userRole: req.user.role
      });

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

      const permissionCheck = await this.checkDeletePermissions(req.user, supervisorId, accountKey);
      if (!permissionCheck.allowed) {
        return res.status(403).json({
          success: false,
          message: permissionCheck.reason
        });
      }

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

  checkDeletePermissions = async (user, supervisorId, accountKey) => {
    try {
      console.log('🔍 [PERMISSIONS] Vérification delete permissions:', {
        userId: user.id,
        userRole: user.role,
        supervisorId,
        accountKey
      });

      if (user.role === 'ADMIN') {
        return { allowed: true, reason: 'Administrateur - accès complet' };
      }

      if (user.role !== 'SUPERVISEUR') {
        return { allowed: false, reason: 'Permissions insuffisantes' };
      }

      if (user.id !== supervisorId) {
        return { allowed: false, reason: 'Vous ne pouvez supprimer que vos propres comptes' };
      }

      if (accountKey === 'UV_MASTER') {
        return { allowed: false, reason: 'Impossible de supprimer le compte UV_MASTER' };
      }

      const timeCheck = await this.checkRecentTransactions(supervisorId, accountKey);
      if (timeCheck && timeCheck.blocked) {
        return { 
          allowed: false, 
          reason: timeCheck.reason 
        };
      }

      if (accountKey.startsWith('part-')) {
        const hasOwnDebutTransactions = await this.checkSupervisorOwnTransactions(supervisorId, accountKey, 'debut');
        const hasOwnSortieTransactions = await this.checkSupervisorOwnTransactions(supervisorId, accountKey, 'sortie');
        
        if (!hasOwnDebutTransactions && !hasOwnSortieTransactions) {
          return { 
            allowed: false, 
            reason: 'Vous ne pouvez supprimer que les transactions que vous avez créées' 
          };
        }
      } else {
        const hasOwnTransactions = await this.checkAccountOwnership(supervisorId, accountKey, 'any');
        
        if (!hasOwnTransactions) {
          return { 
            allowed: false, 
            reason: 'Vous ne pouvez supprimer que les comptes créés par vos propres transactions' 
          };
        }
      }

      return { allowed: true, reason: 'Superviseur - peut supprimer dans la fenêtre autorisée' };

    } catch (error) {
      console.error('❌ [PERMISSIONS] Erreur checkDeletePermissions:', error);
      return { allowed: false, reason: 'Erreur lors de la vérification des permissions' };
    }
  }

  checkRecentTransactions = async (supervisorId, accountKey) => {
    try {
      const now = new Date();

      console.log('🕐 [PERMISSIONS] Vérification fenêtre de suppression autorisée (1-30 min)');

      let lastTransaction = null;

      if (accountKey.startsWith('part-')) {
        const partnerName = accountKey.replace('part-', '');
        const partner = await prisma.user.findFirst({
          where: { nomComplet: partnerName, role: 'PARTENAIRE' }
        });

        if (partner) {
          const recentTransactions = await prisma.transaction.findMany({
            where: {
              partenaireId: partner.id,
              destinataireId: supervisorId,
              type: { in: ['DEPOT', 'RETRAIT'] },
              OR: [
                { archived: { equals: false } },
                { archived: { equals: null } }
              ]
            },
            select: { id: true, createdAt: true, type: true },
            orderBy: { createdAt: 'desc' },
            take: 1
          });

          if (recentTransactions.length > 0) {
            lastTransaction = recentTransactions[0];
          }
        }
      } else {
        const account = await prisma.account.findFirst({
          where: {
            userId: supervisorId,
            type: accountKey
          }
        });

        if (account) {
          const recentTransactions = await prisma.transaction.findMany({
            where: {
              compteDestinationId: account.id,
              type: { 
                in: ['DEPOT', 'RETRAIT', 'DEBUT_JOURNEE', 'FIN_JOURNEE'] 
              }
            },
            select: { id: true, createdAt: true, type: true },
            orderBy: { createdAt: 'desc' },
            take: 1
          });

          if (recentTransactions.length > 0) {
            lastTransaction = recentTransactions[0];
          }
        }
      }

      if (!lastTransaction) {
        console.log('✅ [PERMISSIONS] Aucune transaction trouvée - suppression autorisée');
        return false;
      }

      const transactionTime = new Date(lastTransaction.createdAt);
      const ageInMinutes = Math.floor((now.getTime() - transactionTime.getTime()) / (1000 * 60));

      console.log(`⏰ [PERMISSIONS] Dernière transaction il y a ${ageInMinutes} minute(s)`);
      
      if (ageInMinutes < 1) {
        console.log('❌ [PERMISSIONS] Blocage : transaction trop récente (< 1 min)');
        return {
          blocked: true,
          reason: 'Transaction créée il y a moins d\'1 minute. Attendez au moins 1 minute pour éviter les suppressions accidentelles.',
          ageInMinutes
        };
      }

      if (ageInMinutes > 30) {
        console.log('❌ [PERMISSIONS] Blocage : transaction trop ancienne (> 30 min)');
        return {
          blocked: true,
          reason: 'La dernière transaction date de plus de 30 minutes. Les suppressions ne sont autorisées que dans les 30 minutes suivant une transaction.',
          ageInMinutes
        };
      }

      console.log('✅ [PERMISSIONS] Fenêtre de correction autorisée (1-30 min)');
      return false;

    } catch (error) {
      console.error('❌ [PERMISSIONS] Erreur checkRecentTransactions:', error);
      return false;
    }
  }

  checkSupervisorOwnTransactions = async (supervisorId, accountKey, lineType) => {
    try {
      const partnerName = accountKey.replace('part-', '');
      const transactionType = lineType === 'debut' ? 'DEPOT' : 'RETRAIT';

      const partner = await prisma.user.findFirst({
        where: { 
          nomComplet: partnerName, 
          role: 'PARTENAIRE',
          status: 'ACTIVE'
        }
      });

      if (!partner) {
        console.log(`⚠️ [PERMISSIONS] Partenaire "${partnerName}" non trouvé`);
        return false;
      }

      const ownTransactions = await prisma.transaction.count({
        where: {
          partenaireId: partner.id,
          destinataireId: supervisorId,
          type: transactionType,
          envoyeurId: supervisorId,
          OR: [
            { archived: { equals: false } },
            { archived: { equals: null } }
          ]
        }
      });

      console.log(`🔍 [PERMISSIONS] Transactions ${transactionType} créées par superviseur ${supervisorId} pour ${partnerName}: ${ownTransactions}`);
      
      return ownTransactions > 0;

    } catch (error) {
      console.error('❌ [PERMISSIONS] Erreur checkSupervisorOwnTransactions:', error);
      return false;
    }
  }

  checkAccountOwnership = async (supervisorId, accountKey, lineType) => {
    try {
      const account = await prisma.account.findFirst({
        where: {
          userId: supervisorId,
          type: accountKey
        }
      });

      if (!account) {
        console.log(`⚠️ [PERMISSIONS] Compte ${accountKey} non trouvé pour superviseur ${supervisorId}`);
        return false;
      }

      const ownTransactions = await prisma.transaction.count({
        where: {
          compteDestinationId: account.id,
          envoyeurId: supervisorId,
          type: { 
            in: ['DEPOT', 'RETRAIT', 'DEBUT_JOURNEE', 'FIN_JOURNEE'] 
          }
        }
      });

      console.log(`🔍 [PERMISSIONS] Transactions propres pour compte ${accountKey}: ${ownTransactions}`);

      if (ownTransactions === 0) {
        const allTransactions = await prisma.transaction.count({
          where: {
            compteDestinationId: account.id
          }
        });

        if (allTransactions === 0) {
          console.log(`ℹ️ [PERMISSIONS] Compte ${accountKey} sans transactions - autorisation`);
          return true;
        }

        const auditTransactions = await prisma.transaction.count({
          where: {
            compteDestinationId: account.id,
            type: { in: ['AUDIT_SUPPRESSION', 'AUDIT_MODIFICATION'] }
          }
        });

        if (auditTransactions === allTransactions) {
          console.log(`ℹ️ [PERMISSIONS] Compte ${accountKey} avec seulement des audits - autorisation`);
          return true;
        }

        console.log(`❌ [PERMISSIONS] Compte ${accountKey} a des transactions créées par d'autres`);
        return false;
      }

      return true;

    } catch (error) {
      console.error('❌ [PERMISSIONS] Erreur checkAccountOwnership:', error);
      return false;
    }
  }

  executeAccountLineDeletion = async (supervisorId, lineType, accountKey, deletedBy) => {
    try {
      console.log('🗑️ [CONTROLLER] executeAccountLineDeletion:', {
        supervisorId,
        lineType,
        accountKey,
        deletedBy
      });

      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId, role: 'SUPERVISEUR' }
      });

      if (!supervisor) {
        throw new Error('Superviseur non trouvé');
      }

      let result = {};

      if (accountKey.startsWith('part-')) {
        result = await this.deletePartnerAccountLine(supervisorId, lineType, accountKey, deletedBy);
      } else {
        const account = await prisma.account.findFirst({
          where: {
            userId: supervisorId,
            type: accountKey
          }
        });

        if (!account) {
          throw new Error(`Compte ${accountKey} non trouvé`);
        }

        const oldValue = lineType === 'debut' 
          ? Number(account.initialBalance) / 100 
          : Number(account.balance) / 100;

        if (oldValue === 0) {
          throw new Error('Cette ligne est déjà à zéro, rien à supprimer');
        }

        const updateData = {};
        if (lineType === 'debut') {
          updateData.initialBalance = 0n;
        } else {
          updateData.balance = 0n;
        }

        await prisma.account.update({
          where: { id: account.id },
          data: updateData
        });

        await prisma.transaction.create({
          data: {
            montant: BigInt(Math.round(oldValue * 100)),
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

        await NotificationService.createNotification({
          userId: supervisorId,
          title: 'Ligne de compte supprimée',
          message: `Votre ligne ${accountKey} (${lineType === 'debut' ? 'début' : 'sortie'}) de ${oldValue} F a été supprimée`,
          type: 'AUDIT_SUPPRESSION'
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

  deletePartnerAccountLine = async (supervisorId, lineType, accountKey, deletedBy) => {
    try {
      console.log('🗑️ [PARTNER DELETE] Début suppression:', { supervisorId, lineType, accountKey, deletedBy });

      const partnerName = accountKey.replace('part-', '');
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const transactionType = lineType === 'debut' ? 'DEPOT' : 'RETRAIT';

      const partnersWithSameName = await prisma.user.findMany({
        where: { 
          nomComplet: partnerName, 
          role: 'PARTENAIRE',
          status: 'ACTIVE'
        },
        select: { id: true, nomComplet: true, telephone: true }
      });

      console.log(`🔍 [PARTNER DELETE] ${partnersWithSameName.length} partenaire(s) trouvé(s) avec le nom "${partnerName}"`);

      if (partnersWithSameName.length === 0) {
        throw new Error(`Partenaire "${partnerName}" non trouvé`);
      }

      let targetPartner = null;
      let transactions = [];

      if (partnersWithSameName.length === 1) {
        targetPartner = partnersWithSameName[0];
      } else {
        console.log('⚠️ [PARTNER DELETE] Plusieurs partenaires avec le même nom, recherche du bon partenaire...');
        
        for (const partner of partnersWithSameName) {
          const partnerTransactions = await prisma.transaction.findMany({
            where: {
              partenaireId: partner.id,
              destinataireId: supervisorId,
              type: transactionType,
              createdAt: { gte: yesterday },
              OR: [
                { archived: { equals: false } },
                { archived: { equals: null } }
              ]
            }
          });

          if (partnerTransactions.length > 0) {
            targetPartner = partner;
            transactions = partnerTransactions;
            console.log(`✅ [PARTNER DELETE] Partenaire trouvé: ${partner.nomComplet} (${partner.telephone}) avec ${partnerTransactions.length} transaction(s)`);
            break;
          }
        }

        if (!targetPartner) {
          console.log('⚠️ [PARTNER DELETE] Aucun partenaire avec transactions récentes, prise du premier');
          targetPartner = partnersWithSameName[0];
        }
      }

      if (transactions.length === 0) {
        transactions = await prisma.transaction.findMany({
          where: {
            partenaireId: targetPartner.id,
            destinataireId: supervisorId,
            type: transactionType,
            createdAt: { gte: yesterday },
            OR: [
              { archived: { equals: false } },
              { archived: { equals: null } }
            ]
          },
          orderBy: { createdAt: 'desc' }
        });
      }

      console.log(`📊 [PARTNER DELETE] ${transactions.length} transaction(s) ${transactionType} trouvée(s) pour ${targetPartner.nomComplet}`);

      if (transactions.length === 0) {
        throw new Error(`Aucune transaction ${transactionType} récente trouvée pour ${partnerName}${partnersWithSameName.length > 1 ? ` (ID: ${targetPartner.id})` : ''}`);
      }

      const totalValue = transactions.reduce((sum, tx) => sum + Number(tx.montant), 0) / 100;
      
      console.log(`💰 [PARTNER DELETE] Valeur totale à supprimer: ${totalValue} F`);

      const updatePromises = transactions.map(transaction => 
        prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            description: `[SUPPRIMÉ] ${transaction.description}`,
            archived: true,
            archivedAt: new Date(),
            metadata: JSON.stringify({
              deleted: true,
              deletedBy,
              deletedAt: new Date().toISOString(),
              originalDescription: transaction.description,
              deletionReason: 'Suppression ligne partenaire depuis dashboard'
            })
          }
        })
      );

      await Promise.all(updatePromises);
      console.log(`✅ [PARTNER DELETE] ${transactions.length} transaction(s) marquées comme supprimées`);

      await prisma.transaction.create({
        data: {
          montant: BigInt(Math.round(totalValue * 100)),
          type: 'AUDIT_SUPPRESSION',
          description: `Suppression transactions partenaire ${partnerName} (${lineType}) - ${transactions.length} transaction(s) - ${totalValue} F`,
          envoyeurId: deletedBy,
          destinataireId: supervisorId,
          partenaireId: targetPartner.id,
          metadata: JSON.stringify({
            action: 'DELETE_PARTNER_TRANSACTIONS',
            lineType,
            partnerName: targetPartner.nomComplet,
            partnerId: targetPartner.id,
            partnerPhone: targetPartner.telephone,
            transactionCount: transactions.length,
            totalValue,
            transactionType,
            transactionIds: transactions.map(t => t.id),
            deletedBy,
            deletedAt: new Date().toISOString(),
            duplicateNamesFound: partnersWithSameName.length > 1
          })
        }
      });

      await NotificationService.createNotification({
        userId: supervisorId,
        title: 'Transactions partenaire supprimées',
        message: `${transactions.length} transaction(s) ${transactionType} de ${partnerName} (${totalValue} F) ont été supprimées`,
        type: 'AUDIT_SUPPRESSION'
      });

      const result = {
        partnerName: targetPartner.nomComplet,
        partnerId: targetPartner.id,
        partnerPhone: targetPartner.telephone,
        lineType,
        transactionType,
        transactionsDeleted: transactions.length,
        oldValue: totalValue,
        newValue: 0,
        duplicateNamesHandled: partnersWithSameName.length > 1
      };

      console.log('✅ [PARTNER DELETE] Suppression terminée avec succès:', result);
      return result;

    } catch (error) {
      console.error('❌ [PARTNER DELETE] Erreur deletePartnerAccountLine:', error);
      throw error;
    }
  }

  resetAccountLine = async (req, res) => {
    try {
      const { supervisorId, lineType } = req.params;
      const { accountKey, newValue = 0 } = req.body;
      const userId = req.user.id;

      console.log('🔄 [CONTROLLER] resetAccountLine:', {
        supervisorId,
        lineType,
        accountKey,
        newValue,
        userId,
        userRole: req.user.role
      });

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

      const resetPermission = await this.checkResetPermissions(req.user, supervisorId, accountKey, lineType);
      if (!resetPermission.allowed) {
        return res.status(403).json({
          success: false,
          message: resetPermission.reason
        });
      }

      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId, role: 'SUPERVISEUR' }
      });

      if (!supervisor) {
        return res.status(404).json({
          success: false,
          message: 'Superviseur non trouvé'
        });
      }

      const newValueCentimes = Math.round(newValue * 100);

      const account = await prisma.account.upsert({
        where: {
          userId_type: {
            userId: supervisorId,
            type: accountKey
          }
        },
        update: {},
        create: {
          type: accountKey,
          userId: supervisorId,
          balance: 0n,
          initialBalance: 0n,
          previousInitialBalance: 0n
        }
      });

      const oldValue = lineType === 'debut' 
        ? Number(account.initialBalance) / 100 
        : Number(account.balance) / 100;

      const updateData = {};
      if (lineType === 'debut') {
        updateData.initialBalance = BigInt(newValueCentimes);
      } else {
        updateData.balance = BigInt(newValueCentimes);
      }

      await prisma.account.update({
        where: { id: account.id },
        data: updateData
      });

      await prisma.transaction.create({
        data: {
          montant: BigInt(Math.abs(newValueCentimes)),
          type: 'AUDIT_MODIFICATION',
          description: `Réinitialisation ${accountKey} (${lineType}) par ${req.user.role} - ${oldValue} F → ${newValue} F`,
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
            resetByRole: req.user.role,
            resetAt: new Date().toISOString(),
            hasOwnTransactions: resetPermission.hasOwnTransactions,
            accountCreated: account.createdAt.getTime() === account.updatedAt.getTime()
          })
        }
      });

      await NotificationService.createNotification({
        userId: supervisorId,
        title: 'Compte réinitialisé',
        message: `Votre compte ${accountKey} (${lineType === 'debut' ? 'début' : 'sortie'}) a été réinitialisé de ${oldValue} F à ${newValue} F${req.user.role === 'ADMIN' ? ' par un administrateur' : ''}`,
        type: 'AUDIT_MODIFICATION'
      });

      res.json({
        success: true,
        message: `Compte ${accountKey} (${lineType}) réinitialisé`,
        data: {
          accountKey,
          lineType,
          oldValue,
          newValue,
          resetAt: new Date(),
          resetBy: req.user.role,
          hasOwnTransactions: resetPermission.hasOwnTransactions,
          supervisor: supervisor.nomComplet
        }
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur resetAccountLine:', error);
      
      if (error.code === 'P2002') {
        return res.status(400).json({
          success: false,
          message: 'Conflit lors de la création/mise à jour du compte'
        });
      }

      if (error.code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Enregistrement non trouvé'
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la réinitialisation'
      });
    }
  }

  checkResetPermissions = async (user, supervisorId, accountKey, lineType) => {
    try {
      console.log('🔍 [PERMISSIONS] Vérification reset permissions:', {
        userId: user.id,
        userRole: user.role,
        supervisorId,
        accountKey,
        lineType
      });

      if (user.role === 'ADMIN') {
        return { 
          allowed: true, 
          hasOwnTransactions: false,
          reason: 'Administrateur - accès complet' 
        };
      }

      if (user.role !== 'SUPERVISEUR') {
        return { 
          allowed: false, 
          hasOwnTransactions: false,
          reason: 'Permissions insuffisantes' 
        };
      }

      if (user.id !== supervisorId) {
        return { 
          allowed: false, 
          hasOwnTransactions: false,
          reason: 'Vous ne pouvez réinitialiser que vos propres comptes' 
        };
      }

      const timeCheck = await this.checkRecentTransactions(supervisorId, accountKey);
      if (timeCheck && timeCheck.blocked) {
        return { 
          allowed: false, 
          hasOwnTransactions: false,
          reason: timeCheck.reason 
        };
      }

      if (accountKey.startsWith('part-')) {
        const hasOwnTransactions = await this.checkSupervisorOwnTransactions(supervisorId, accountKey, lineType);
        
        if (!hasOwnTransactions) {
          return { 
            allowed: false, 
            hasOwnTransactions: false,
            reason: 'Vous ne pouvez modifier que les transactions que vous avez créées' 
          };
        }

        return { 
          allowed: true, 
          hasOwnTransactions: true,
          reason: 'Superviseur - peut modifier ses propres transactions partenaires' 
        };
      }

      const hasOwnTransactions = await this.checkAccountOwnership(supervisorId, accountKey, lineType);
      
      if (!hasOwnTransactions) {
        return { 
          allowed: false, 
          hasOwnTransactions: false,
          reason: 'Vous ne pouvez modifier que les comptes créés par vos propres transactions' 
        };
      }

      return { 
        allowed: true, 
        hasOwnTransactions: true,
        reason: 'Superviseur - peut modifier ses propres comptes' 
      };

    } catch (error) {
      console.error('❌ [PERMISSIONS] Erreur checkResetPermissions:', error);
      return { 
        allowed: false, 
        hasOwnTransactions: false,
        reason: 'Erreur lors de la vérification des permissions' 
      };
    }
  }
  getAccountDeletionHistory = async (req, res) => {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }
  
      const { page = 1, limit = 20, supervisorId } = req.query;
  
      const whereClause = {
        type: { in: ['AUDIT_SUPPRESSION', 'AUDIT_MODIFICATION'] }
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
        type: record.type,
        description: record.description,
        createdAt: record.createdAt,
        executedBy: record.envoyeur.nomComplet,
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
  } // <- Vérifiez que cette accolade est bien présente
}

export default new AccountLineController();