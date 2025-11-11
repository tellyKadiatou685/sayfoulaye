// src/services/TransactionService.js - VERSION FINALE AVEC CRON AUTOMATIQUE VERCEL
import prisma from '../config/database.js';
import NotificationService from './NotificationService.js';

class TransactionService {
  // =====================================
  // CONFIGURATION CENTRALISÉE DU RESET
  // =====================================
 static RESET_CONFIG = {
  hour: 0,
  minute: 0,
  windowMinutes: 0
};

  // =====================================
  // SYSTÈME DE NOTIFICATIONS ET AUTO-REFRESHFP
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

  async shouldIncludeArchivedTransactions(period, customDate = null) {
    try {
      const lastResetDate = await this.getLastResetDate();
      const today = new Date().toDateString();
      
      const resetReallyExecutedToday = lastResetDate && 
                                       lastResetDate.includes(today) && 
                                       lastResetDate.includes('SUCCESS');
      
      console.log(`🔍 [RESET CHECK] Aujourd'hui: ${today}, Dernier reset: ${lastResetDate}, Reset exécuté: ${resetReallyExecutedToday}`);
      
      if (period === 'custom' && customDate) {
        const targetDate = new Date(customDate);
        const targetDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        const todayOnly = new Date();
        todayOnly.setHours(0, 0, 0, 0);
        
        if (targetDateOnly < todayOnly) {
          // Date passée (2 oct, 3 oct, etc.)
          const daysSinceTarget = Math.floor((todayOnly - targetDateOnly) / (1000 * 60 * 60 * 24));
          console.log(`📅 [CUSTOM DATE CHECK] Date passée: ${targetDateOnly.toISOString().split('T')[0]}, Jours depuis: ${daysSinceTarget}`);
          console.log(`✅ [CUSTOM DATE CHECK] Utilisation des snapshots`);
          return true;
        } else if (targetDateOnly.getTime() === todayOnly.getTime()) {
          // Date = aujourd'hui (4 oct)
          console.log(`📅 [CUSTOM DATE CHECK] Date = aujourd'hui, données actuelles`);
          return false;
        } else {
          // Date future
          console.log(`⚠️ [CUSTOM DATE CHECK] Date future, pas de données`);
          return false;
        }
      }
      
      if (period === 'yesterday') {
        console.log(`✅ [YESTERDAY CHECK] Utilisation des snapshots pour hier`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ [SHOULD INCLUDE ARCHIVED] Erreur:', error);
      return false;
    }
  }

  // =====================================
// SYSTÈME DE SNAPSHOTS QUOTIDIENS
// =====================================
// À ajouter dans TransactionService.js, juste avant generateReference()

async createDailySnapshot(userId, date = new Date()) {
  try {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    
    console.log(`📸 [SNAPSHOT] Création snapshot pour ${userId} le ${targetDate.toISOString().split('T')[0]}`);
    
    const accounts = await prisma.account.findMany({
      where: { userId },
      select: {
        type: true,
        balance: true,
        initialBalance: true
      }
    });
    
    const snapshotData = {
      date: targetDate,
      userId,
      liquideDebut: 0,
      orangeMoneyDebut: 0,
      waveDebut: 0,
      uvMasterDebut: 0,
      autresDebut: 0,
      liquideFin: 0,
      orangeMoneyFin: 0,
      waveFin: 0,
      uvMasterFin: 0,
      autresFin: 0,
      debutTotal: 0,
      sortieTotal: 0,
      grTotal: 0
    };
    
    accounts.forEach(account => {
      const debut = account.initialBalance;
      const fin = account.balance;
      
      switch (account.type) {
        case 'LIQUIDE':
          snapshotData.liquideDebut = debut;
          snapshotData.liquideFin = fin;
          break;
        case 'ORANGE_MONEY':
          snapshotData.orangeMoneyDebut = debut;
          snapshotData.orangeMoneyFin = fin;
          break;
        case 'WAVE':
          snapshotData.waveDebut = debut;
          snapshotData.waveFin = fin;
          break;
        case 'UV_MASTER':
          snapshotData.uvMasterDebut = debut;
          snapshotData.uvMasterFin = fin;
          break;
        case 'AUTRES':
          snapshotData.autresDebut = debut;
          snapshotData.autresFin = fin;
          break;
      }
      
      snapshotData.debutTotal += Number(debut);
      snapshotData.sortieTotal += Number(fin);
    });
    
    snapshotData.grTotal = snapshotData.sortieTotal - snapshotData.debutTotal;
    
    const snapshot = await prisma.dailySnapshot.upsert({
      where: {
        userId_date: {
          userId,
          date: targetDate
        }
      },
      update: snapshotData,
      create: snapshotData
    });
    
    console.log(`✅ [SNAPSHOT] Snapshot créé pour ${userId}`);
    
    return snapshot;
    
  } catch (error) {
    console.error('❌ [SNAPSHOT] Erreur création snapshot:', error);
    throw error;
  }
}

async createSnapshotsForAllSupervisors(date = new Date()) {
  try {
    console.log(`📸 [BATCH SNAPSHOT] Création snapshots pour tous les superviseurs...`);
    
    const supervisors = await prisma.user.findMany({
      where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
      select: { id: true, nomComplet: true }
    });
    
    const results = await Promise.allSettled(
      supervisors.map(sup => this.createDailySnapshot(sup.id, date))
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`✅ [BATCH SNAPSHOT] ${successful} snapshots créés, ${failed} échecs`);
    
    return { successful, failed, total: supervisors.length };
    
  } catch (error) {
    console.error('❌ [BATCH SNAPSHOT] Erreur:', error);
    throw error;
  }
}

async getSnapshotForDate(userId, targetDate) {
  try {
    const date = new Date(targetDate);
    date.setHours(0, 0, 0, 0);
    
    const snapshot = await prisma.dailySnapshot.findUnique({
      where: {
        userId_date: {
          userId,
          date
        }
      }
    });
    
    if (!snapshot) {
      console.log(`⚠️ [SNAPSHOT] Aucun snapshot trouvé pour ${userId} le ${date.toISOString().split('T')[0]}`);
      return null;
    }
    
    return {
      date: snapshot.date,
      comptes: {
        debut: {
          LIQUIDE: this.convertFromInt(snapshot.liquideDebut),
          ORANGE_MONEY: this.convertFromInt(snapshot.orangeMoneyDebut),
          WAVE: this.convertFromInt(snapshot.waveDebut),
          UV_MASTER: this.convertFromInt(snapshot.uvMasterDebut),
          AUTRES: this.convertFromInt(snapshot.autresDebut)
        },
        sortie: {
          LIQUIDE: this.convertFromInt(snapshot.liquideFin),
          ORANGE_MONEY: this.convertFromInt(snapshot.orangeMoneyFin),
          WAVE: this.convertFromInt(snapshot.waveFin),
          UV_MASTER: this.convertFromInt(snapshot.uvMasterFin),
          AUTRES: this.convertFromInt(snapshot.autresFin)
        }
      },
      totaux: {
        debutTotal: this.convertFromInt(snapshot.debutTotal),
        sortieTotal: this.convertFromInt(snapshot.sortieTotal),
        grTotal: this.convertFromInt(snapshot.grTotal)
      }
    };
    
  } catch (error) {
    console.error('❌ [SNAPSHOT] Erreur récupération snapshot:', error);
    return null;
  }
}

async migrateHistoricalDataToSnapshots(daysBack = 7) {
  try {
    console.log(`🔄 [MIGRATION] Migration des ${daysBack} derniers jours vers snapshots...`);
    
    const supervisors = await prisma.user.findMany({
      where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
      select: { id: true, nomComplet: true }
    });
    
    const results = [];
    
    for (let i = 1; i <= daysBack; i++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - i);
      targetDate.setHours(0, 0, 0, 0);
      
      console.log(`📅 [MIGRATION] Jour -${i}: ${targetDate.toISOString().split('T')[0]}`);
      
      for (const supervisor of supervisors) {
        try {
          const existing = await prisma.dailySnapshot.findUnique({
            where: {
              userId_date: {
                userId: supervisor.id,
                date: targetDate
              }
            }
          });
          
          if (existing) {
            console.log(`⏭️ [MIGRATION] Snapshot existe déjà pour ${supervisor.nomComplet}`);
            continue;
          }
          
          await this.createDailySnapshot(supervisor.id, targetDate);
          results.push({ date: targetDate, userId: supervisor.id, success: true });
          
        } catch (error) {
          console.error(`❌ [MIGRATION] Erreur pour ${supervisor.nomComplet}:`, error.message);
          results.push({ date: targetDate, userId: supervisor.id, success: false, error: error.message });
        }
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`✅ [MIGRATION] Migration terminée: ${successful} réussies, ${failed} échecs`);
    
    return { successful, failed, total: results.length, details: results };
    
  } catch (error) {
    console.error('❌ [MIGRATION] Erreur migration:', error);
    throw error;
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
    console.log(`⚙️ [RESET CONFIG] ${resetConfig.hour}h${resetConfig.minute.toString().padStart(2, '0')}`);
    
    // =====================================
    // DATES PERSONNALISÉES (CUSTOM)
    // =====================================
    if (period === 'custom' && customDate) {
      const targetDate = new Date(customDate);
      
      if (isNaN(targetDate.getTime())) {
        throw new Error('Date invalide');
      }
      
      // Une journée = du reset de ce jour jusqu'à 1 seconde avant le reset du lendemain
      // Exemple : 2 oct = 2 oct 00:00:00 → 2 oct 23:59:59
      const startOfCustom = new Date(targetDate);
      startOfCustom.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
      
      const nextDayReset = new Date(startOfCustom);
      nextDayReset.setDate(nextDayReset.getDate() + 1);
      nextDayReset.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
      
      const endOfCustom = new Date(nextDayReset.getTime() - 1000); // 1 seconde avant le prochain reset
      
      console.log(`📅 [CUSTOM DATE] ${customDate}:`, {
        start: startOfCustom.toISOString(),
        end: endOfCustom.toISOString(),
        startLocal: startOfCustom.toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' }),
        endLocal: endOfCustom.toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' })
      });
      
      return { gte: startOfCustom, lte: endOfCustom };
    }
    
    // =====================================
    // AUTRES PÉRIODES
    // =====================================
    switch (period.toLowerCase()) {
      case 'today':
        // Today = du reset d'aujourd'hui jusqu'à maintenant
        const todayResetTime = new Date(now);
        todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        // Si on n'a pas encore atteint le reset d'aujourd'hui
        // (ex: il est 23h45, reset à minuit pas encore passé)
        // Alors "today" commence au reset d'hier
        let startOfToday;
        if (now < todayResetTime) {
          const yesterdayReset = new Date(todayResetTime);
          yesterdayReset.setDate(yesterdayReset.getDate() - 1);
          startOfToday = yesterdayReset;
        } else {
          startOfToday = todayResetTime;
        }
        
        console.log(`📅 [TODAY]:`, {
          start: startOfToday.toISOString(),
          end: now.toISOString(),
          startLocal: startOfToday.toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' }),
          endLocal: now.toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' })
        });
        
        return { gte: startOfToday, lte: now };
  
      case 'yesterday':
        // Yesterday = du reset d'hier jusqu'à 1 seconde avant le reset d'aujourd'hui
        const yesterdayResetTime = new Date(now);
        yesterdayResetTime.setDate(now.getDate() - 1);
        yesterdayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        const todayResetTimeForYesterday = new Date(now);
        todayResetTimeForYesterday.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        const startOfYesterday = yesterdayResetTime;
        const endOfYesterday = new Date(todayResetTimeForYesterday.getTime() - 1000); // 1 seconde avant
        
        console.log(`📅 [YESTERDAY]:`, {
          start: startOfYesterday.toISOString(),
          end: endOfYesterday.toISOString(),
          startLocal: startOfYesterday.toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' }),
          endLocal: endOfYesterday.toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' })
        });
        
        return { gte: startOfYesterday, lte: endOfYesterday };
  
      case 'week':
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        weekAgo.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        console.log(`📅 [WEEK]:`, {
          start: weekAgo.toISOString(),
          end: now.toISOString()
        });
        
        return { gte: weekAgo, lte: now };
  
      case 'month':
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        console.log(`📅 [MONTH]:`, {
          start: startOfMonth.toISOString(),
          end: now.toISOString()
        });
        
        return { gte: startOfMonth, lte: now };
  
      case 'year':
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        startOfYear.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        console.log(`📅 [YEAR]:`, {
          start: startOfYear.toISOString(),
          end: now.toISOString()
        });
        
        return { gte: startOfYear, lte: now };
  
      case 'all':
        console.log(`📅 [ALL] Pas de filtre de date`);
        return {};
  
      default:
        // Par défaut : journée entière basée sur le reset
        const defaultStart = new Date(now);
        defaultStart.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        
        console.log(`📅 [DEFAULT]:`, {
          start: defaultStart.toISOString(),
          end: now.toISOString()
        });
        
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
      const { 
        superviseurId, 
        typeCompte, 
        typeOperation, 
        montant, 
        partenaireId,
        partenaireNom  // NOUVEAU : nom libre du partenaire
      } = transactionData;
  
      const montantFloat = parseFloat(montant);
      if (isNaN(montantFloat) || montantFloat <= 0) {
        throw new Error('Montant invalide');
      }
  
      const montantInt = this.convertToInt(montantFloat);
  
      // Vérification du superviseur
      const supervisor = await prisma.user.findUnique({
        where: { id: superviseurId, role: 'SUPERVISEUR' },
        select: { id: true, nomComplet: true, status: true }
      });
  
      if (!supervisor) {
        throw new Error('Superviseur non trouvé');
      }
  
      // NOUVEAU : Logique partenaire améliorée
      const isPartnerTransaction = !!(partenaireId || partenaireNom);
      let partner = null;
      let partnerDisplayName = '';
  
      if (isPartnerTransaction) {
        if (partenaireId) {
          // Partenaire enregistré
          partner = await prisma.user.findUnique({
            where: { id: partenaireId, role: 'PARTENAIRE' },
            select: { id: true, nomComplet: true, status: true }
          });
          
          if (!partner) {
            throw new Error('Partenaire enregistré non trouvé');
          }
          partnerDisplayName = partner.nomComplet;
        } else if (partenaireNom) {
          // Partenaire libre (non enregistré)
          partnerDisplayName = partenaireNom.trim();
          
          if (!partnerDisplayName || partnerDisplayName.length < 2) {
            throw new Error('Nom du partenaire invalide (minimum 2 caractères)');
          }
        }
      }
  
      // TRAITEMENT DES TRANSACTIONS PARTENAIRES
      if (isPartnerTransaction) {
        let transactionType, description;
        
        if (typeOperation === 'depot') {
          transactionType = 'DEPOT';
          description = `Dépôt partenaire ${partnerDisplayName}`;
        } else {
          transactionType = 'RETRAIT';
          description = `Retrait partenaire ${partnerDisplayName}`;
        }
  
        const result = await prisma.$transaction(async (tx) => {
          const transactionData = {
            montant: montantInt,
            type: transactionType,
            description,
            envoyeurId: adminId,
            destinataireId: superviseurId
          };
  
          // NOUVEAU : Ajouter partenaireId OU partenaireNom
          if (partenaireId) {
            transactionData.partenaireId = partenaireId;
          } else if (partenaireNom) {
            transactionData.partenaireNom = partenaireNom.trim();
          }
  
          const transaction = await tx.transaction.create({
            data: transactionData,
            select: {
              id: true,
              type: true,
              description: true,
              createdAt: true,
              partenaireNom: true
            }
          });
  
          return { transaction, updatedAccount: null };
        });
  
        // Notification asynchrone
        setImmediate(async () => {
          try {
            let notificationTitle, notificationMessage, notificationType;
  
            if (typeOperation === 'depot') {
              notificationTitle = 'Nouveau dépôt partenaire';
              notificationMessage = `${partnerDisplayName} a déposé ${this.formatAmount(montantFloat)}`;
              notificationType = 'DEPOT_PARTENAIRE';
            } else {
              notificationTitle = 'Nouveau retrait partenaire';
              notificationMessage = `${partnerDisplayName} a retiré ${this.formatAmount(montantFloat)}`;
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
            partnerName: partnerDisplayName,
            partnerId: partenaireId || null,
            partenaireNom: result.transaction.partenaireNom || null,
            isRegisteredPartner: !!partenaireId,
            transactionCategory: 'PARTENAIRE'
          },
          accountUpdated: false
        };
  
      } else {
        // LOGIQUE EXISTANTE POUR DÉBUT/FIN JOURNÉE (inchangée)
        let account = await prisma.account.upsert({
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
  
        let transactionType, description, balanceUpdate;
        
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
            partenaireNom: null,
            isRegisteredPartner: false,
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



  getPartnerDisplayName(transaction) {
    // Priorité : partenaire enregistré > nom libre
    if (transaction.partenaire?.nomComplet) {
      return transaction.partenaire.nomComplet;
    }
    if (transaction.partenaireNom) {
      return transaction.partenaireNom;
    }
    return 'Partenaire inconnu';
  }


  filterUnusedAccounts(accountsByType) {
    const filtered = { debut: {}, sortie: {} };
    
    // Liste des comptes à TOUJOURS afficher même si vides
    const alwaysShow = ['LIQUIDE', 'ORANGE_MONEY', 'UV_MASTER'];
    
    // Types de comptes à masquer si vides (Wave, Autres)
    const hideIfZero = ['WAVE', 'AUTRES'];
    
    // Filtrer les comptes de début
    Object.entries(accountsByType.debut).forEach(([accountType, value]) => {
      // Garder les partenaires
      if (accountType.startsWith('part-')) {
        filtered.debut[accountType] = value;
        return;
      }
      
      // Garder les comptes à toujours afficher
      if (alwaysShow.includes(accountType)) {
        filtered.debut[accountType] = value;
        return;
      }
      
      // Pour Wave et Autres : ne garder que si valeur non nulle
      if (hideIfZero.includes(accountType)) {
        const debutValue = value || 0;
        const sortieValue = accountsByType.sortie[accountType] || 0;
        
        // Afficher seulement si au moins une des valeurs est non nulle
        if (debutValue !== 0 || sortieValue !== 0) {
          filtered.debut[accountType] = value;
        }
      }
    });
    
    // Filtrer les comptes de sortie
    Object.entries(accountsByType.sortie).forEach(([accountType, value]) => {
      // Garder les partenaires
      if (accountType.startsWith('part-')) {
        filtered.sortie[accountType] = value;
        return;
      }
      
      // Garder les comptes à toujours afficher
      if (alwaysShow.includes(accountType)) {
        filtered.sortie[accountType] = value;
        return;
      }
      
      // Pour Wave et Autres : ne garder que si valeur non nulle
      if (hideIfZero.includes(accountType)) {
        const debutValue = accountsByType.debut[accountType] || 0;
        const sortieValue = value || 0;
        
        // Afficher seulement si au moins une des valeurs est non nulle
        if (debutValue !== 0 || sortieValue !== 0) {
          filtered.sortie[accountType] = value;
        }
      }
    });
    
    return filtered;
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

 // REMPLACER COMPLÈTEMENT la méthode forceReset() existante par celle-ci

async forceReset(adminId = 'vercel-cron') {
  try {
    console.log(`🤖 [CRON RESET ${adminId.toUpperCase()}] Lancement du reset automatique...`);
    
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    // ÉTAPE 0 : Créer les snapshots AVANT le reset
    console.log('📸 [CRON RESET] Étape 0/5 - Création des snapshots quotidiens...');
    const snapshotResult = await this.createSnapshotsForAllSupervisors(yesterday);
    console.log(`✅ [CRON RESET] ${snapshotResult.successful} snapshots créés pour hier`);
    
    // ÉTAPE 1 : Archiver les transactions partenaires d'hier
    console.log('📦 [CRON RESET] Étape 1/5 - Archivage des transactions partenaires...');
    const archivedCount = await this.archivePartnerTransactionsDynamic();
    
    // ÉTAPE 2 : Transférer les soldes (sortie → début)
    console.log('💰 [CRON RESET] Étape 2/5 - Transfert des soldes...');
    await this.transferBalancesToInitial();
    
    // ÉTAPE 3 : Nettoyage des données temporaires
    console.log('🧹 [CRON RESET] Étape 3/5 - Nettoyage des données...');
    const cleanedCount = await this.cleanupDashboardAfterReset();
    
    // ÉTAPE 4 : Enregistrer le succès du reset
    console.log('💾 [CRON RESET] Étape 4/5 - Enregistrement du reset...');
    const resetKey = `${now.toDateString()}-SUCCESS-${now.getHours()}h${now.getMinutes()}-${adminId}`;
    await this.saveResetDate(resetKey);
    
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true }
    });
    
    await prisma.transaction.create({
      data: {
        montant: 0,
        type: 'AUDIT_MODIFICATION',
        description: `Reset automatique ${adminId} - ${snapshotResult.successful} snapshots, ${archivedCount} archivées, ${cleanedCount} nettoyées`,
        envoyeurId: adminUser?.id || 'cmffpzf8e0000248t0hu4w1gr'
      }
    });
    
    console.log(`✅ [CRON RESET ${adminId.toUpperCase()}] Reset terminé avec succès!`);
    console.log(`📊 [CRON RESET] Résultats: ${snapshotResult.successful} snapshots, ${archivedCount} transactions archivées, ${cleanedCount} nettoyées`);
    
    // ÉTAPE 5 : Envoyer les notifications
    console.log('📢 [CRON RESET] Étape 5/5 - Envoi des notifications...');
    const notificationResult = await this.notifyDashboardRefresh({
      archivedCount,
      cleanedCount,
      snapshotsCreated: snapshotResult.successful,
      executedAt: now.toISOString()
    });
    
    console.log(`✅ [CRON RESET] ${notificationResult.successful} notifications envoyées sur ${notificationResult.totalNotifications}`);
    
    return {
      success: true,
      snapshotsCreated: snapshotResult.successful,
      archivedCount,
      cleanedCount,
      executedAt: now.toISOString(),
      type: adminId,
      notifications: notificationResult,
      message: `Reset automatique ${adminId} exécuté avec succès à ${now.toISOString()}`
    };
    
  } catch (error) {
    console.error(`❌ [CRON RESET ${adminId.toUpperCase()}] Erreur:`, error);
    
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


  validateAdminTransactionData(data) {
    const errors = [];
  
    if (!data.superviseurId) {
      errors.push('Superviseur requis');
    }
  
    // NOUVEAU : Validation partenaire améliorée
    const hasPartenaireId = !!data.partenaireId;
    const hasPartenaireNom = !!data.partenaireNom;
    const isPartnerTransaction = hasPartenaireId || hasPartenaireNom;
  
    if (hasPartenaireId && hasPartenaireNom) {
      errors.push('Choisissez soit un partenaire enregistré, soit un nom libre (pas les deux)');
    }
  
    if (!isPartnerTransaction && !data.typeCompte) {
      errors.push('Type de compte requis pour transactions début/fin journée');
    }
  
    if (!data.typeOperation) {
      errors.push('Type d\'opération requis');
    }
  
    if (!data.montant || data.montant <= 0) {
      errors.push('Montant doit être supérieur à 0');
    }
  
    if (hasPartenaireNom) {
      const nomTrimmed = data.partenaireNom.trim();
      if (nomTrimmed.length < 2) {
        errors.push('Nom du partenaire doit contenir au moins 2 caractères');
      }
      if (nomTrimmed.length > 100) {
        errors.push('Nom du partenaire trop long (maximum 100 caractères)');
      }
    }
  
    return errors;
  }
  // =====================================
 // =====================================
// MÉTHODE COMPLÈTE CORRIGÉE : getAdminDashboard
// À REMPLACER dans TransactionService.js (ligne ~1900)
// =====================================

async getAdminDashboard(period = 'today', customDate = null) {
  try {
    console.log(`📊 [ADMIN DASHBOARD] Période: ${period}, Date: ${customDate}`);
    
    const dateFilter = this.getDateFilter(period, customDate);
    const includeArchived = await this.shouldIncludeArchivedTransactions(period, customDate);
    
    // Déterminer la date cible pour les snapshots
    let snapshotDate = null;
    if (includeArchived) {
      if (period === 'yesterday') {
        snapshotDate = new Date();
        snapshotDate.setDate(snapshotDate.getDate() - 1);
        snapshotDate.setHours(0, 0, 0, 0);
      } else if (period === 'custom' && customDate) {
        snapshotDate = new Date(customDate);
        snapshotDate.setHours(0, 0, 0, 0);
      }
      console.log(`📸 [ADMIN DASHBOARD] Date snapshot cible: ${snapshotDate?.toISOString().split('T')[0]}`);
    }
    
    let transactionFilter = { createdAt: dateFilter };

    if (snapshotDate) {
      console.log(`📋 [ADMIN DASHBOARD] Chargement transactions pour date avec snapshot`);
    } else if (includeArchived && period === 'yesterday') {
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
            partenaireNom: true,
            archived: true,
            archivedAt: true,
            createdAt: true,
            metadata: true, // ✅ IMPORTANT : Charger metadata
            partenaire: {
              select: { nomComplet: true }
            }
          }
        }
      },
      orderBy: { nomComplet: 'asc' }
    });

    let totalDebutGlobal = 0, totalSortieGlobal = 0, uvMasterSolde = 0, uvMasterSorties = 0;

    const supervisorCards = await Promise.all(supervisors.map(async (supervisor) => {
      const accountsByType = { debut: {}, sortie: {} };

      // ========================================
      // SECTION 1 : CHARGEMENT DES COMPTES
      // ========================================
      if (snapshotDate) {
        // CAS 1 : Date passée (hier ou custom passée)
        const snapshot = await this.getSnapshotForDate(supervisor.id, snapshotDate);
        
        if (snapshot) {
          console.log(`📸 [DASHBOARD] ✅ Snapshot trouvé pour ${supervisor.nomComplet} le ${snapshotDate.toISOString().split('T')[0]}`);
          
          Object.assign(accountsByType.debut, snapshot.comptes.debut);
          Object.assign(accountsByType.sortie, snapshot.comptes.sortie);
          
          if (snapshot.comptes.sortie.UV_MASTER) {
            uvMasterSorties += snapshot.comptes.sortie.UV_MASTER;
            uvMasterSolde += snapshot.comptes.debut.UV_MASTER;
          }
        } else {
          console.log(`⚠️ [DASHBOARD] Pas de snapshot, fallback previousInitialBalance pour ${supervisor.nomComplet}`);
          
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
        }
      } else {
        // CAS 2 : Données actuelles (today)
        console.log(`📊 [DASHBOARD] Chargement données actuelles pour ${supervisor.nomComplet}`);
        console.log(`📊 [DASHBOARD] Nombre de comptes: ${supervisor.accounts.length}`);
        
        supervisor.accounts.forEach(account => {
          const initial = this.convertFromInt(account.initialBalance || 0);
          const current = this.convertFromInt(account.balance || 0);
          
          console.log(`   - ${account.type}: début=${initial}, sortie=${current}`);
          
          accountsByType.debut[account.type] = initial;
          accountsByType.sortie[account.type] = current;
          
          if (account.type === 'UV_MASTER') {
            uvMasterSorties += current;
            uvMasterSolde += initial;
          }
        });
      }

      // ========================================
      // SECTION 2 : TRAITEMENT DES PARTENAIRES
      // ========================================
      
      // ✅ CORRECTION : Filtrer les transactions supprimées
      const activePartnerTransactions = this.filterDeletedTransactions(
        supervisor.transactionsRecues, 
        `ADMIN_DASHBOARD_${supervisor.nomComplet}`
      );

      const partenaireTransactions = {};
      activePartnerTransactions.forEach(tx => {
        const partnerName = this.getPartnerDisplayName(tx);
        
        if (partnerName && partnerName !== 'Partenaire inconnu') {
          const montant = this.convertFromInt(tx.montant);
          
          if (!partenaireTransactions[partnerName]) {
            partenaireTransactions[partnerName] = { 
              depots: 0, 
              retraits: 0,
              isRegistered: !!tx.partenaireId
            };
          }
          
          if (tx.type === 'DEPOT') {
            partenaireTransactions[partnerName].depots += montant;
          } else if (tx.type === 'RETRAIT') {
            partenaireTransactions[partnerName].retraits += montant;
          }
        }
      });

      // Ajouter les partenaires aux comptes
      Object.entries(partenaireTransactions).forEach(([partnerName, amounts]) => {
        if (amounts.depots > 0) {
          accountsByType.debut[`part-${partnerName}`] = amounts.depots;
        }
        if (amounts.retraits > 0) {
          accountsByType.sortie[`part-${partnerName}`] = amounts.retraits;
        }
      });

      // ========================================
      // SECTION 3 : CALCUL DES TOTAUX
      // ========================================
      const debutTotal = Object.values(accountsByType.debut).reduce((sum, val) => sum + val, 0);
      const sortieTotal = Object.values(accountsByType.sortie).reduce((sum, val) => sum + val, 0);
      const grTotal = sortieTotal - debutTotal;

      totalDebutGlobal += debutTotal;
      totalSortieGlobal += sortieTotal;

      console.log(`📊 [DASHBOARD] ${supervisor.nomComplet}: début=${debutTotal}, sortie=${sortieTotal}, partenaires actifs=${Object.keys(partenaireTransactions).length}`);

      return {
        id: supervisor.id,
        nom: supervisor.nomComplet,
        status: supervisor.status,
        comptes: this.filterUnusedAccounts(accountsByType), 
        totaux: {
          debutTotal, 
          sortieTotal, 
          grTotal,
          formatted: {
            debutTotal: this.formatAmount(debutTotal),
            sortieTotal: this.formatAmount(sortieTotal),
            grTotal: this.formatAmount(grTotal, true)
          }
        }
      };
    }));

    // ========================================
    // SECTION 4 : TOTAUX GLOBAUX
    // ========================================
    const globalTotals = {
      uvMaster: {
        solde: uvMasterSolde, 
        sorties: uvMasterSorties,
        formatted: { 
          solde: this.formatAmount(uvMasterSolde), 
          sorties: this.formatAmount(uvMasterSorties) 
        }
      },
      debutTotalGlobal: totalDebutGlobal, 
      sortieTotalGlobal: totalSortieGlobal,
      grTotalGlobal: totalSortieGlobal - totalDebutGlobal,
      formatted: {
        debutTotalGlobal: this.formatAmount(totalDebutGlobal),
        sortieTotalGlobal: this.formatAmount(totalSortieGlobal),
        grTotalGlobal: this.formatAmount(totalSortieGlobal - totalDebutGlobal, true)
      }
    };

    console.log(`✅ [ADMIN DASHBOARD] Génération terminée - ${supervisorCards.length} superviseurs traités`);

    return {
      period, 
      customDate, 
      globalTotals, 
      supervisorCards,
      dynamicConfig: {
        resetConfig: this.getResetConfig(), 
        includeArchived,
        targetDateTime: customDate,
        filterApplied: includeArchived ? 'archived_included' : 'archived_excluded',
        dataSource: snapshotDate ? 'historical_snapshot' : 'current_live',
        snapshotDate: snapshotDate?.toISOString().split('T')[0],
        cronStatus: 'Vercel CRON géré automatiquement',
        deletedTransactionsFiltered: true // ✅ Indicateur de filtrage actif
      }
    };

  } catch (error) {
    console.error('❌ [ADMIN DASHBOARD] Erreur getAdminDashboard:', error);
    throw error;
  }
}

// =====================================
// HELPER : Filtrer les transactions supprimées
// À AJOUTER juste après getAdminDashboard
// =====================================

/**
 * Filtre les transactions en excluant celles marquées comme supprimées
 * @param {Array} transactions - Liste des transactions à filtrer
 * @param {String} context - Contexte pour les logs
 * @returns {Array} - Transactions actives (non supprimées)
 */
filterDeletedTransactions(transactions, context = 'FILTER') {
  if (!transactions || !Array.isArray(transactions)) {
    console.warn(`⚠️ [${context}] Transactions invalides`, transactions);
    return [];
  }

  const activeTransactions = transactions.filter(tx => {
    // Pas de metadata = transaction valide
    if (!tx.metadata) return true;
    
    try {
      const metadata = typeof tx.metadata === 'string' 
        ? JSON.parse(tx.metadata) 
        : tx.metadata;
      
      // Exclure si marquée comme supprimée
      if (metadata.deleted === true) {
        console.log(`🚫 [${context}] Transaction ${tx.id} supprimée, exclue (deletedAt: ${metadata.deletedAt})`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.warn(`⚠️ [${context}] Erreur parsing metadata tx ${tx.id}:`, error);
      return true; // En cas d'erreur, on garde la transaction par sécurité
    }
  });

  const excludedCount = transactions.length - activeTransactions.length;
  
  if (excludedCount > 0) {
    console.log(`🔍 [${context}] ${excludedCount} transaction(s) supprimée(s) exclue(s), ${activeTransactions.length} restante(s)`);
  }

  return activeTransactions;
}
  
  // REMPLACER la section "Cas date passée sans snapshot" dans getSupervisorDashboard
// =====================================
// MÉTHODE COMPLÈTE CORRIGÉE : getSupervisorDashboard
// À REMPLACER dans TransactionService.js (ligne ~2100)
// =====================================

async getSupervisorDashboard(superviseurId, period = 'today', customDate = null) {
  try {
    const dateFilter = this.getDateFilter(period, customDate);
    const includeArchived = await this.shouldIncludeArchivedTransactions(period, customDate);
    
    console.log(`📊 [SUPERVISOR DASHBOARD] Superviseur: ${superviseurId}, Period: ${period}, Include archived: ${includeArchived}`);
    
    // Déterminer la date snapshot
    let snapshotDate = null;
    if (includeArchived) {
      if (period === 'yesterday') {
        snapshotDate = new Date();
        snapshotDate.setDate(snapshotDate.getDate() - 1);
        snapshotDate.setHours(0, 0, 0, 0);
      } else if (period === 'custom' && customDate) {
        const targetDate = new Date(customDate);
        const targetDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        const todayOnly = new Date();
        todayOnly.setHours(0, 0, 0, 0);
        
        if (targetDateOnly < todayOnly) {
          snapshotDate = targetDate;
          snapshotDate.setHours(0, 0, 0, 0);
        }
      }
      console.log(`📸 [SUPERVISOR DASHBOARD] Date snapshot cible: ${snapshotDate?.toISOString().split('T')[0]}`);
    }
    
    // Filtre transactions
    let transactionFilter = { 
      createdAt: dateFilter,
      AND: [{ OR: [{ envoyeurId: superviseurId }, { destinataireId: superviseurId }] }]
    };

    if (!snapshotDate) {
      // Données actuelles : exclure les transactions archivées
      transactionFilter = {
        ...transactionFilter,
        OR: [{ archived: { equals: false } }, { archived: { equals: null } }]
      };
    }

    // Charger les données
    const [supervisor, allTransactions, uvMasterAccounts] = await Promise.all([
      prisma.user.findUnique({
        where: { id: superviseurId },
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
          }
        }
      }),
      // Ne charger les transactions que si pas de snapshot
      snapshotDate ? Promise.resolve([]) : prisma.transaction.findMany({
        where: transactionFilter,
        select: {
          id: true, 
          type: true, 
          montant: true, 
          description: true, 
          createdAt: true,
          envoyeurId: true, 
          destinataireId: true, 
          partenaireId: true, 
          partenaireNom: true,
          archived: true,
          metadata: true, // ✅ IMPORTANT
          destinataire: { select: { nomComplet: true } },
          envoyeur: { select: { nomComplet: true } },
          partenaire: { select: { nomComplet: true } }
        },
        orderBy: { createdAt: 'desc' }, 
        take: 50
      }),
      prisma.account.findMany({
        where: { 
          type: 'UV_MASTER', 
          user: { role: 'SUPERVISEUR', status: 'ACTIVE' } 
        },
        select: { 
          balance: true, 
          initialBalance: true, 
          previousInitialBalance: true 
        }
      })
    ]);

    if (!supervisor) throw new Error('Superviseur non trouvé');

    // ========================================
    // CAS SPÉCIAL : Date passée sans snapshot
    // ========================================
    if (snapshotDate && allTransactions.length === 0) {
      const snapshot = await this.getSnapshotForDate(superviseurId, snapshotDate);
      
      if (!snapshot) {
        console.log(`⚠️ [SUPERVISOR DASHBOARD] Pas de snapshot pour ${snapshotDate.toISOString().split('T')[0]}`);
        
        return {
          superviseur: { 
            id: supervisor.id, 
            nom: supervisor.nomComplet, 
            status: supervisor.status 
          },
          period, 
          customDate,
          uvMaster: { 
            personal: { debut: 0, sortie: 0, formatted: "0 F" }, 
            total: 0, 
            formatted: "0 F" 
          },
          comptes: { debut: {}, sortie: {} },
          totaux: {
            debutTotal: 0, 
            sortieTotal: 0, 
            grTotal: 0,
            formatted: { 
              debutTotal: "0 F", 
              sortieTotal: "0 F", 
              grTotal: "0 F" 
            }
          },
          recentTransactions: [],
          dynamicConfig: {
            period, 
            customDate, 
            resetConfig: this.getResetConfig(), 
            includeArchived,
            totalTransactionsFound: 0, 
            filterApplied: 'snapshot_not_found', 
            dataSource: 'no_data', 
            snapshotDate: snapshotDate.toISOString().split('T')[0],
            deletedTransactionsFiltered: false
          }
        };
      }
    }

    const accountsByType = { debut: {}, sortie: {} };
    let totalDebutPersonnel = 0, totalSortiePersonnel = 0;

    // ========================================
    // SECTION 1 : CHARGEMENT DES COMPTES
    // ========================================
    if (snapshotDate) {
      // CAS 1 : DONNÉES HISTORIQUES VIA SNAPSHOT
      const snapshot = await this.getSnapshotForDate(superviseurId, snapshotDate);
      
      if (snapshot) {
        console.log(`📸 [SUPERVISOR DASHBOARD] ✅ Snapshot trouvé pour ${supervisor.nomComplet} le ${snapshotDate.toISOString().split('T')[0]}`);
        
        // Récupérer les comptes standards depuis le snapshot
        Object.assign(accountsByType.debut, snapshot.comptes.debut);
        Object.assign(accountsByType.sortie, snapshot.comptes.sortie);
        
        totalDebutPersonnel = snapshot.totaux.debutTotal;
        totalSortiePersonnel = snapshot.totaux.sortieTotal;

        // ========================================
        // ✅ CORRECTION CRITIQUE : Charger les transactions partenaires pour HIER
        // ========================================
        console.log(`📦 [SUPERVISOR DASHBOARD] Chargement des transactions partenaires pour HIER...`);
        
        const { startOfYesterday, endOfYesterday } = this.getYesterdayRange();
        
        // Charger TOUTES les transactions partenaires d'hier
        const allYesterdayPartnerTransactions = await prisma.transaction.findMany({
          where: {
            destinataireId: superviseurId,
            type: { in: ['DEPOT', 'RETRAIT'] },
            OR: [
              { partenaireId: { not: null } },
              { partenaireNom: { not: null } }
            ],
            createdAt: {
              gte: startOfYesterday,
              lte: endOfYesterday
            }
          },
          select: {
            id: true,
            type: true,
            montant: true,
            partenaireId: true,
            partenaireNom: true,
            createdAt: true,
            archived: true,
            metadata: true, // ✅ CRITIQUE
            partenaire: { select: { nomComplet: true } }
          }
        });

        console.log(`📊 [SUPERVISOR DASHBOARD] ${allYesterdayPartnerTransactions.length} transactions partenaires trouvées pour HIER (avant filtrage)`);

        // ✅ FILTRER les transactions supprimées
        const yesterdayPartnerTransactions = this.filterDeletedTransactions(
          allYesterdayPartnerTransactions, 
          `SUPERVISOR_DASHBOARD_HIER_${supervisor.nomComplet}`
        );

        console.log(`📊 [SUPERVISOR DASHBOARD] ${yesterdayPartnerTransactions.length} transactions partenaires actives pour HIER (après filtrage)`);

        if (yesterdayPartnerTransactions.length > 0) {
          console.log(`🔍 [DEBUG] Détail des transactions HIER non supprimées:`);
          yesterdayPartnerTransactions.forEach(tx => {
            console.log(`   - ${tx.type} ${this.convertFromInt(tx.montant)} F à ${tx.createdAt.toISOString()}`);
            console.log(`     partenaire: ${tx.partenaire?.nomComplet || tx.partenaireNom || 'INCONNU'}`);
          });
        }

        // Ajouter les transactions partenaires aux comptes
        const partenaireTransactions = {};
        yesterdayPartnerTransactions.forEach(tx => {
          const partnerName = this.getPartnerDisplayName(tx);
          
          if (partnerName && partnerName !== 'Partenaire inconnu') {
            const montant = this.convertFromInt(tx.montant);
            
            if (!partenaireTransactions[partnerName]) {
              partenaireTransactions[partnerName] = { 
                depots: 0, 
                retraits: 0,
                isRegistered: !!tx.partenaireId
              };
            }
            
            if (tx.type === 'DEPOT') {
              partenaireTransactions[partnerName].depots += montant;
            } else if (tx.type === 'RETRAIT') {
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

        console.log(`✅ [SUPERVISOR DASHBOARD] Totaux avec partenaires HIER: début=${totalDebutPersonnel} F, sortie=${totalSortiePersonnel} F`);
        
      } else {
        console.log(`⚠️ [SUPERVISOR DASHBOARD] Pas de snapshot, fallback previousInitialBalance`);
        
        supervisor.accounts.forEach(account => {
          const ancienDebutHier = this.convertFromInt(account.previousInitialBalance || 0);
          const ancienneSortieHier = this.convertFromInt(account.initialBalance || 0);
          
          accountsByType.debut[account.type] = ancienDebutHier;
          accountsByType.sortie[account.type] = ancienneSortieHier;
          
          totalDebutPersonnel += ancienDebutHier;
          totalSortiePersonnel += ancienneSortieHier;
        });
      }
    } else {
      // CAS 2 : DONNÉES ACTUELLES (TODAY)
      console.log(`📊 [SUPERVISOR DASHBOARD] Chargement données actuelles pour ${supervisor.nomComplet}`);
      
      supervisor.accounts.forEach(account => {
        const initial = this.convertFromInt(account.initialBalance || 0);
        const current = this.convertFromInt(account.balance || 0);

        accountsByType.debut[account.type] = initial;
        accountsByType.sortie[account.type] = current;
        
        totalDebutPersonnel += initial;
        totalSortiePersonnel += current;
      });

      // ✅ TRAITEMENT PARTENAIRES TODAY (avec filtrage)
      const activeTransactions = this.filterDeletedTransactions(
        allTransactions, 
        `SUPERVISOR_DASHBOARD_TODAY_${supervisor.nomComplet}`
      );

      const partenaireTransactions = {};
      activeTransactions.forEach(tx => {
        const partnerName = this.getPartnerDisplayName(tx);
        
        if (partnerName && partnerName !== 'Partenaire inconnu') {
          const montant = this.convertFromInt(tx.montant);
          
          if (!partenaireTransactions[partnerName]) {
            partenaireTransactions[partnerName] = { 
              depots: 0, 
              retraits: 0,
              isRegistered: !!tx.partenaireId
            };
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
    }

    // ========================================
    // SECTION 2 : UV MASTER GLOBAL
    // ========================================
    let uvMasterDebut, uvMasterSortie;
    if (snapshotDate) {
      // Utiliser previousInitialBalance pour hier
      uvMasterDebut = uvMasterAccounts.reduce((total, account) => 
        total + this.convertFromInt(account.previousInitialBalance || 0), 0);
      uvMasterSortie = uvMasterAccounts.reduce((total, account) => 
        total + this.convertFromInt(account.initialBalance || 0), 0);
    } else {
      // Données actuelles
      uvMasterDebut = uvMasterAccounts.reduce((total, account) => 
        total + this.convertFromInt(account.initialBalance || 0), 0);
      uvMasterSortie = uvMasterAccounts.reduce((total, account) => 
        total + this.convertFromInt(account.balance || 0), 0);
    }

    const grTotal = totalSortiePersonnel - totalDebutPersonnel;

    // ========================================
    // SECTION 3 : TRANSACTIONS RÉCENTES
    // ========================================
    const recentTransactions = snapshotDate ? [] : this.filterDeletedTransactions(
      allTransactions, 
      `SUPERVISOR_RECENT_${supervisor.nomComplet}`
    ).map(tx => {
      let personne = '';
      
      if (tx.partenaireId || tx.partenaireNom) {
        personne = `${this.getPartnerDisplayName(tx)} (Partenaire)`;
      } else if (tx.envoyeurId === superviseurId) {
        personne = tx.destinataire?.nomComplet || 'Destinataire inconnu';
      } else if (tx.destinataireId === superviseurId) {
        personne = tx.envoyeur?.nomComplet || 'Expéditeur inconnu';
      }
      
      if (['DEBUT_JOURNEE', 'FIN_JOURNEE'].includes(tx.type)) {
        personne = supervisor.nomComplet;
      }

      return {
        id: tx.id, 
        type: tx.type, 
        montant: this.convertFromInt(tx.montant),
        description: tx.description, 
        personne, 
        createdAt: tx.createdAt,
        envoyeurId: tx.envoyeurId, 
        destinataireId: tx.destinataireId,
        partenaireId: tx.partenaireId, 
        partenaireNom: tx.partenaireNom,
        archived: tx.archived
      };
    });

    return {
      superviseur: { 
        id: supervisor.id, 
        nom: supervisor.nomComplet, 
        status: supervisor.status 
      },
      period, 
      customDate,
      uvMaster: {
        personal: { 
          debut: uvMasterDebut, 
          sortie: uvMasterSortie, 
          formatted: uvMasterSortie.toLocaleString() + ' F' 
        },
        total: uvMasterSortie, 
        formatted: uvMasterSortie.toLocaleString() + ' F'
      },
      comptes: this.filterUnusedAccounts(accountsByType),
      totaux: {
        debutTotal: totalDebutPersonnel, 
        sortieTotal: totalSortiePersonnel, 
        grTotal,
        formatted: {
          debutTotal: totalDebutPersonnel.toLocaleString() + ' F',
          sortieTotal: totalSortiePersonnel.toLocaleString() + ' F',
          grTotal: this.formatAmount(grTotal, true)
        }
      },
      recentTransactions,
      dynamicConfig: {
        period, 
        customDate, 
        resetConfig: this.getResetConfig(), 
        includeArchived,
        totalTransactionsFound: allTransactions.length,
        partnerTransactionsFound: snapshotDate ? 'voir comptes part-*' : allTransactions.filter(tx => tx.partenaireId || tx.partenaireNom).length,
        filterApplied: snapshotDate ? 'historical_snapshot' : 'current_live',
        dataSource: snapshotDate ? 'historical_snapshot_with_archived_partners' : 'current_live',
        snapshotDate: snapshotDate?.toISOString().split('T')[0],
        cronStatus: 'Vercel CRON géré automatiquement',
        deletedTransactionsFiltered: true, // ✅ Indicateur de filtrage actif
        note: snapshotDate 
          ? 'Données historiques (suppressions n\'affectent que today) + transactions partenaires filtrées' 
          : 'Données en temps réel avec transactions supprimées exclues'
      }
    };

  } catch (error) {
    console.error('❌ [SUPERVISOR DASHBOARD] Erreur getSupervisorDashboard:', error);
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
// EXPORT EXCEL DES DONNÉES
// =====================================
// À AJOUTER à la fin de votre TransactionService.js, juste avant : export default new TransactionService();

async exportDailyDataToExcel(period = 'today', customDate = null) {
  try {
    console.log(`📊 [EXPORT EXCEL] Génération du fichier pour la période: ${period}`);
    
    // Récupérer les données du dashboard
    const dashboardData = await this.getAdminDashboard(period, customDate);
    
    if (!dashboardData || !dashboardData.supervisorCards) {
      throw new Error('Aucune donnée disponible pour l\'export');
    }
    
    // Créer un workbook (classeur)
    const XLSX = require('xlsx');
    const workbook = XLSX.utils.book_new();
    
    // ========================================
    // FEUILLE 1 : RÉSUMÉ GLOBAL
    // ========================================
    const summaryData = [
      ['RÉSUMÉ GLOBAL', ''],
      ['Période', this.getPeriodLabel(period, customDate)],
      ['Date d\'export', new Date().toLocaleString('fr-FR')],
      ['Heure du reset', `${dashboardData.dynamicConfig.resetConfig.hour}:${dashboardData.dynamicConfig.resetConfig.minute.toString().padStart(2, '0')}`],
      ['', ''],
      ['TOTAUX GLOBAUX', ''],
      ['Début total', dashboardData.globalTotals.formatted.debutTotalGlobal],
      ['Sortie total', dashboardData.globalTotals.formatted.sortieTotalGlobal],
      ['GR Total', dashboardData.globalTotals.formatted.grTotalGlobal],
      ['', ''],
      ['UV MASTER GLOBAL', ''],
      ['Solde', dashboardData.globalTotals.uvMaster.formatted.solde],
      ['Sorties', dashboardData.globalTotals.uvMaster.formatted.sorties]
    ];
    
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet['!cols'] = [{ wch: 25 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Résumé');
    
    // ========================================
    // FEUILLE 2 : DÉTAIL PAR SUPERVISEUR
    // ========================================
    const supervisorDetailData = [
      ['DÉTAIL PAR SUPERVISEUR', '', '', '', '', '', ''],
      ['Superviseur', 'Type Compte', 'Début', 'Sortie', 'GR', 'Statut', 'Observation']
    ];
    
    dashboardData.supervisorCards.forEach(supervisor => {
      // En-tête superviseur
      supervisorDetailData.push([supervisor.nom, '', '', '', '', supervisor.status, '']);
      
      // Comptes du superviseur
      const allAccountTypes = new Set([
        ...Object.keys(supervisor.comptes.debut),
        ...Object.keys(supervisor.comptes.sortie)
      ]);
      
      Array.from(allAccountTypes).sort().forEach(accountType => {
        const debut = supervisor.comptes.debut[accountType] || 0;
        const sortie = supervisor.comptes.sortie[accountType] || 0;
        const gr = sortie - debut;
        
        let accountLabel = accountType;
        if (accountType.startsWith('part-')) {
          accountLabel = `Partenaire: ${accountType.substring(5)}`;
        } else {
          accountLabel = this.getAccountTypeLabel(accountType);
        }
        
        supervisorDetailData.push([
          '',
          accountLabel,
          debut !== 0 ? debut.toLocaleString('fr-FR') : '',
          sortie !== 0 ? sortie.toLocaleString('fr-FR') : '',
          gr !== 0 ? gr.toLocaleString('fr-FR') : '',
          '',
          ''
        ]);
      });
      
      // Totaux par superviseur
      supervisorDetailData.push([
        '',
        'TOTAL',
        supervisor.totaux.debutTotal.toLocaleString('fr-FR'),
        supervisor.totaux.sortieTotal.toLocaleString('fr-FR'),
        supervisor.totaux.grTotal.toLocaleString('fr-FR'),
        '',
        ''
      ]);
      
      supervisorDetailData.push(['', '', '', '', '', '', '']); // Ligne vide
    });
    
    const supervisorSheet = XLSX.utils.aoa_to_sheet(supervisorDetailData);
    supervisorSheet['!cols'] = [
      { wch: 25 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 25 }
    ];
    XLSX.utils.book_append_sheet(workbook, supervisorSheet, 'Détail Superviseurs');
    
    // ========================================
    // FEUILLE 3 : SYNTHÈSE COMPTES
    // ========================================
    const accountSummaryData = [
      ['SYNTHÈSE PAR TYPE DE COMPTE', '', ''],
      ['Type de Compte', 'Début Total', 'Sortie Total']
    ];
    
    const accountTotals = {};
    
    dashboardData.supervisorCards.forEach(supervisor => {
      Object.entries(supervisor.comptes.debut).forEach(([accountType, value]) => {
        if (!accountTotals[accountType]) {
          accountTotals[accountType] = { debut: 0, sortie: 0 };
        }
        accountTotals[accountType].debut += value;
      });
      
      Object.entries(supervisor.comptes.sortie).forEach(([accountType, value]) => {
        if (!accountTotals[accountType]) {
          accountTotals[accountType] = { debut: 0, sortie: 0 };
        }
        accountTotals[accountType].sortie += value;
      });
    });
    
    Object.entries(accountTotals).forEach(([accountType, totals]) => {
      let label = accountType;
      if (accountType.startsWith('part-')) {
        label = `Partenaire: ${accountType.substring(5)}`;
      } else {
        label = this.getAccountTypeLabel(accountType);
      }
      
      accountSummaryData.push([
        label,
        totals.debut.toLocaleString('fr-FR'),
        totals.sortie.toLocaleString('fr-FR')
      ]);
    });
    
    const accountSheet = XLSX.utils.aoa_to_sheet(accountSummaryData);
    accountSheet['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, accountSheet, 'Synthèse Comptes');
    
    // ========================================
    // FEUILLE 4 : TRANSACTIONS PARTENAIRES
    // ========================================
    const partnerTransactionData = [
      ['TRANSACTIONS PARTENAIRES', '', '', '', ''],
      ['Superviseur', 'Partenaire', 'Type', 'Montant', 'Date']
    ];
    
    dashboardData.supervisorCards.forEach(supervisor => {
      Object.entries(supervisor.comptes.debut).forEach(([partnerKey, value]) => {
        if (partnerKey.startsWith('part-')) {
          const partnerName = partnerKey.substring(5);
          partnerTransactionData.push([
            supervisor.nom,
            partnerName,
            'Dépôt',
            value.toLocaleString('fr-FR'),
            new Date().toLocaleDateString('fr-FR')
          ]);
        }
      });
      
      Object.entries(supervisor.comptes.sortie).forEach(([partnerKey, value]) => {
        if (partnerKey.startsWith('part-')) {
          const partnerName = partnerKey.substring(5);
          partnerTransactionData.push([
            supervisor.nom,
            partnerName,
            'Retrait',
            value.toLocaleString('fr-FR'),
            new Date().toLocaleDateString('fr-FR')
          ]);
        }
      });
    });
    
    const partnerSheet = XLSX.utils.aoa_to_sheet(partnerTransactionData);
    partnerSheet['!cols'] = [
      { wch: 25 },
      { wch: 25 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 }
    ];
    XLSX.utils.book_append_sheet(workbook, partnerSheet, 'Partenaires');
    
    // ========================================
    // GÉNÉRER LE FICHIER
    // ========================================
    const fileName = `Export_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const filePath = `/tmp/${fileName}`;
    
    XLSX.writeFile(workbook, filePath);
    
    console.log(`✅ [EXPORT EXCEL] Fichier généré: ${filePath}`);
    
    return {
      success: true,
      fileName,
      filePath,
      period,
      exportDate: new Date().toISOString(),
      supervisorCount: dashboardData.supervisorCards.length,
      totalAmount: dashboardData.globalTotals.sortieTotalGlobal
    };
    
  } catch (error) {
    console.error('❌ [EXPORT EXCEL] Erreur:', error);
    throw error;
  }
}

// Dans TransactionService.js - Méthodes export corrigées

async exportSimpleDailyData(period = 'today', customDate = null) {
  try {
    console.log(`📄 [EXPORT SIMPLE] Génération du fichier simple...`);
    
    // ✅ IMPORT DYNAMIQUE
    const XLSX = await import('xlsx');
    
    // Récupérer les données
    const dashboardData = await this.getAdminDashboard(period, customDate);
    
    // Créer un tableau simple
    const data = [];
    data.push(['EXPORT DONNÉES DU JOUR']);
    data.push(['Période', this.getPeriodLabel(period, customDate)]);
    data.push(['Date', new Date().toLocaleString('fr-FR')]);
    data.push(['']);
    
    data.push(['Superviseur', 'Type Compte', 'Début', 'Sortie', 'GR']);
    
    dashboardData.supervisorCards.forEach(supervisor => {
      let isFirst = true;
      
      Object.keys(supervisor.comptes.debut).forEach(accountType => {
        const debut = supervisor.comptes.debut[accountType] || 0;
        const sortie = supervisor.comptes.sortie[accountType] || 0;
        const gr = sortie - debut;
        
        data.push([
          isFirst ? supervisor.nom : '',
          this.getAccountTypeLabel(accountType),
          debut,
          sortie,
          gr
        ]);
        
        isFirst = false;
      });
    });
    
    data.push(['']);
    data.push(['TOTAL GLOBAL', '', 
      dashboardData.globalTotals.debutTotalGlobal,
      dashboardData.globalTotals.sortieTotalGlobal,
      dashboardData.globalTotals.grTotalGlobal
    ]);
    
    // ✅ Utiliser XLSX.default ou XLSX selon l'import
    const xlsxLib = XLSX.default || XLSX;
    
    // Créer le worksheet et workbook
    const ws = xlsxLib.utils.aoa_to_sheet(data);
    const wb = xlsxLib.utils.book_new();
    xlsxLib.utils.book_append_sheet(wb, ws, 'Export');
    
    // Générer le fichier
    const fileName = `Export_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const filePath = `/tmp/${fileName}`;
    
    xlsxLib.writeFile(wb, filePath);
    
    console.log(`✅ [EXPORT SIMPLE] Fichier généré: ${filePath}`);
    
    return {
      success: true,
      fileName,
      filePath,
      period
    };
    
  } catch (error) {
    console.error('❌ [EXPORT SIMPLE] Erreur:', error);
    throw error;
  }
}

async exportDailyDataToExcel(period = 'today', customDate = null) {
  try {
    console.log(`📊 [EXPORT COMPLET] Génération du fichier Excel...`);
    
    // ✅ IMPORT DYNAMIQUE
    const XLSX = await import('xlsx');
    const xlsxLib = XLSX.default || XLSX;
    
    // Récupérer les données du dashboard
    const dashboardData = await this.getAdminDashboard(period, customDate);
    
    // Créer le workbook
    const wb = xlsxLib.utils.book_new();
    
    // FEUILLE 1: Résumé Global
    const summaryData = [
      ['RAPPORT QUOTIDIEN - RÉSUMÉ GLOBAL'],
      ['Période', this.getPeriodLabel(period, customDate)],
      ['Date de génération', new Date().toLocaleString('fr-FR')],
      [''],
      ['Métrique', 'Valeur'],
      ['Début Total', dashboardData.globalTotals.debutTotalGlobal],
      ['Sortie Total', dashboardData.globalTotals.sortieTotalGlobal],
      ['GR Total', dashboardData.globalTotals.grTotalGlobal],
      ['Nombre de Superviseurs', dashboardData.supervisorCards.length]
    ];
    
    const wsSummary = xlsxLib.utils.aoa_to_sheet(summaryData);
    xlsxLib.utils.book_append_sheet(wb, wsSummary, 'Résumé');
    
    // FEUILLE 2: Détail par superviseur
    const detailData = [];
    detailData.push(['DÉTAIL PAR SUPERVISEUR']);
    detailData.push(['']);
    detailData.push(['Superviseur', 'Type Compte', 'Début', 'Sortie', 'GR']);
    
    dashboardData.supervisorCards.forEach(supervisor => {
      let isFirst = true;
      
      Object.keys(supervisor.comptes.debut).forEach(accountType => {
        const debut = supervisor.comptes.debut[accountType] || 0;
        const sortie = supervisor.comptes.sortie[accountType] || 0;
        const gr = sortie - debut;
        
        detailData.push([
          isFirst ? supervisor.nom : '',
          this.getAccountTypeLabel(accountType),
          debut,
          sortie,
          gr
        ]);
        
        isFirst = false;
      });
      
      detailData.push(['']); // Ligne vide entre superviseurs
    });
    
    const wsDetail = xlsxLib.utils.aoa_to_sheet(detailData);
    xlsxLib.utils.book_append_sheet(wb, wsDetail, 'Détails');
    
    // FEUILLE 3: Synthèse par compte
    const accountSummaryData = [];
    accountSummaryData.push(['SYNTHÈSE PAR TYPE DE COMPTE']);
    accountSummaryData.push(['']);
    accountSummaryData.push(['Type de Compte', 'Début Total', 'Sortie Total', 'GR Total']);
    
    // Agréger par type de compte
    const accountTotals = {};
    dashboardData.supervisorCards.forEach(supervisor => {
      Object.keys(supervisor.comptes.debut).forEach(accountType => {
        if (!accountTotals[accountType]) {
          accountTotals[accountType] = { debut: 0, sortie: 0, gr: 0 };
        }
        
        accountTotals[accountType].debut += supervisor.comptes.debut[accountType] || 0;
        accountTotals[accountType].sortie += supervisor.comptes.sortie[accountType] || 0;
        accountTotals[accountType].gr += (supervisor.comptes.sortie[accountType] || 0) - (supervisor.comptes.debut[accountType] || 0);
      });
    });
    
    Object.keys(accountTotals).forEach(accountType => {
      accountSummaryData.push([
        this.getAccountTypeLabel(accountType),
        accountTotals[accountType].debut,
        accountTotals[accountType].sortie,
        accountTotals[accountType].gr
      ]);
    });
    
    const wsAccountSummary = xlsxLib.utils.aoa_to_sheet(accountSummaryData);
    xlsxLib.utils.book_append_sheet(wb, wsAccountSummary, 'Par Compte');
    
    // Générer le nom du fichier
    const fileName = `Rapport_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const filePath = `/tmp/${fileName}`;
    
    // Écrire le fichier
    xlsxLib.writeFile(wb, filePath);
    
    console.log(`✅ [EXPORT COMPLET] Fichier généré: ${filePath}`);
    
    return {
      success: true,
      fileName,
      filePath,
      period,
      sheets: ['Résumé', 'Détails', 'Par Compte']
    };
    
  } catch (error) {
    console.error('❌ [EXPORT COMPLET] Erreur:', error);
    throw error;
  }
}

// Méthode helper pour les labels
getPeriodLabel(period, customDate) {
  const labels = {
    today: 'Aujourd\'hui',
    yesterday: 'Hier',
    week: 'Cette semaine',
    month: 'Ce mois',
    year: 'Cette année',
    all: 'Toutes les périodes',
    custom: customDate ? `Date personnalisée: ${customDate}` : 'Date personnalisée'
  };
  
  return labels[period] || period;
}

getAccountTypeLabel(accountType) {
  const labels = {
    LIQUIDE: 'Liquide',
    ORANGE_MONEY: 'Orange Money',
    WAVE: 'Wave',
    UV_MASTER: 'UV Master',
    AUTRES: 'Autres'
  };
  
  return labels[accountType] || accountType;
}
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