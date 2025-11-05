// src/controllers/AccountLineController.js - VERSION CORRIGÉE HISTORIQUE
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
        
        console.log(`🔍 [PERMISSIONS] Recherche dernière transaction pour partenaire "${partnerName}"`);
  
        // 🆕 Rechercher la dernière transaction (enregistrée OU nom libre)
        const recentTransactions = await prisma.transaction.findMany({
          where: {
            destinataireId: supervisorId,
            type: { in: ['DEPOT', 'RETRAIT'] },
            OR: [
              { archived: { equals: false } },
              { archived: { equals: null } }
            ],
            // 🆕 RECHERCHE COMBINÉE
            OR: [
              // Cas 1 : Partenaire enregistré
              {
                partenaire: {
                  nomComplet: partnerName,
                  role: 'PARTENAIRE',
                  status: 'ACTIVE'
                }
              },
              // Cas 2 : Partenaire nom libre
              {
                partenaireNom: partnerName
              }
            ]
          },
          select: { id: true, createdAt: true, type: true },
          orderBy: { createdAt: 'desc' },
          take: 1
        });
  
        if (recentTransactions.length > 0) {
          lastTransaction = recentTransactions[0];
        }
      } else {
        // Logique existante pour comptes standards
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
  
      console.log(`🔍 [PERMISSIONS] Vérification ownership pour "${partnerName}" (type: ${transactionType})`);
  
      // 🆕 Compter TOUTES les transactions (enregistrées OU noms libres)
      const ownTransactions = await prisma.transaction.count({
        where: {
          destinataireId: supervisorId,
          type: transactionType,
          envoyeurId: supervisorId,
          OR: [
            { archived: { equals: false } },
            { archived: { equals: null } }
          ],
          // 🆕 RECHERCHE COMBINÉE
          OR: [
            // Cas 1 : Partenaire enregistré
            {
              partenaire: {
                nomComplet: partnerName,
                role: 'PARTENAIRE',
                status: 'ACTIVE'
              }
            },
            // Cas 2 : Partenaire nom libre
            {
              partenaireNom: partnerName
            }
          ]
        }
      });
  
      console.log(`🔍 [PERMISSIONS] ${ownTransactions} transaction(s) ${transactionType} trouvée(s) pour ${partnerName}`);
      
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
  
        // 🔒 CRITIQUE : Modifier UNIQUEMENT balance ou initialBalance
        // ⚠️ JAMAIS previousInitialBalance (données historiques protégées)
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
  
        console.log(`✅ [DELETION] Compte ${accountKey} (${lineType}) mis à 0 (TODAY uniquement)`);
        console.log(`🔒 [DELETION] previousInitialBalance PROTÉGÉ : ${Number(account.previousInitialBalance) / 100} F`);
  
        // Créer un audit de suppression
        await prisma.transaction.create({
          data: {
            montant: BigInt(Math.round(oldValue * 100)),
            type: 'AUDIT_SUPPRESSION',
            description: `Suppression ligne ${accountKey} (${lineType}) - Valeur supprimée: ${oldValue} F - Affecte UNIQUEMENT TODAY`,
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
              reason: 'Suppression manuelle depuis le dashboard',
              previousInitialBalancePreserved: Number(account.previousInitialBalance) / 100,
              scope: 'TODAY_ONLY',
              historicalDataUntouched: true
            })
          }
        });
  
        await NotificationService.createNotification({
          userId: supervisorId,
          title: 'Ligne de compte supprimée',
          message: `Votre ligne ${accountKey} (${lineType === 'debut' ? 'début' : 'sortie'}) de ${oldValue} F a été supprimée (affecte uniquement TODAY)`,
          type: 'AUDIT_SUPPRESSION'
        });
  
        result = {
          accountId: account.id,
          accountKey,
          lineType,
          oldValue,
          newValue: 0,
          historicalDataPreserved: true,
          previousInitialBalance: Number(account.previousInitialBalance) / 100,
          scope: 'TODAY_ONLY'
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
  
      console.log(`🔍 [PARTNER DELETE] Recherche partenaire "${partnerName}" (enregistré OU nom libre)`);
  
      // 🆕 ÉTAPE 1 : Rechercher les transactions avec ce nom de partenaire
      // Peut être soit un partenaire enregistré (partenaireId) soit un nom libre (partenaireNom)
      const transactions = await prisma.transaction.findMany({
        where: {
          destinataireId: supervisorId,
          type: transactionType,
          createdAt: { gte: yesterday },
          OR: [
            { archived: { equals: false } },
            { archived: { equals: null } }
          ],
          // 🆕 RECHERCHE COMBINÉE : partenaire enregistré OU nom libre
          OR: [
            // Cas 1 : Partenaire enregistré
            {
              partenaire: {
                nomComplet: partnerName,
                role: 'PARTENAIRE',
                status: 'ACTIVE'
              }
            },
            // Cas 2 : Partenaire nom libre
            {
              partenaireNom: partnerName
            }
          ]
        },
        select: {
          id: true,
          montant: true,
          type: true,
          description: true,
          createdAt: true,
          partenaireId: true,
          partenaireNom: true,
          partenaire: {
            select: { 
              id: true, 
              nomComplet: true, 
              telephone: true 
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
  
      console.log(`📊 [PARTNER DELETE] ${transactions.length} transaction(s) trouvée(s) pour ${partnerName}`);
  
      if (transactions.length === 0) {
        throw new Error(`Aucune transaction ${transactionType} récente trouvée pour ${partnerName}`);
      }
  
      // 🆕 Identifier le type de partenaire
      const firstTransaction = transactions[0];
      const isRegisteredPartner = !!firstTransaction.partenaireId;
      const partnerInfo = isRegisteredPartner 
        ? {
            id: firstTransaction.partenaire.id,
            nom: firstTransaction.partenaire.nomComplet,
            telephone: firstTransaction.partenaire.telephone,
            type: 'ENREGISTRÉ'
          }
        : {
            id: null,
            nom: firstTransaction.partenaireNom,
            telephone: null,
            type: 'NOM LIBRE'
          };
  
      console.log(`✅ [PARTNER DELETE] Type partenaire: ${partnerInfo.type}`, partnerInfo);
  
      const totalValue = transactions.reduce((sum, tx) => sum + Number(tx.montant), 0) / 100;
      
      console.log(`💰 [PARTNER DELETE] Valeur totale à supprimer: ${totalValue} F`);
  
      // 🆕 Archiver toutes les transactions trouvées
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
              deletionReason: 'Suppression ligne partenaire depuis dashboard',
              partnerType: partnerInfo.type,
              partnerName: partnerInfo.nom,
              scope: 'TODAY_ONLY',
              historicalDataUntouched: true
            })
          }
        })
      );
  
      await Promise.all(updatePromises);
      console.log(`✅ [PARTNER DELETE] ${transactions.length} transaction(s) archivées`);
  
      // 🆕 Créer l'audit avec les bonnes infos selon le type
      await prisma.transaction.create({
        data: {
          montant: BigInt(Math.round(totalValue * 100)),
          type: 'AUDIT_SUPPRESSION',
          description: `Suppression transactions partenaire ${partnerInfo.nom} (${lineType}) - ${transactions.length} transaction(s) - ${totalValue} F - Type: ${partnerInfo.type} - Affecte UNIQUEMENT TODAY`,
          envoyeurId: deletedBy,
          destinataireId: supervisorId,
          // 🆕 Ajouter partenaireId SEULEMENT si c'est un partenaire enregistré
          ...(isRegisteredPartner && { partenaireId: partnerInfo.id }),
          // 🆕 Ajouter partenaireNom pour les deux types (pour historique)
          partenaireNom: partnerInfo.nom,
          metadata: JSON.stringify({
            action: 'DELETE_PARTNER_TRANSACTIONS',
            lineType,
            partnerName: partnerInfo.nom,
            partnerId: partnerInfo.id,
            partnerPhone: partnerInfo.telephone,
            partnerType: partnerInfo.type,
            transactionCount: transactions.length,
            totalValue,
            transactionType,
            transactionIds: transactions.map(t => t.id),
            deletedBy,
            deletedAt: new Date().toISOString(),
            scope: 'TODAY_ONLY',
            historicalDataUntouched: true
          })
        }
      });
  
      await NotificationService.createNotification({
        userId: supervisorId,
        title: 'Transactions partenaire supprimées',
        message: `${transactions.length} transaction(s) ${transactionType} de ${partnerInfo.nom} (${totalValue} F) ont été supprimées (affecte uniquement TODAY)`,
        type: 'AUDIT_SUPPRESSION'
      });
  
      const result = {
        partnerName: partnerInfo.nom,
        partnerId: partnerInfo.id,
        partnerPhone: partnerInfo.telephone,
        partnerType: partnerInfo.type,
        isRegisteredPartner,
        lineType,
        transactionType,
        transactionsDeleted: transactions.length,
        oldValue: totalValue,
        newValue: 0,
        scope: 'TODAY_ONLY'
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
  
      // 🔒 CRITIQUE : Modifier UNIQUEMENT balance ou initialBalance
      // ⚠️ JAMAIS previousInitialBalance (données historiques protégées)
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
  
      console.log(`✅ [RESET] Compte ${accountKey} (${lineType}) modifié: ${oldValue} F → ${newValue} F (TODAY uniquement)`);
      console.log(`🔒 [RESET] previousInitialBalance PROTÉGÉ : ${Number(account.previousInitialBalance) / 100} F`);
  
      await prisma.transaction.create({
        data: {
          montant: BigInt(Math.abs(newValueCentimes)),
          type: 'AUDIT_MODIFICATION',
          description: `Réinitialisation ${accountKey} (${lineType}) par ${req.user.role} - ${oldValue} F → ${newValue} F - Affecte UNIQUEMENT TODAY`,
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
            accountCreated: account.createdAt.getTime() === account.updatedAt.getTime(),
            previousInitialBalancePreserved: Number(account.previousInitialBalance) / 100,
            scope: 'TODAY_ONLY',
            historicalDataUntouched: true
          })
        }
      });
  
      await NotificationService.createNotification({
        userId: supervisorId,
        title: 'Compte réinitialisé',
        message: `Votre compte ${accountKey} (${lineType === 'debut' ? 'début' : 'sortie'}) a été réinitialisé de ${oldValue} F à ${newValue} F${req.user.role === 'ADMIN' ? ' par un administrateur' : ''} (affecte uniquement TODAY)`,
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
          supervisor: supervisor.nomComplet,
          historicalDataPreserved: true,
          previousInitialBalance: Number(account.previousInitialBalance) / 100,
          scope: 'TODAY_ONLY'
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
  }
}

export default new AccountLineController();