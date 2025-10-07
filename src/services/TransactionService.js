// src/services/TransactionService.js - VERSION FINALE AVEC CRON AUTOMATIQUE VERCEL
import prisma from '../config/database.js';
import NotificationService from './NotificationService.js';

class TransactionService {
  // =====================================
  // CONFIGURATION CENTRALISÉE DU RESET
  // =====================================
 static RESET_CONFIG = {
  hour: 0,
  minute: 52,
  windowMinutes: 0
};

  // =====================================
  // SYSTÈME DE NOTIFICATIONS ET AUTO-REFRESH
  // =====================================
  async needsDashboardRefresh(lastCheckTime) {
    try {
      const resetConfig = this.getResetConfig();
      const now = new Date();
      const todayResetTime = new Date(now);
      todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
      
      if (now > todayResetTime && lastCheckTime < todayResetTime) {
        return {
          needsRefresh: true,
          resetExecutedAt: todayResetTime.toISOString(),
          reason: 'reset_occurred_since_last_check',
          currentTime: now.toISOString()
        };
      }
      
      let nextResetTime = new Date(todayResetTime);
      if (now > todayResetTime) {
        nextResetTime.setDate(nextResetTime.getDate() + 1);
      }
      
      return {
        needsRefresh: false,
        nextResetAt: nextResetTime.toISOString(),
        currentTime: now.toISOString(),
        minutesUntilReset: Math.ceil((nextResetTime - now) / (1000 * 60))
      };
      
    } catch (error) {
      console.error('❌ [REFRESH CHECK] Erreur:', error);
      return { needsRefresh: false, error: error.message };
    }
  }

  async notifyDashboardRefresh(resetDetails = {}) {
    try {
      console.log('📢 [NOTIFICATIONS] Envoi notifications de reset...');
      
      const now = new Date();
      const { archivedCount = 0, cleanedCount = 0 } = resetDetails;
      
      const [activeSupervisors, adminUsers, activePartners] = await Promise.all([
        prisma.user.findMany({
          where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
          select: { id: true, nomComplet: true }
        }),
        prisma.user.findMany({
          where: { role: 'ADMIN' },
          select: { id: true, nomComplet: true }
        }),
        prisma.user.findMany({
          where: { role: 'PARTENAIRE', status: 'ACTIVE' },
          select: { id: true, nomComplet: true }
        })
      ]);
      
      const notifications = [];
      
      activeSupervisors.forEach(supervisor => {
        notifications.push({
          userId: supervisor.id,
          title: 'Dashboard Actualisé',
          message: `Reset quotidien effectué à ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}. Vos soldes ont été transférés et les données mises à jour.`,
          type: 'RESET_SUPERVISOR'
        });
      });
      
      adminUsers.forEach(admin => {
        notifications.push({
          userId: admin.id,
          title: 'Reset Quotidien Terminé',
          message: `Reset effectué avec succès : ${archivedCount} transactions archivées, ${cleanedCount} nettoyées. Tous les dashboards sont à jour.`,
          type: 'RESET_ADMIN'
        });
      });
      
      activePartners.forEach(partner => {
        notifications.push({
          userId: partner.id,
          title: 'Nouveau Jour Commencé',
          message: `Les compteurs ont été remis à zéro. Nouveau cycle de transactions disponible.`,
          type: 'RESET_PARTNER'
        });
      });
      
      const notificationPromises = notifications.map(notif => 
        NotificationService.createNotification(notif)
      );
      
      const results = await Promise.allSettled(notificationPromises);
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log(`✅ [NOTIFICATIONS] ${successful} notifications envoyées, ${failed} échecs`);
      
      if (successful > 0) {
        await NotificationService.createNotification({
          userId: adminUsers[0]?.id || 'system',
          title: 'Notifications Reset Envoyées',
          message: `${successful} utilisateurs notifiés du reset quotidien`,
          type: 'SYSTEM_INFO'
        });
      }
      
      return {
        totalNotifications: notifications.length,
        successful,
        failed,
        details: resetDetails
      };
      
    } catch (error) {
      console.error('❌ [NOTIFICATIONS] Erreur envoi notifications:', error);
      return {
        error: error.message,
        totalNotifications: 0,
        successful: 0,
        failed: 0
      };
    }
  }

  // =====================================
  // UTILITAIRES ET HELPERS OPTIMISÉS
  // =====================================
  getResetConfig() {
    return TransactionService.RESET_CONFIG;
  }

  setResetConfig(hour, minute, windowMinutes = 5) {
    TransactionService.RESET_CONFIG = {
      hour,
      minute,
      windowMinutes
    };
    console.log(`🔧 [CONFIG] Reset configuré pour ${hour}:${minute.toString().padStart(2, '0')} (fenêtre: ${windowMinutes}min)`);
  }

  isInResetWindow() {
    const now = new Date();
    const resetConfig = this.getResetConfig();
    
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    let isInWindow;
    
    if (resetConfig.windowMinutes === 0) {
      isInWindow = currentHour === resetConfig.hour && currentMinute === resetConfig.minute;
    } else {
      const startMinute = resetConfig.minute;
      const endMinute = resetConfig.minute + resetConfig.windowMinutes;
      
      isInWindow = currentHour === resetConfig.hour && 
                   currentMinute >= startMinute && 
                   currentMinute <= endMinute;
    }
    
    return {
      isInWindow,
      currentTime: `${currentHour}:${currentMinute.toString().padStart(2, '0')}`,
      resetTime: `${resetConfig.hour}:${resetConfig.minute.toString().padStart(2, '0')}`,
      windowType: resetConfig.windowMinutes === 0 ? 'précis' : `fenêtre ${resetConfig.windowMinutes}min`
    };
  }

  getYesterdayRange() {
    const now = new Date();
    const resetConfig = this.getResetConfig();
    
    // Calculer le reset d'hier
    const yesterdayResetTime = new Date(now);
    yesterdayResetTime.setDate(now.getDate() - 1);
    yesterdayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
    
    // Calculer le reset d'aujourd'hui
    const todayResetTime = new Date(now);
    todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
    
    // Hier = du reset d'hier jusqu'à juste avant le reset d'aujourd'hui
    const startOfYesterday = yesterdayResetTime;
    const endOfYesterday = new Date(todayResetTime.getTime() - 1000); // 1 seconde avant
    
    console.log(`📅 [YESTERDAY RANGE] ${yesterdayResetTime.toISOString()} -> ${endOfYesterday.toISOString()}`);
    
    return { startOfYesterday, endOfYesterday };
  }

  getCustomDateRange(targetDate) {
    const resetConfig = this.getResetConfig();
    const customDate = new Date(targetDate);
    
    const startOfCustom = new Date(customDate);
    startOfCustom.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
    
    const nextDayReset = new Date(startOfCustom);
    nextDayReset.setDate(startOfCustom.getDate() + 1);
    const endOfCustom = new Date(nextDayReset.getTime() - 1000);
    
    console.log(`📅 [CUSTOM DATE RANGE] ${customDate.toISOString().split('T')[0]}:`, {
      start: startOfCustom.toISOString(),
      end: endOfCustom.toISOString()
    });
    
    return { startOfCustom, endOfCustom };
  }

  // CORRECTION MAJEURE : Reset basé sur exécution réelle via CRON
  async shouldIncludeArchivedTransactions(period, customDate = null) {
    try {
      // CORRECTION : Vérifier si un reset a VRAIMENT eu lieu aujourd'hui via CRON
      const lastResetDate = await this.getLastResetDate();
      const today = new Date().toDateString();
      
      // Un reset a vraiment eu lieu si :
      // 1. Il y a une entrée pour aujourd'hui
      // 2. Elle contient "SUCCESS" (pas "ERROR")
      const resetReallyExecutedToday = lastResetDate && 
                                       lastResetDate.includes(today) && 
                                       lastResetDate.includes('SUCCESS');
      
      console.log(`🔍 [RESET CHECK] Aujourd'hui: ${today}, Dernier reset: ${lastResetDate}, Reset exécuté: ${resetReallyExecutedToday}`);
      
      if (period === 'custom' && customDate) {
        const targetDate = new Date(customDate);
        const targetDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        const todayOnly = new Date();
        todayOnly.setHours(0, 0, 0, 0);
        
        // CORRECTION : Pour une date personnalisée passée
        if (targetDateOnly < todayOnly) {
          // Vérifier s'il y a eu un reset depuis cette date
          const daysSinceTarget = Math.floor((todayOnly - targetDateOnly) / (1000 * 60 * 60 * 24));
          
          if (daysSinceTarget === 1) {
            // Date d'hier - utiliser la logique yesterday
            return resetReallyExecutedToday;
          } else if (daysSinceTarget > 1) {
            // Date plus ancienne - probablement archivée
            return true;
          }
        }
        
        return false;
      }
      
      if (period === 'yesterday') {
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ [SHOULD INCLUDE ARCHIVED] Erreur:', error);
      return false;
    }
  }

  generateReference(prefix = 'TXN') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  formatAmount(amount, withSign = false) {
    const num = typeof amount === 'number' ? amount : parseFloat(amount);
    
    if (withSign) {
      if (num > 0) {
        return `+${num.toLocaleString('fr-FR')} F`;
      } else if (num < 0) {
        return `${num.toLocaleString('fr-FR')} F`;
      } else {
        return `${num.toLocaleString('fr-FR')} F`;
      }
    }
    
    return `${Math.abs(num).toLocaleString('fr-FR')} F`;
  }

  // CORRECTION MAJEURE : Logique de dates basée sur reset réel via CRON
  getDateFilter(period = 'today', customDate = null) {
    const now = new Date();
    const resetConfig = this.getResetConfig();
    
    console.log(`🔍 [DATE FILTER] Période: "${period}", Date custom: ${customDate}`);
    
    // Support des dates personnalisées
    if (period === 'custom' && customDate) {
      const targetDate = new Date(customDate);
      
      if (isNaN(targetDate.getTime())) {
        throw new Error('Date invalide');
      }
      
      // CORRECTION : Utiliser la logique basée sur le reset
      const { startOfCustom, endOfCustom } = this.getCustomDateRange(targetDate);
      
      console.log(`📅 [CUSTOM DATE] ${customDate}:`, {
        gte: startOfCustom.toISOString(),
        lte: endOfCustom.toISOString(),
        resetBasedOn: `${resetConfig.hour}h${resetConfig.minute}`
      });
      
      return { gte: startOfCustom, lte: endOfCustom };
    }
    
    // Logique pour les autres périodes
    switch (period.toLowerCase()) {
      case 'today':
        const todayResetTime = new Date(now);
        todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        // Today commence au reset d'aujourd'hui (ou hier si pas encore passé)
        const startOfToday = now > todayResetTime ? todayResetTime : (() => {
          const yesterdayReset = new Date(todayResetTime);
          yesterdayReset.setDate(yesterdayReset.getDate() - 1);
          return yesterdayReset;
        })();
        
        console.log(`📅 [TODAY] (basé sur reset CRON):`, {
          gte: startOfToday.toISOString(),
          lte: now.toISOString()
        });
        return { gte: startOfToday, lte: now };

      case 'yesterday':
        const { startOfYesterday, endOfYesterday } = this.getYesterdayRange();
        
        console.log(`📅 [YESTERDAY] (basé sur reset CRON ${resetConfig.hour}h${resetConfig.minute}):`, {
          gte: startOfYesterday.toISOString(),
          lte: endOfYesterday.toISOString()
        });
        return { gte: startOfYesterday, lte: endOfYesterday };

      case 'week':
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        weekAgo.setHours(0, 0, 0, 0);
        return { gte: weekAgo, lte: now };

      case 'month':
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        return { gte: startOfMonth, lte: now };

      case 'year':
        const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        return { gte: startOfYear, lte: now };

      case 'all':
        return {};

      default:
        const defaultStart = new Date(now);
        defaultStart.setHours(0, 0, 0, 0);
        return { gte: defaultStart, lte: now };
    }
  }

  validateCustomDateTime(dateTimeString) {
    if (!dateTimeString) return { valid: false, error: 'DateTime requise' };
    
    const dateTime = new Date(dateTimeString);
    
    if (isNaN(dateTime.getTime())) {
      return { valid: false, error: 'Format de datetime invalide. Utilisez: YYYY-MM-DD' };
    }
    
    const now = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    
    if (dateTime > now) {
      return { valid: false, error: 'DateTime future non autorisée' };
    }
    
    if (dateTime < oneYearAgo) {
      return { valid: false, error: 'DateTime trop ancienne (limite: 1 an)' };
    }
    
    return { valid: true, dateTime };
  }

  formatDateForDisplay(dateString) {
    const date = new Date(dateString);
    
    return {
      short: date.toLocaleDateString('fr-FR'),
      long: date.toLocaleDateString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      iso: date.toISOString().split('T')[0]
    };
  }

  extractAccountTypeFromDescription(description) {
    if (!description) return 'LIQUIDE';
    
    const desc = description.toUpperCase();
    
    if (desc.includes('LIQUIDE')) return 'LIQUIDE';
    if (desc.includes('ORANGE') || desc.includes('OM')) return 'ORANGE_MONEY';
    if (desc.includes('WAVE')) return 'WAVE';
    if (desc.includes('UV_MASTER') || desc.includes('UV MASTER')) return 'UV_MASTER';
    
    return 'LIQUIDE';
  }

  convertToInt(value) {
    if (typeof value === 'number') return Math.round(value * 100);
    if (typeof value === 'string') return Math.round(parseFloat(value) * 100);
    return Math.round(value * 100);
  }

  convertFromInt(value) {
    return Number(value) / 100;
  }

  // =====================================
  // CRÉATION ADMIN TRANSACTION
  // =====================================
  async createAdminTransaction(adminId, transactionData) {
    try {
      const { superviseurId, typeCompte, typeOperation, montant, partenaireId } = transactionData;

      const montantFloat = parseFloat(montant);
      if (isNaN(montantFloat) || montantFloat <= 0) {
        throw new Error('Montant invalide');
      }

      const montantInt = this.convertToInt(montantFloat);

      const [supervisor, partner] = await Promise.all([
        prisma.user.findUnique({
          where: { id: superviseurId, role: 'SUPERVISEUR' },
          select: { id: true, nomComplet: true, status: true }
        }),
        partenaireId ? prisma.user.findUnique({
          where: { id: partenaireId, role: 'PARTENAIRE' },
          select: { id: true, nomComplet: true, status: true }
        }) : Promise.resolve(null)
      ]);

      if (!supervisor) {
        throw new Error('Superviseur non trouvé');
      }

      if (partenaireId && !partner) {
        throw new Error('Partenaire non trouvé');
      }

      const isPartnerTransaction = !!partenaireId;
      
      let account = null;
      let balanceUpdate = {};

      if (isPartnerTransaction) {
        let transactionType, description;
        
        if (typeOperation === 'depot') {
          transactionType = 'DEPOT';
          description = `Dépôt partenaire ${partner.nomComplet}`;
        } else {
          transactionType = 'RETRAIT';
          description = `Retrait partenaire ${partner.nomComplet}`;
        }

        const result = await prisma.$transaction(async (tx) => {
          const transaction = await tx.transaction.create({
            data: {
              montant: montantInt,
              type: transactionType,
              description,
              envoyeurId: adminId,
              destinataireId: superviseurId,
              partenaireId
            },
            select: {
              id: true,
              type: true,
              description: true,
              createdAt: true
            }
          });

          return { transaction, updatedAccount: null };
        });

        setImmediate(async () => {
          try {
            let notificationTitle, notificationMessage, notificationType;

            if (typeOperation === 'depot') {
              notificationTitle = 'Nouveau dépôt partenaire';
              notificationMessage = `${partner.nomComplet} a déposé ${this.formatAmount(montantFloat)}`;
              notificationType = 'DEPOT_PARTENAIRE';
            } else {
              notificationTitle = 'Nouveau retrait partenaire';
              notificationMessage = `${partner.nomComplet} a retiré ${this.formatAmount(montantFloat)}`;
              notificationType = 'RETRAIT_PARTENAIRE';
            }

            await NotificationService.createNotification({
              userId: superviseurId,
              title: notificationTitle,
              message: notificationMessage,
              type: notificationType
            });
          } catch (notifError) {
            console.error('Erreur notification (non-bloquante):', notifError);
          }
        });

        return {
          transaction: {
            id: result.transaction.id,
            type: result.transaction.type,
            montant: montantFloat,
            description: result.transaction.description,
            superviseurNom: supervisor.nomComplet,
            typeCompte: null,
            createdAt: result.transaction.createdAt,
            isPartnerTransaction: true,
            partnerName: partner.nomComplet,
            partnerId: partner.id,
            transactionCategory: 'PARTENAIRE'
          },
          accountUpdated: false
        };

      } else {
        account = await prisma.account.upsert({
          where: {
            userId_type: {
              userId: superviseurId,
              type: typeCompte.toUpperCase()
            }
          },
          update: {},
          create: {
            type: typeCompte.toUpperCase(),
            userId: superviseurId,
            balance: 0,
            initialBalance: 0
          },
          select: { id: true, balance: true, initialBalance: true }
        });

        let transactionType, description;
        
        if (typeOperation === 'depot') {
          transactionType = 'DEBUT_JOURNEE';
          description = `Début journée ${typeCompte}`;
          balanceUpdate = { initialBalance: { increment: montantInt } };
        } else {
          transactionType = 'FIN_JOURNEE';
          description = `Fin journée ${typeCompte}`;
          balanceUpdate = { balance: montantInt };
        }

        const result = await prisma.$transaction(async (tx) => {
          const updatedAccount = await tx.account.update({
            where: { id: account.id },
            data: balanceUpdate,
            select: { balance: true, initialBalance: true }
          });

          const transaction = await tx.transaction.create({
            data: {
              montant: montantInt,
              type: transactionType,
              description,
              envoyeurId: adminId,
              destinataireId: superviseurId,
              compteDestinationId: account.id
            },
            select: {
              id: true,
              type: true,
              description: true,
              createdAt: true
            }
          });

          return { transaction, updatedAccount };
        });

        setImmediate(async () => {
          try {
            const notificationTitle = typeOperation === 'depot' 
              ? 'Solde de début mis à jour' 
              : 'Solde de fin enregistré';
            const notificationMessage = `${description} - ${this.formatAmount(montantFloat)} par l'admin`;
            const notificationType = typeOperation === 'depot' ? 'DEBUT_JOURNEE' : 'FIN_JOURNEE';

            await NotificationService.createNotification({
              userId: superviseurId,
              title: notificationTitle,
              message: notificationMessage,
              type: notificationType
            });
          } catch (notifError) {
            console.error('Erreur notification (non-bloquante):', notifError);
          }
        });

        return {
          transaction: {
            id: result.transaction.id,
            type: result.transaction.type,
            montant: montantFloat,
            description: result.transaction.description,
            superviseurNom: supervisor.nomComplet,
            typeCompte: typeCompte,
            createdAt: result.transaction.createdAt,
            isPartnerTransaction: false,
            partnerName: null,
            partnerId: null,
            transactionCategory: 'JOURNEE'
          },
          accountUpdated: true,
          soldeActuel: this.convertFromInt(result.updatedAccount.balance),
          soldeInitial: this.convertFromInt(result.updatedAccount.initialBalance)
        };
      }

    } catch (error) {
      console.error('Erreur createAdminTransaction:', error);
      throw error;
    }
  }

  // =====================================
  // SYSTÈME DE RESET AUTOMATIQUE VERCEL CRON
  // =====================================
  async cleanupDashboardAfterReset() {
    try {
      console.log('🧹 [CLEANUP] Nettoyage post-reset...');
      
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const resetConfig = this.getResetConfig();
      const todayResetTime = new Date(now);
      todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
      
      const cleanupResult = await prisma.transaction.updateMany({
        where: {
          createdAt: {
            gte: startOfToday,
            lt: todayResetTime
          },
          partenaireId: { not: null },
          archived: { not: true }
        },
        data: {
          archived: true,
          archivedAt: now
        }
      });
      
      console.log(`✅ [CLEANUP] ${cleanupResult.count} transactions partenaires nettoyées`);
      
      return cleanupResult.count;
      
    } catch (error) {
      console.error('❌ [CLEANUP] Erreur:', error);
      throw error;
    }
  }

  // CORRECTION : checkAndResetDaily maintenu pour compatibilité mais pas utilisé en production
  async checkAndResetDaily() {
    try {
      const resetCheck = this.isInResetWindow();
      
      if (!resetCheck.isInWindow) {
        return {
          success: false,
          reason: 'outside_reset_window',
          currentTime: resetCheck.currentTime,
          resetWindow: `${resetCheck.resetTime} (${resetCheck.windowType})`,
          cronMessage: 'Reset géré par Vercel CRON à 00h00 UTC'
        };
      }
      
      const now = new Date();
      const dateKey = now.toDateString();
      const lastResetDate = await this.getLastResetDate();
      
      const resetConfig = this.getResetConfig();
      const resetHourMinute = `${resetConfig.hour}:${resetConfig.minute}`;
      const shouldReset = !lastResetDate || 
                         !lastResetDate.includes(dateKey) || 
                         lastResetDate.includes('ERROR') ||
                         !lastResetDate.includes(resetHourMinute);
      
      if (shouldReset) {
        console.log('🔄 [MANUAL RESET] Lancement du reset manuel (normalement géré par CRON)...');
        
        try {
          // Exécuter toutes les opérations ensemble
          const archivedCount = await this.archivePartnerTransactionsDynamic();
          await this.transferBalancesToInitial();
          const cleanedCount = await this.cleanupDashboardAfterReset();
          
          const resetKey = `${dateKey}-SUCCESS-${resetCheck.currentTime}-${resetHourMinute}-manual`;
          await this.saveResetDate(resetKey);
          
          console.log(`✅ [MANUAL RESET] Reset terminé - ${archivedCount} archivées, ${cleanedCount} nettoyées`);
          
          const notificationResult = await this.notifyDashboardRefresh({
            archivedCount,
            cleanedCount,
            executedAt: now.toISOString()
          });
          
          console.log(`📢 [MANUAL RESET] ${notificationResult.successful} notifications envoyées`);
          
          return {
            success: true,
            archivedCount,
            cleanedCount,
            executedAt: now.toISOString(),
            resetConfig: this.getResetConfig(),
            notifications: notificationResult,
            needsRefresh: true,
            type: 'manual'
          };
          
        } catch (resetError) {
          console.error('❌ [MANUAL RESET] Erreur:', resetError);
          const errorKey = `${dateKey}-ERROR-${resetCheck.currentTime}`;
          await this.saveResetDate(errorKey);
          throw resetError;
        }
      } else {
        console.log(`[MANUAL RESET] Reset déjà effectué aujourd'hui (${lastResetDate})`);
        return {
          success: false,
          reason: 'already_executed_today',
          lastExecution: lastResetDate,
          currentTime: resetCheck.currentTime,
          cronMessage: 'Reset géré par Vercel CRON'
        };
      }
      
    } catch (error) {
      console.error('❌ [MANUAL RESET] Erreur checkAndResetDaily:', error);
      return { 
        success: false, 
        error: error.message,
        currentTime: new Date().toISOString()
      };
    }
  }

  async archivePartnerTransactionsDynamic() {
    try {
      const { startOfYesterday, endOfYesterday } = this.getYesterdayRange();
      
      const result = await prisma.transaction.updateMany({
        where: {
          createdAt: {
            gte: startOfYesterday,
            lte: endOfYesterday
          },
          partenaireId: { not: null },
          type: { in: ['DEPOT', 'RETRAIT'] },
          OR: [
            { archived: { equals: false } },
            { archived: { equals: null } }
          ]
        },
        data: {
          archived: true,
          archivedAt: new Date()
        }
      });
      
      console.log(`✅ [DYNAMIC ARCHIVE] ${result.count} transactions archivées pour la période:`, {
        start: startOfYesterday.toISOString(),
        end: endOfYesterday.toISOString()
      });
      
      return result.count;
      
    } catch (error) {
      console.error('❌ [DYNAMIC ARCHIVE] Erreur:', error);
      throw error;
    }
  }

  async transferBalancesToInitial() {
    try {
      console.log('🔄 [TRANSFER] Début du transfert des soldes...');
      
      // Logs pour debug
      const accountsBeforeTransfer = await prisma.account.findMany({
        where: {
          userId: {
            in: await prisma.user.findMany({
              where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
              select: { id: true }
            }).then(users => users.map(u => u.id))
          }
        },
        select: {
          id: true,
          type: true,
          balance: true,
          initialBalance: true,
          previousInitialBalance: true,
          user: { select: { nomComplet: true } }
        }
      });
      
      console.log(`🔍 [TRANSFER DEBUG] Comptes avant transfert:`, 
        accountsBeforeTransfer.map(acc => ({
          user: acc.user.nomComplet,
          type: acc.type,
          balance: this.convertFromInt(acc.balance),
          initialBalance: this.convertFromInt(acc.initialBalance),
          previousInitialBalance: acc.previousInitialBalance ? this.convertFromInt(acc.previousInitialBalance) : null
        }))
      );
      
      // CORRECTION : Transfert de TOUS les soldes, pas seulement ceux > 0
      const result = await prisma.$executeRaw`
        UPDATE accounts 
        SET "previousInitialBalance" = "initialBalance",
            "initialBalance" = balance, 
            balance = 0 
        WHERE "userId" IN (
          SELECT id FROM users 
          WHERE role = 'SUPERVISEUR' AND status = 'ACTIVE'
        )
      `;
      
      // Logs après transfert
      const accountsAfterTransfer = await prisma.account.findMany({
        where: {
          userId: {
            in: await prisma.user.findMany({
              where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
              select: { id: true }
            }).then(users => users.map(u => u.id))
          }
        },
        select: {
          id: true,
          type: true,
          balance: true,
          initialBalance: true,
          previousInitialBalance: true,
          user: { select: { nomComplet: true } }
        }
      });
      
      console.log(`✅ [TRANSFER DEBUG] Comptes après transfert:`, 
        accountsAfterTransfer.map(acc => ({
          user: acc.user.nomComplet,
          type: acc.type,
          balance: this.convertFromInt(acc.balance),
          initialBalance: this.convertFromInt(acc.initialBalance),
          previousInitialBalance: acc.previousInitialBalance ? this.convertFromInt(acc.previousInitialBalance) : null
        }))
      );
      
      console.log(`✅ [TRANSFER] Transfert terminé pour tous les comptes actifs`);
  
    } catch (error) {
      console.error('❌ [TRANSFER] Erreur transferBalancesToInitial:', error);
      throw error;
    }
  }

  async getLastResetDate() {
    try {
      const config = await prisma.systemConfig.findFirst({
        where: { key: 'last_reset_date' },
        select: { value: true }
      });
      
      if (config) {
        return config.value;
      }
    } catch (error) {
      console.log('[RESET] Table systemConfig non disponible, utilisation alternative');
    }
    
    try {
      const lastReset = await prisma.transaction.findFirst({
        where: { 
          type: 'AUDIT_MODIFICATION',
          description: { contains: '[SYSTEM RESET]' }
        },
        orderBy: { createdAt: 'desc' },
        select: { description: true }
      });
      
      return lastReset?.description || null;
    } catch (error) {
      console.error('[RESET] Erreur getLastResetDate:', error);
      return null;
    }
  }

  async saveResetDate(dateString) {
    try {
      await prisma.systemConfig.upsert({
        where: { key: 'last_reset_date' },
        update: { value: dateString },
        create: { 
          key: 'last_reset_date', 
          value: dateString 
        }
      });
      console.log(`✅ Date de reset sauvegardée: ${dateString}`);
    } catch (error) {
      console.log('[RESET] Table systemConfig non disponible, utilisation alternative');
      
      try {
        const adminUser = await prisma.user.findFirst({
          where: { role: 'ADMIN' },
          select: { id: true }
        });
        
        await prisma.transaction.create({
          data: {
            montant: 0,
            type: 'AUDIT_MODIFICATION',
            description: `[SYSTEM RESET] ${dateString}`,
            envoyeurId: adminUser?.id || 'cmffpzf8e0000248t0hu4w1gr'
          }
        });
        console.log(`✅ Date de reset sauvegardée (alternative): ${dateString}`);
      } catch (altError) {
        console.error('[RESET] Erreur saveResetDate (alternative):', altError);
      }
    }
  }

  // CORRECTION : forceReset optimisé pour CRON Vercel
  async forceReset(adminId = 'vercel-cron') {
    try {
      console.log(`🤖 [CRON RESET ${adminId.toUpperCase()}] Lancement du reset automatique...`);
      
      const now = new Date();
      
      // ÉTAPE 1 : Archiver les transactions partenaires d'hier
      console.log('📦 [CRON RESET] Étape 1/4 - Archivage des transactions partenaires...');
      const archivedCount = await this.archivePartnerTransactionsDynamic();
      
      // ÉTAPE 2 : Transférer les soldes (sortie → début)
      console.log('💰 [CRON RESET] Étape 2/4 - Transfert des soldes...');
      await this.transferBalancesToInitial();
      
      // ÉTAPE 3 : Nettoyage des données temporaires
      console.log('🧹 [CRON RESET] Étape 3/4 - Nettoyage des données...');
      const cleanedCount = await this.cleanupDashboardAfterReset();
      
      // ÉTAPE 4 : Enregistrer le succès du reset
      console.log('💾 [CRON RESET] Étape 4/4 - Enregistrement du reset...');
      const resetKey = `${now.toDateString()}-SUCCESS-${now.getHours()}h${now.getMinutes()}-${adminId}`;
      await this.saveResetDate(resetKey);
      
      // Créer une transaction d'audit
      const adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
        select: { id: true }
      });
      
      await prisma.transaction.create({
        data: {
          montant: 0,
          type: 'AUDIT_MODIFICATION',
          description: `Reset automatique ${adminId} - ${archivedCount} archivées, ${cleanedCount} nettoyées`,
          envoyeurId: adminUser?.id || 'cmffpzf8e0000248t0hu4w1gr'
        }
      });
      
      console.log(`✅ [CRON RESET ${adminId.toUpperCase()}] Reset terminé avec succès!`);
      console.log(`📊 [CRON RESET] Résultats: ${archivedCount} transactions archivées, ${cleanedCount} nettoyées`);
      
      // ÉTAPE 5 : Envoyer les notifications
      console.log('📢 [CRON RESET] Envoi des notifications...');
      const notificationResult = await this.notifyDashboardRefresh({
        archivedCount,
        cleanedCount,
        executedAt: now.toISOString()
      });
      
      console.log(`✅ [CRON RESET] ${notificationResult.successful} notifications envoyées sur ${notificationResult.totalNotifications}`);
      
      return {
        success: true,
        archivedCount,
        cleanedCount,
        executedAt: now.toISOString(),
        type: adminId,
        notifications: notificationResult,
        message: `Reset automatique ${adminId} exécuté avec succès à ${now.toISOString()}`
      };
      
    } catch (error) {
      console.error(`❌ [CRON RESET ${adminId.toUpperCase()}] Erreur:`, error);
      
      // Enregistrer l'erreur
      try {
        const now = new Date();
        const errorKey = `${now.toDateString()}-ERROR-${now.getHours()}h${now.getMinutes()}-${adminId}`;
        await this.saveResetDate(errorKey);
      } catch (saveError) {
        console.error('❌ [CRON RESET] Impossible de sauvegarder l\'erreur:', saveError);
      }
      
      throw error;
    }
  }

  // =====================================
  // MÉTHODES DASHBOARD SANS AUTO-RESET
  // =====================================
  async getAdminDashboard(period = 'today', customDate = null) {
    try {
      // CORRECTION : Plus de vérification automatique - le CRON Vercel s'en charge
      console.log(`📊 [ADMIN DASHBOARD] Période: ${period}, Date: ${customDate}`);
      
      const dateFilter = this.getDateFilter(period, customDate);
      const includeArchived = await this.shouldIncludeArchivedTransactions(period, customDate);
      
      console.log(`📊 [ADMIN DASHBOARD] Filtre date:`, {
        start: dateFilter.gte?.toISOString(),
        end: dateFilter.lte?.toISOString(),
        includeArchived
      });
      
      // Filtre de transactions basé sur reset réel via CRON
      let transactionFilter = { createdAt: dateFilter };

      if (includeArchived) {
        const now = new Date();
        const resetConfig = this.getResetConfig();
        const todayResetTime = new Date(now);
        todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        transactionFilter = {
          ...transactionFilter,
          archived: true,
          archivedAt: {
            gte: new Date(todayResetTime.getTime() - 60 * 1000),
            lte: new Date(todayResetTime.getTime() + 10 * 60 * 1000)
          }
        };
      } else {
        transactionFilter = {
          ...transactionFilter,
          OR: [
            { archived: { equals: false } },
            { archived: { equals: null } }
          ]
        };
      }

      console.log(`📊 [ADMIN DASHBOARD] Filtre transactions final:`, transactionFilter);

      // Récupération des superviseurs
      const supervisors = await prisma.user.findMany({
        where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
        select: {
          id: true,
          nomComplet: true,
          status: true,
          accounts: {
            select: {
              type: true,
              balance: true,
              initialBalance: true,
              previousInitialBalance: true
            }
          },
          transactionsRecues: {
            where: transactionFilter,
            select: {
              id: true,
              type: true,
              montant: true,
              partenaireId: true,
              archived: true,
              archivedAt: true,
              createdAt: true,
              partenaire: {
                select: { nomComplet: true }
              }
            }
          }
        },
        orderBy: { nomComplet: 'asc' }
      });

      console.log(`📊 [ADMIN DASHBOARD] ${supervisors.length} superviseurs trouvés`);

      // Cas spécial : date personnalisée sans données
      if (period === 'custom' && supervisors.every(s => s.transactionsRecues.length === 0)) {
        console.log(`📊 [CUSTOM DATE] Aucune donnée trouvée pour ${customDate}`);
        
        return {
          period,
          customDate,
          globalTotals: {
            uvMaster: { solde: 0, sorties: 0, formatted: { solde: "0 F", sorties: "0 F" } },
            debutTotalGlobal: 0, sortieTotalGlobal: 0, grTotalGlobal: 0,
            formatted: { debutTotalGlobal: "0 F", sortieTotalGlobal: "0 F", grTotalGlobal: "0 F" }
          },
          supervisorCards: supervisors.map(supervisor => ({
            id: supervisor.id, nom: supervisor.nomComplet, status: supervisor.status,
            comptes: { debut: {}, sortie: {} },
            totaux: {
              debutTotal: 0, sortieTotal: 0, grTotal: 0,
              formatted: { debutTotal: "0 F", sortieTotal: "0 F", grTotal: "0 F" }
            }
          })),
          dynamicConfig: {
            resetConfig: this.getResetConfig(), includeArchived,
            targetDateTime: customDate, filterApplied: 'archived_excluded', dataSource: 'empty'
          }
        };
      }

      // Traitement des superviseurs
      let totalDebutGlobal = 0, totalSortieGlobal = 0, uvMasterSolde = 0, uvMasterSorties = 0;

      const supervisorCards = supervisors.map(supervisor => {
        const accountsByType = { debut: {}, sortie: {} };

        // CORRECTION : Logique basée sur reset réel via CRON
        if (includeArchived && period === 'yesterday') {
          // Hier après reset CRON : utiliser previousInitialBalance et initialBalance
          supervisor.accounts.forEach(account => {
            const ancienDebutHier = this.convertFromInt(account.previousInitialBalance || 0);
            const ancienneSortieHier = this.convertFromInt(account.initialBalance || 0);
            
            accountsByType.debut[account.type] = ancienDebutHier;
            accountsByType.sortie[account.type] = ancienneSortieHier;
            
            if (account.type === 'UV_MASTER') {
              uvMasterSorties += ancienneSortieHier;
              uvMasterSolde += ancienDebutHier;
            }
          });
        } else {
          // Logique normale : utiliser initialBalance et balance
          supervisor.accounts.forEach(account => {
            const initial = this.convertFromInt(account.initialBalance || 0);
            const current = this.convertFromInt(account.balance || 0);
            
            accountsByType.debut[account.type] = initial;
            accountsByType.sortie[account.type] = current;
            
            if (account.type === 'UV_MASTER') {
              uvMasterSorties += current;
              uvMasterSolde += initial;
            }
          });
        }

        // Traitement des transactions partenaires
        const partenaireTransactions = {};
        supervisor.transactionsRecues.forEach(tx => {
          if (tx.partenaireId && tx.partenaire) {
            const montant = this.convertFromInt(tx.montant);
            const partnerName = tx.partenaire.nomComplet;
            
            if (!partenaireTransactions[partnerName]) {
              partenaireTransactions[partnerName] = { depots: 0, retraits: 0 };
            }
            
            if (tx.type === 'DEPOT') {
              partenaireTransactions[partnerName].depots += montant;
            } else if (tx.type === 'RETRAIT') {
              partenaireTransactions[partnerName].retraits += montant;
            }
          }
        });

        // Ajouter partenaires aux comptes
        Object.entries(partenaireTransactions).forEach(([partnerName, amounts]) => {
          if (amounts.depots > 0) {
            accountsByType.debut[`part-${partnerName}`] = amounts.depots;
          }
          if (amounts.retraits > 0) {
            accountsByType.sortie[`part-${partnerName}`] = amounts.retraits;
          }
        });

        // Calculer totaux
        const debutTotal = Object.values(accountsByType.debut).reduce((sum, val) => sum + val, 0);
        const sortieTotal = Object.values(accountsByType.sortie).reduce((sum, val) => sum + val, 0);
        const grTotal = sortieTotal - debutTotal;

        totalDebutGlobal += debutTotal;
        totalSortieGlobal += sortieTotal;

        return {
          id: supervisor.id,
          nom: supervisor.nomComplet,
          status: supervisor.status,
          comptes: accountsByType,
          totaux: {
            debutTotal, sortieTotal, grTotal,
            formatted: {
              debutTotal: this.formatAmount(debutTotal),
              sortieTotal: this.formatAmount(sortieTotal),
              grTotal: this.formatAmount(grTotal, true)
            }
          }
        };
      });

      const globalTotals = {
        uvMaster: {
          solde: uvMasterSolde, sorties: uvMasterSorties,
          formatted: { solde: this.formatAmount(uvMasterSolde), sorties: this.formatAmount(uvMasterSorties) }
        },
        debutTotalGlobal: totalDebutGlobal, sortieTotalGlobal: totalSortieGlobal,
        grTotalGlobal: totalSortieGlobal - totalDebutGlobal,
        formatted: {
          debutTotalGlobal: this.formatAmount(totalDebutGlobal),
          sortieTotalGlobal: this.formatAmount(totalSortieGlobal),
          grTotalGlobal: this.formatAmount(totalSortieGlobal - totalDebutGlobal, true)
        }
      };

      console.log(`📊 [ADMIN DASHBOARD] Résultats:`, {
        supervisorCount: supervisorCards.length,
        transactionSource: includeArchived ? 'archived' : 'current',
        totalDebut: totalDebutGlobal, totalSortie: totalSortieGlobal
      });

      return {
        period, customDate, globalTotals, supervisorCards,
        dynamicConfig: {
          resetConfig: this.getResetConfig(), includeArchived,
          targetDateTime: customDate,
          filterApplied: includeArchived ? 'archived_included' : 'archived_excluded',
          dataSource: includeArchived ? 'historical_after_reset' : 'current_live',
          cronStatus: 'Vercel CRON géré automatiquement'
        }
      };

    } catch (error) {
      console.error('Erreur getAdminDashboard:', error);
      throw error;
    }
  }

  async getSupervisorDashboard(superviseurId, period = 'today', customDate = null) {
    try {
      // CORRECTION : Plus de vérification automatique - le CRON Vercel s'en charge
      const dateFilter = this.getDateFilter(period, customDate);
      const includeArchived = await this.shouldIncludeArchivedTransactions(period, customDate);
      
      console.log(`📊 [SUPERVISOR DASHBOARD] Superviseur: ${superviseurId}, Include archived: ${includeArchived}`);
      
      // Filtre transactions identique à getAdminDashboard
      let transactionFilter = { 
        createdAt: dateFilter,
        AND: [{ OR: [{ envoyeurId: superviseurId }, { destinataireId: superviseurId }] }]
      };

      if (includeArchived) {
        const resetConfig = this.getResetConfig();
        const now = new Date();
        const todayResetTime = new Date(now);
        todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        transactionFilter = {
          ...transactionFilter,
          archived: true,
          archivedAt: {
            gte: new Date(todayResetTime.getTime() - 60 * 1000),
            lte: new Date(todayResetTime.getTime() + 10 * 60 * 1000)
          }
        };
      } else {
        transactionFilter = {
          ...transactionFilter,
          OR: [{ archived: { equals: false } }, { archived: { equals: null } }]
        };
      }

      const [supervisor, allTransactions, uvMasterAccounts] = await Promise.all([
        prisma.user.findUnique({
          where: { id: superviseurId },
          select: {
            id: true, nomComplet: true, status: true,
            accounts: {
              select: {
                type: true, balance: true, initialBalance: true, previousInitialBalance: true
              }
            }
          }
        }),
        prisma.transaction.findMany({
          where: transactionFilter,
          select: {
            id: true, type: true, montant: true, description: true, createdAt: true,
            envoyeurId: true, destinataireId: true, partenaireId: true, archived: true,
            destinataire: { select: { nomComplet: true } },
            envoyeur: { select: { nomComplet: true } },
            partenaire: { select: { nomComplet: true } }
          },
          orderBy: { createdAt: 'desc' }, take: 50
        }),
        prisma.account.findMany({
          where: { type: 'UV_MASTER', user: { role: 'SUPERVISEUR', status: 'ACTIVE' } },
          select: { balance: true, initialBalance: true, previousInitialBalance: true }
        })
      ]);

      if (!supervisor) throw new Error('Superviseur non trouvé');

      // Cas spécial : date personnalisée sans données
      if (period === 'custom' && allTransactions.length === 0) {
        return {
          superviseur: { id: supervisor.id, nom: supervisor.nomComplet, status: supervisor.status },
          period, customDate,
          uvMaster: { personal: { debut: 0, sortie: 0, formatted: "0 F" }, total: 0, formatted: "0 F" },
          comptes: { debut: {}, sortie: {} },
          totaux: {
            debutTotal: 0, sortieTotal: 0, grTotal: 0,
            formatted: { debutTotal: "0 F", sortieTotal: "0 F", grTotal: "0 F" }
          },
          recentTransactions: [],
          dynamicConfig: {
            period, customDate, resetConfig: this.getResetConfig(), includeArchived,
            totalTransactionsFound: 0, filterApplied: 'archived_excluded', dataSource: 'empty'
          }
        };
      }

      const accountsByType = { debut: {}, sortie: {} };
      let totalDebutPersonnel = 0, totalSortiePersonnel = 0;

      // CORRECTION : Logique identique à getAdminDashboard
      if (includeArchived && period === 'yesterday') {
        supervisor.accounts.forEach(account => {
          const ancienDebutHier = this.convertFromInt(account.previousInitialBalance || 0);
          const ancienneSortieHier = this.convertFromInt(account.initialBalance || 0);
          
          accountsByType.debut[account.type] = ancienDebutHier;
          accountsByType.sortie[account.type] = ancienneSortieHier;
          
          totalDebutPersonnel += ancienDebutHier;
          totalSortiePersonnel += ancienneSortieHier;
        });
      } else {
        supervisor.accounts.forEach(account => {
          const initial = this.convertFromInt(account.initialBalance || 0);
          const current = this.convertFromInt(account.balance || 0);

          accountsByType.debut[account.type] = initial;
          accountsByType.sortie[account.type] = current;
          
          totalDebutPersonnel += initial;
          totalSortiePersonnel += current;
        });
      }

      // Traitement des transactions partenaires
      const partenaireTransactions = {};
      allTransactions.forEach(tx => {
        if (tx.partenaireId && tx.partenaire) {
          const montant = this.convertFromInt(tx.montant);
          const partnerName = tx.partenaire.nomComplet;
          
          if (!partenaireTransactions[partnerName]) {
            partenaireTransactions[partnerName] = { depots: 0, retraits: 0 };
          }
          
          if (tx.type === 'DEPOT' && tx.destinataireId === superviseurId) {
            partenaireTransactions[partnerName].depots += montant;
          } else if (tx.type === 'RETRAIT' && tx.destinataireId === superviseurId) {
            partenaireTransactions[partnerName].retraits += montant;
          }
        }
      });

      // Ajouter partenaires aux comptes ET totaux
      Object.entries(partenaireTransactions).forEach(([partnerName, amounts]) => {
        if (amounts.depots > 0) {
          accountsByType.debut[`part-${partnerName}`] = amounts.depots;
          totalDebutPersonnel += amounts.depots;
        }
        if (amounts.retraits > 0) {
          accountsByType.sortie[`part-${partnerName}`] = amounts.retraits;
          totalSortiePersonnel += amounts.retraits;
        }
      });

      // UV MASTER global
      let uvMasterDebut, uvMasterSortie;
      if (includeArchived && period === 'yesterday') {
        uvMasterDebut = uvMasterAccounts.reduce((total, account) => 
          total + this.convertFromInt(account.previousInitialBalance || 0), 0);
        uvMasterSortie = uvMasterAccounts.reduce((total, account) => 
          total + this.convertFromInt(account.initialBalance || 0), 0);
      } else {
        uvMasterDebut = uvMasterAccounts.reduce((total, account) => 
          total + this.convertFromInt(account.initialBalance || 0), 0);
        uvMasterSortie = uvMasterAccounts.reduce((total, account) => 
          total + this.convertFromInt(account.balance || 0), 0);
      }

      const grTotal = totalSortiePersonnel - totalDebutPersonnel;

      // Formatage des transactions récentes
      const recentTransactions = allTransactions.map(tx => {
        let personne = '';
        if (tx.partenaireId && tx.partenaire) {
          personne = `${tx.partenaire.nomComplet} (Partenaire)`;
        } else if (tx.envoyeurId === superviseurId) {
          personne = tx.destinataire?.nomComplet || 'Destinataire inconnu';
        } else if (tx.destinataireId === superviseurId) {
          personne = tx.envoyeur?.nomComplet || 'Expéditeur inconnu';
        }
        if (['DEBUT_JOURNEE', 'FIN_JOURNEE'].includes(tx.type)) {
          personne = supervisor.nomComplet;
        }

        return {
          id: tx.id, type: tx.type, montant: this.convertFromInt(tx.montant),
          description: tx.description, personne, createdAt: tx.createdAt,
          envoyeurId: tx.envoyeurId, destinataireId: tx.destinataireId,
          partenaireId: tx.partenaireId, archived: tx.archived
        };
      });

      return {
        superviseur: { id: supervisor.id, nom: supervisor.nomComplet, status: supervisor.status },
        period, customDate,
        uvMaster: {
          personal: { debut: uvMasterDebut, sortie: uvMasterSortie, formatted: uvMasterSortie.toLocaleString() + ' F' },
          total: uvMasterSortie, formatted: uvMasterSortie.toLocaleString() + ' F'
        },
        comptes: accountsByType,
        totaux: {
          debutTotal: totalDebutPersonnel, sortieTotal: totalSortiePersonnel, grTotal,
          formatted: {
            debutTotal: totalDebutPersonnel.toLocaleString() + ' F',
            sortieTotal: totalSortiePersonnel.toLocaleString() + ' F',
            grTotal: this.formatAmount(grTotal, true)
          }
        },
        recentTransactions,
        dynamicConfig: {
          period, customDate, resetConfig: this.getResetConfig(), includeArchived,
          totalTransactionsFound: allTransactions.length,
          partnerTransactionsFound: allTransactions.filter(tx => tx.partenaireId).length,
          filterApplied: includeArchived ? 'archived_included' : 'archived_excluded',
          dataSource: includeArchived ? 'historical_after_reset' : 'current_live',
          cronStatus: 'Vercel CRON géré automatiquement'
        }
      };

    } catch (error) {
      console.error('Erreur getSupervisorDashboard:', error);
      throw new Error('Erreur lors de la récupération du dashboard superviseur: ' + error.message);
    }
  }

  async getPartnerDashboard(partenaireId, period = 'today', customDate = null) {
    try {
      const dateFilter = this.getDateFilter(period, customDate);

      const [partner, availableSupervisors] = await Promise.all([
        prisma.user.findUnique({
          where: { id: partenaireId },
          select: {
            id: true,
            nomComplet: true,
            transactionsEnvoyees: {
              where: { createdAt: dateFilter },
              select: {
                id: true,
                type: true,
                montant: true,
                description: true,
                createdAt: true,
                destinataire: {
                  select: { nomComplet: true, role: true }
                }
              },
              orderBy: { createdAt: 'desc' }
            }
          }
        }),
        this.getActiveSupervisors()
      ]);

      if (!partner) {
        throw new Error('Partenaire non trouvé');
      }

      let totalDepots = 0;
      let totalRetraits = 0;

      const transactionDetails = partner.transactionsEnvoyees.map(tx => {
        const montant = this.convertFromInt(tx.montant);
        const isDepot = tx.type === 'DEPOT';
        
        if (isDepot) {
          totalDepots += montant;
        } else {
          totalRetraits += montant;
        }

        return {
          id: tx.id,
          type: tx.type,
          montant: montant,
          description: tx.description,
          superviseur: tx.destinataire?.nomComplet,
          createdAt: tx.createdAt,
          formatted: {
            montant: this.formatAmount(montant),
            type: isDepot ? 'Dépôt' : 'Retrait'
          }
        };
      });

      return {
        partenaire: {
          id: partner.id,
          nom: partner.nomComplet
        },
        period,
        customDate,
        statistiques: {
          totalDepots,
          totalRetraits,
          soldeNet: totalDepots - totalRetraits,
          nombreTransactions: partner.transactionsEnvoyees.length,
          formatted: {
            totalDepots: this.formatAmount(totalDepots),
            totalRetraits: this.formatAmount(totalRetraits),
            soldeNet: this.formatAmount(totalDepots - totalRetraits, true)
          }
        },
        transactions: transactionDetails,
        superviseursDisponibles: availableSupervisors
      };

    } catch (error) {
      console.error('Erreur getPartnerDashboard:', error);
      throw new Error('Erreur lors de la récupération du dashboard partenaire');
    }
  }

  // =====================================
  // AUTRES MÉTHODES UTILITAIRES
  // =====================================
  async updateTransaction(transactionId, updateData, userId) {
    try {
      console.log('🔄 [OPTIMIZED] updateTransaction démarré:', {
        transactionId,
        updateData,
        userId
      });

      if (!transactionId || !updateData || Object.keys(updateData).length === 0) {
        throw new Error('Données invalides');
      }

      const [existingTransaction, user] = await Promise.all([
        prisma.transaction.findUnique({
          where: { id: transactionId },
          select: {
            id: true,
            type: true,
            montant: true,
            description: true,
            createdAt: true,
            envoyeurId: true,
            destinataireId: true,
            compteDestinationId: true,
            envoyeur: { select: { id: true, nomComplet: true, role: true } },
            destinataire: { select: { id: true, nomComplet: true, role: true } },
            compteDestination: {
              select: { id: true, balance: true }
            }
          }
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true, nomComplet: true }
        })
      ]);

      if (!existingTransaction) {
        throw new Error('Transaction non trouvée');
      }

      if (!user) {
        throw new Error('Utilisateur non trouvé');
      }

      const isAdmin = user.role === 'ADMIN';
      const isSupervisor = user.role === 'SUPERVISEUR';
      const isOwnTransaction = existingTransaction.destinataireId === userId;
      const ageInDays = Math.floor((new Date() - new Date(existingTransaction.createdAt)) / (1000 * 60 * 60 * 24));

      if (!isAdmin && (!isSupervisor || !isOwnTransaction || ageInDays > 1)) {
        throw new Error('Permissions insuffisantes pour modifier cette transaction');
      }

      if (isAdmin && ageInDays > 7) {
        throw new Error('Transaction trop ancienne pour être modifiée (limite: 7 jours)');
      }

      const updateFields = {};
      
      if (updateData.description) {
        updateFields.description = updateData.description;
      }

      if (updateData.montant) {
        const newMontantFloat = parseFloat(updateData.montant);
        if (isNaN(newMontantFloat) || newMontantFloat <= 0) {
          throw new Error('Montant invalide');
        }
        
        const newMontantInt = this.convertToInt(newMontantFloat);
        const oldMontantInt = Number(existingTransaction.montant);
        
        updateFields.montant = newMontantInt;

        if (existingTransaction.compteDestination && newMontantInt !== oldMontantInt) {
          const difference = newMontantInt - oldMontantInt;
          
          return await prisma.$transaction(async (tx) => {
            if (existingTransaction.type === 'DEPOT' || existingTransaction.type === 'DEBUT_JOURNEE') {
              if (existingTransaction.type === 'DEBUT_JOURNEE') {
                await tx.account.update({
                  where: { id: existingTransaction.compteDestination.id },
                  data: { initialBalance: { increment: difference } }
                });
              } else {
                await tx.account.update({
                  where: { id: existingTransaction.compteDestination.id },
                  data: { balance: { increment: difference } }
                });
              }
            } else if (existingTransaction.type === 'RETRAIT') {
              if (existingTransaction.compteDestination.balance - difference < 0) {
                throw new Error('Solde insuffisant pour cette modification');
              }
              
              await tx.account.update({
                where: { id: existingTransaction.compteDestination.id },
                data: { balance: { decrement: difference } }
              });
            }

            const updatedTransaction = await tx.transaction.update({
              where: { id: transactionId },
              data: updateFields
            });

            await tx.transaction.create({
              data: {
                montant: newMontantInt,
                type: 'AUDIT_MODIFICATION',
                description: `Modification transaction ${transactionId} par ${user.nomComplet}`,
                envoyeurId: userId,
                destinataireId: existingTransaction.destinataireId
              }
            });

            return updatedTransaction;
          });
        }
      }

      const updatedTransaction = await prisma.transaction.update({
        where: { id: transactionId },
        data: updateFields
      });

      return {
        success: true,
        message: 'Transaction mise à jour avec succès',
        data: {
          id: updatedTransaction.id,
          type: updatedTransaction.type,
          montant: this.convertFromInt(updatedTransaction.montant),
          description: updatedTransaction.description,
          updatedAt: updatedTransaction.updatedAt
        }
      };

    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur updateTransaction:', error);
      throw error;
    }
  }

  async updateSupervisorAccount(supervisorId, accountType, accountKey, newValue, adminId) {
    try {
      console.log('🔄 [OPTIMIZED] updateSupervisorAccount:', {
        supervisorId,
        accountType, 
        accountKey,
        newValue,
        adminId
      });

      const newValueInt = this.convertToInt(newValue);

      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId, role: 'SUPERVISEUR' },
        select: { id: true, nomComplet: true }
      });

      if (!supervisor) {
        throw new Error('Superviseur non trouvé');
      }

      if (!accountKey.startsWith('part-') && !accountKey.startsWith('sup-')) {
        const account = await prisma.account.upsert({
          where: {
            userId_type: {
              userId: supervisorId,
              type: accountKey
            }
          },
          update: accountType === 'debut' 
            ? { initialBalance: newValueInt }
            : { balance: newValueInt },
          create: {
            type: accountKey,
            userId: supervisorId,
            balance: accountType === 'sortie' ? newValueInt : 0,
            initialBalance: accountType === 'debut' ? newValueInt : 0
          },
          select: { 
            id: true, 
            balance: true, 
            initialBalance: true 
          }
        });

        const oldValue = accountType === 'debut' 
          ? this.convertFromInt(account.initialBalance) 
          : this.convertFromInt(account.balance);

        setImmediate(async () => {
          try {
            await prisma.transaction.create({
              data: {
                montant: newValueInt,
                type: 'AUDIT_MODIFICATION',
                description: `Modification compte ${accountKey} (${accountType}) par admin - Ancien: ${oldValue} F, Nouveau: ${newValue} F`,
                envoyeurId: adminId,
                destinataireId: supervisorId,
                compteDestinationId: account.id
              }
            });
          } catch (auditError) {
            console.error('Erreur audit (non-bloquante):', auditError);
          }
        });

        return {
          oldValue: oldValue,
          newValue: newValue,
          accountUpdated: true
        };
      } else {
        setImmediate(async () => {
          try {
            await prisma.transaction.create({
              data: {
                montant: newValueInt,
                type: 'AUDIT_MODIFICATION',
                description: `Tentative modification compte ${accountKey} (${accountType}) par admin`,
                envoyeurId: adminId,
                destinataireId: supervisorId
              }
            });
          } catch (auditError) {
            console.error('Erreur audit (non-bloquante):', auditError);
          }
        });

        return {
          oldValue: 0,
          newValue: newValue,
          note: 'Modification enregistrée (comptes partenaires)'
        };
      }

    } catch (error) {
      console.error('❌ Erreur updateSupervisorAccount service:', error);
      throw error;
    }
  }

  async getActiveSupervisors() {
    try {
      const supervisors = await prisma.user.findMany({
        where: {
          role: 'SUPERVISEUR',
          status: 'ACTIVE'
        },
        select: {
          id: true,
          nomComplet: true,
          telephone: true
        },
        orderBy: { nomComplet: 'asc' }
      });

      return supervisors;
    } catch (error) {
      console.error('Erreur getActiveSupervisors:', error);
      throw new Error('Erreur lors de la récupération des superviseurs actifs');
    }
  }

  async createSupervisorTransaction(superviseurId, transactionData) {
    try {
      return await this.createAdminTransaction(superviseurId, transactionData);
    } catch (error) {
      console.error('Erreur createSupervisorTransaction:', error);
      throw error;
    }
  }

  async createPartnerTransaction(partnerId, transactionData) {
    try {
      throw new Error('Fonctionnalité createPartnerTransaction à implémenter');
    } catch (error) {
      console.error('Erreur createPartnerTransaction:', error);
      throw error;
    }
  }

  // =====================================
  // MÉTHODES UTILITAIRES POUR TESTS ET RESET
  // =====================================
  async setResetTimeForTesting(hour, minute) {
    this.setResetConfig(hour, minute, 0);
    console.log(`🧪 [TEST] Reset configuré pour ${hour}:${minute.toString().padStart(2, '0')}`);
  }

  async testResetLogic() {
    const { isInWindow, currentTime, resetTime } = this.isInResetWindow();
    const { startOfYesterday, endOfYesterday } = this.getYesterdayRange();
    
    return {
      currentTime,
      resetTime,
      isInWindow,
      yesterdayRange: {
        start: startOfYesterday.toISOString(),
        end: endOfYesterday.toISOString()
      },
      resetConfig: this.getResetConfig(),
      cronStatus: 'Vercel CRON automatique à 00h00 UTC'
    };
  }

  async getResetStatus() {
    try {
      const now = new Date();
      const today = now.toDateString();
      const lastResetDate = await this.getLastResetDate();
      const resetConfig = this.getResetConfig();
      
      const resetToday = lastResetDate && lastResetDate.includes(today);
      const nextResetTime = new Date();
      nextResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
      
      if (now > nextResetTime) {
        nextResetTime.setDate(nextResetTime.getDate() + 1);
      }
      
      return {
        resetExecutedToday: resetToday,
        lastReset: lastResetDate,
        nextScheduledReset: nextResetTime.toISOString(),
        currentTime: now.toISOString(),
        resetConfig: resetConfig,
        canExecuteNow: this.isInResetWindow().isInWindow,
        cronStatus: 'CRON automatique Vercel configuré pour 00h00 UTC',
        cronWorking: resetToday && lastResetDate.includes('vercel-cron')
      };
      
    } catch (error) {
      console.error('Erreur getResetStatus:', error);
      return {
        error: error.message
      };
    }
  }

  // NOUVELLE MÉTHODE : Vérifier l'état du CRON Vercel
  async checkCronStatus() {
    try {
      const now = new Date();
      const today = now.toDateString();
      const lastResetDate = await this.getLastResetDate();
      
      // Vérifier si le reset a eu lieu aujourd'hui
      const resetExecutedToday = lastResetDate && 
                                lastResetDate.includes(today) && 
                                lastResetDate.includes('SUCCESS');
      
      // Vérifier si c'est un reset CRON Vercel
      const isCronReset = lastResetDate && lastResetDate.includes('vercel-cron');
      
      return {
        cronWorking: resetExecutedToday && isCronReset,
        lastResetDate,
        resetExecutedToday,
        isCronReset,
        currentTime: now.toISOString(),
        message: resetExecutedToday 
          ? (isCronReset ? 'CRON Vercel fonctionne correctement' : 'Reset manuel effectué aujourd\'hui')
          : 'Aucun reset effectué aujourd\'hui - En attente du CRON Vercel',
        nextCronExecution: '00:00 UTC (chaque nuit)'
      };
      
    } catch (error) {
      console.error('Erreur checkCronStatus:', error);
      return {
        cronWorking: false,
        error: error.message
      };
    }
  }

  // =====================================
  // MÉTHODES POUR LABELS ET FORMATAGE
  // =====================================
  getTransactionTypeLabel(type) {
    const labels = {
      'DEPOT': 'Dépôt',
      'RETRAIT': 'Retrait',
      'TRANSFERT_ENVOYE': 'Transfert envoyé',
      'TRANSFERT_RECU': 'Transfert reçu',
      'ALLOCATION_UV_MASTER': 'Allocation UV Master',
      'DEBUT_JOURNEE': 'Début journée',
      'FIN_JOURNEE': 'Fin journée'
    };
    
    return labels[type] || type;
  }

  getTransactionColor(type) {
    const positiveTypes = ['DEPOT', 'TRANSFERT_RECU', 'ALLOCATION_UV_MASTER', 'DEBUT_JOURNEE'];
    const negativeTypes = ['RETRAIT', 'TRANSFERT_ENVOYE', 'FIN_JOURNEE'];
    
    if (positiveTypes.includes(type)) return 'positive';
    if (negativeTypes.includes(type)) return 'negative';
    return 'neutral';
  }

  getAccountTypeLabel(type) {
    const labels = {
      'LIQUIDE': 'Liquide',
      'ORANGE_MONEY': 'Orange Money',
      'WAVE': 'Wave',
      'UV_MASTER': 'UV Master',
      'AUTRES': 'Autres'
    };
    
    return labels[type] || type;
  }

  getAccountTypeIcon(type) {
    const icons = {
      'LIQUIDE': '💵',
      'ORANGE_MONEY': '📱',
      'WAVE': '🌊',
      'UV_MASTER': '⭐',
      'AUTRES': '📦'
    };
    
    return icons[type] || '📦';
  }

  getPeriodLabel(period, customDate = null) {
    if (period === 'custom' && customDate) {
      const formatted = this.formatDateForDisplay(customDate);
      return formatted.long;
    }
    
    const labels = {
      'today': "Aujourd'hui",
      'yesterday': "Hier",
      'week': 'Cette semaine',
      'month': 'Ce mois',
      'year': 'Cette année',
      'all': 'Tout'
    };
    
    return labels[period] || period;
  }

  validateAdminTransactionData(data) {
    const errors = [];

    if (!data.superviseurId) {
      errors.push('Superviseur requis');
    }

    const isPartnerTransaction = !!data.partenaireId;
    
    if (!isPartnerTransaction && !data.typeCompte) {
      errors.push('Type de compte requis pour transactions début/fin journée');
    }

    if (!data.typeOperation) {
      errors.push('Type d\'opération requis');
    }

    if (!data.montant || data.montant <= 0) {
      errors.push('Montant doit être supérieur à 0');
    }

    return errors;
  }

  // =====================================
  // MÉTHODES POUR DATES DISPONIBLES ET TESTS
  // =====================================
  async getAvailableDates(userId = null, role = null) {
    try {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      // Dates depuis les snapshots
      const snapshotDates = await prisma.dailySnapshot.findMany({
        where: {
          date: { gte: oneYearAgo },
          ...(userId && { userId })
        },
        select: { date: true },
        distinct: ['date'],
        orderBy: { date: 'desc' }
      });
      
      // Dates avec transactions importantes
      let transactionFilter = {
        createdAt: { gte: oneYearAgo },
        type: { in: ['DEPOT', 'RETRAIT', 'DEBUT_JOURNEE', 'FIN_JOURNEE'] }
      };
      
      if (userId && role === 'SUPERVISEUR') {
        transactionFilter.OR = [
          { destinataireId: userId },
          { envoyeurId: userId }
        ];
      }
      
      const transactionDates = await prisma.transaction.findMany({
        where: transactionFilter,
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' }
      });
      
      // Combiner les dates
      const allDates = new Set();
      
      snapshotDates.forEach(snap => {
        allDates.add(snap.date.toISOString().split('T')[0]);
      });
      
      transactionDates.forEach(tx => {
        const date = new Date(tx.createdAt);
        allDates.add(date.toISOString().split('T')[0]);
      });
      
      // Trier et formater
      const sortedDates = Array.from(allDates).sort((a, b) => new Date(b) - new Date(a));
      
      return sortedDates.slice(0, 60).map(dateStr => {
        const formatted = this.formatDateForDisplay(dateStr);
        return {
          value: dateStr,
          display: formatted.short,
          displayLong: formatted.long,
          hasSnapshots: snapshotDates.some(snap => 
            snap.date.toISOString().split('T')[0] === dateStr
          )
        };
      });
      
    } catch (error) {
      console.error('Erreur getAvailableDates:', error);
      return [];
    }
  }

  async testDateFiltering(testDate) {
    try {
      const validation = this.validateCustomDateTime(testDate);
      if (!validation.valid) {
        return { error: validation.error };
      }
      
      const dateFilter = this.getDateFilter('custom', testDate);
      const includeArchived = await this.shouldIncludeArchivedTransactions('custom', testDate);
      
      const testTransactions = await prisma.transaction.findMany({
        where: {
          createdAt: dateFilter,
          ...(includeArchived ? { archived: true } : {
            OR: [
              { archived: { equals: false } },
              { archived: { equals: null } }
            ]
          })
        },
        select: {
          id: true,
          type: true,
          createdAt: true,
          archived: true,
          destinataire: { select: { nomComplet: true } }
        },
        take: 10,
        orderBy: { createdAt: 'desc' }
      });
      
      return {
        testDate,
        dateFilter: {
          start: dateFilter.gte.toISOString(),
          end: dateFilter.lte.toISOString()
        },
        includeArchived,
        transactionsFound: testTransactions.length,
        sampleTransactions: testTransactions,
        resetConfig: this.getResetConfig(),
        cronStatus: 'Vercel CRON automatique'
      };
      
    } catch (error) {
      console.error('Erreur testDateFiltering:', error);
      return { error: error.message };
    }
  }

  // =====================================
  // MÉTHODES DE DEBUG ET DIAGNOSTIC
  // =====================================
  async debugResetState() {
    try {
      const now = new Date();
      const resetConfig = this.getResetConfig();
      const todayResetTime = new Date(now);
      todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
      
      const [resetStatus, cronStatus, recentTransactions, accountStates] = await Promise.all([
        this.getResetStatus(),
        this.checkCronStatus(),
        prisma.transaction.findMany({
          where: {
            type: { in: ['DEPOT', 'RETRAIT'] },
            partenaireId: { not: null }
          },
          select: {
            id: true,
            type: true,
            createdAt: true,
            archived: true,
            archivedAt: true,
            partenaire: { select: { nomComplet: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 20
        }),
        prisma.account.findMany({
          where: {
            user: { role: 'SUPERVISEUR', status: 'ACTIVE' }
          },
          select: {
            type: true,
            balance: true,
            initialBalance: true,
            previousInitialBalance: true,
            user: { select: { nomComplet: true } }
          }
        })
      ]);
      
      return {
        currentTime: now.toISOString(),
        resetConfig,
        isAfterTodayReset: now > todayResetTime,
        resetStatus,
        cronStatus,
        recentTransactions: recentTransactions.map(tx => ({
          type: tx.type,
          partner: tx.partenaire?.nomComplet,
          createdAt: tx.createdAt.toISOString(),
          archived: tx.archived,
          archivedAt: tx.archivedAt?.toISOString()
        })),
        accountStates: accountStates.map(acc => ({
          user: acc.user.nomComplet,
          type: acc.type,
          balance: this.convertFromInt(acc.balance || 0),
          initialBalance: this.convertFromInt(acc.initialBalance || 0),
          previousInitialBalance: acc.previousInitialBalance ? this.convertFromInt(acc.previousInitialBalance) : null
        })),
        systemMessage: 'Reset géré automatiquement par Vercel CRON à 00h00 UTC'
      };
      
    } catch (error) {
      console.error('Erreur debugResetState:', error);
      return { error: error.message };
    }
  }
}

export default new TransactionService();