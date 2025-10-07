// src/services/TransactionService.js
import prisma from '../config/database.js';
import NotificationService from './NotificationService.js';

class TransactionService {
  // =====================================
  // UTILITAIRES ET HELPERS
  // =====================================

  generateReference(prefix = 'TXN') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  // Formater un montant pour l'affichage
  formatAmount(amount, withSign = false) {
    return `${withSign && amount > 0 ? '+' : ''}${amount.toLocaleString('fr-FR')} F`;
  }

  // Obtenir filtre de date selon la période
  getDateFilter(period = 'today') {
    const now = new Date();
    
    switch (period.toLowerCase()) {
      case 'today':
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return { gte: startOfDay, lte: endOfDay };

      case 'week':
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        return { gte: weekAgo, lte: now };

      case 'month':
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return { gte: startOfMonth, lte: now };

      case 'year':
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        return { gte: startOfYear, lte: now };

      case 'all':
        return {};

      default:
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return { gte: todayStart, lte: todayEnd };
    }
  }

  // Helper pour extraire le type de compte
  extractAccountTypeFromDescription(description) {
    if (!description) return 'LIQUIDE';
    
    const desc = description.toUpperCase();
    
    if (desc.includes('LIQUIDE')) return 'LIQUIDE';
    if (desc.includes('ORANGE') || desc.includes('OM')) return 'ORANGE_MONEY';
    if (desc.includes('WAVE')) return 'WAVE';
    if (desc.includes('UV_MASTER') || desc.includes('UV MASTER')) return 'UV_MASTER';
    
    return 'LIQUIDE';
  }

  // ✅ MÉTHODE DE CONVERSION SÉCURISÉE BIGINT
  convertToBigInt(value) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.round(value * 100));
    if (typeof value === 'string') return BigInt(Math.round(parseFloat(value) * 100));
    throw new Error('Type de valeur non supporté pour conversion BigInt');
  }

  convertFromBigInt(value) {
    if (typeof value === 'bigint') return Number(value) / 100;
    if (typeof value === 'number') return value / 100;
    if (typeof value === 'string') return parseFloat(value) / 100;
    return 0;
  }

  // =====================================
  // CREATION ADMIN TRANSACTION CORRIGÉE
  // =====================================
  async createAdminTransaction(adminId, transactionData) {
    try {
      const { superviseurId, typeCompte, typeOperation, montant, partenaireId } = transactionData;

      const supervisor = await prisma.user.findUnique({
        where: { id: superviseurId, role: 'SUPERVISEUR' }
      });

      if (!supervisor) throw new Error('Superviseur non trouvé');

      const montantFloat = parseFloat(montant);
      if (isNaN(montantFloat) || montantFloat <= 0) throw new Error('Montant invalide');

      const montantBigInt = this.convertToBigInt(montantFloat);

      let account = await prisma.account.findFirst({
        where: { userId: superviseurId, type: typeCompte.toUpperCase() }
      });

      if (!account) {
        account = await prisma.account.create({
          data: {
            type: typeCompte.toUpperCase(),
            userId: superviseurId,
            balance: BigInt(0),
            initialBalance: BigInt(0)
          }
        });
      }

      let transactionType, description;
      let partnerInfo = null;
      let isPartnerTransaction = false;

      if (partenaireId) {
        const partner = await prisma.user.findUnique({ where: { id: partenaireId, role: 'PARTENAIRE' } });
        if (!partner) throw new Error('Partenaire non trouvé');
        partnerInfo = partner;
        isPartnerTransaction = true;

        if (typeOperation === 'depot') {
          transactionType = 'DEPOT';
          description = `Dépôt partenaire ${partner.nomComplet} - ${typeCompte}`;
        } else {
          transactionType = 'RETRAIT';
          description = `Retrait partenaire ${partner.nomComplet} - ${typeCompte}`;
        }
      } else {
        if (typeOperation === 'depot') {
          transactionType = 'DEBUT_JOURNEE';
          description = `Début journée ${typeCompte}`;
        } else {
          transactionType = 'FIN_JOURNEE';
          description = `Fin journée ${typeCompte}`;
        }
      }

      if (typeOperation === 'depot') {
        if (transactionType === 'DEBUT_JOURNEE') {
          await prisma.account.update({ where: { id: account.id }, data: { initialBalance: { increment: montantBigInt } } });
        } else {
          await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: montantBigInt } } });
        }
      } else {
        if (isPartnerTransaction) {
          await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: montantBigInt } } });
        } else if (transactionType === 'FIN_JOURNEE') {
          await prisma.account.update({ where: { id: account.id }, data: { balance: montantBigInt } });
        } else {
          if (account.balance < montantBigInt) {
            const soldeActuelFrancs = this.convertFromBigInt(account.balance);
            throw new Error(`Solde insuffisant pour ce retrait. Solde actuel: ${soldeActuelFrancs.toFixed(2)} F`);
          }
          await prisma.account.update({ where: { id: account.id }, data: { balance: { decrement: montantBigInt } } });
        }
      }

      const transactionCreateData = {
        montant: montantBigInt,
        type: transactionType,
        description,
        envoyeurId: adminId,
        destinataireId: superviseurId,
        compteDestinationId: account.id
      };

      if (partenaireId) transactionCreateData.partenaireId = partenaireId;

      const transaction = await prisma.transaction.create({ data: transactionCreateData });

      let notificationTitle, notificationMessage, notificationType;
      if (partnerInfo) {
        if (typeOperation === 'depot') {
          notificationTitle = 'Nouveau dépôt partenaire';
          notificationMessage = `${partnerInfo.nomComplet} a déposé ${this.formatAmount(montantFloat)} (${typeCompte})`;
          notificationType = 'DEPOT_PARTENAIRE';
        } else {
          notificationTitle = 'Nouveau retrait partenaire';
          notificationMessage = `${partnerInfo.nomComplet} a retiré ${this.formatAmount(montantFloat)} (${typeCompte}) - Votre solde a été crédité`;
          notificationType = 'RETRAIT_PARTENAIRE';
        }
      } else {
        notificationTitle = typeOperation === 'depot' ? 'Solde de début mis à jour' : 'Solde de fin enregistré';
        notificationMessage = `${description} - ${this.formatAmount(montantFloat)} par l'admin`;
        notificationType = typeOperation === 'depot' ? 'DEBUT_JOURNEE' : 'FIN_JOURNEE';
      }

      await NotificationService.createNotification({
        userId: superviseurId,
        title: notificationTitle,
        message: notificationMessage,
        type: notificationType
      });

      const accountUpdated = await prisma.account.findUnique({ where: { id: account.id } });

      return {
        transaction: {
          id: transaction.id,
          type: transaction.type,
          montant: montantFloat,
          description: transaction.description,
          superviseurNom: supervisor.nomComplet,
          typeCompte: typeCompte,
          createdAt: transaction.createdAt,
          isPartnerTransaction: !!partenaireId,
          partnerName: partnerInfo?.nomComplet || null,
          partnerId: partnerInfo?.id || null,
          transactionCategory: partenaireId ? 'PARTENAIRE' : 'JOURNEE'
        },
        accountUpdated: true,
        soldeActuel: this.convertFromBigInt(accountUpdated.balance),
        soldeInitial: this.convertFromBigInt(accountUpdated.initialBalance)
      };

    } catch (error) {
      console.error('❌ [SERVICE] createAdminTransaction error:', error);
      throw error;
    }
  }

  // =====================================
  // DASHBOARD ADMIN AVEC AFFICHAGE CORRIGÉ
  // =====================================
  async getAdminDashboard(period = 'today') {
    try {
      // Vérifier et effectuer le transfert quotidien si c'est un nouveau jour
      await this.checkAndTransferDaily();
      
      const dateFilter = this.getDateFilter(period);

      const supervisors = await prisma.user.findMany({
        where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
        include: {
          accounts: true,
          transactionsEnvoyees: {
            where: { createdAt: dateFilter },
            include: {
              destinataire: {
                select: { id: true, nomComplet: true, role: true }
              },
              partenaire: {
                select: { id: true, nomComplet: true }
              }
            },
            orderBy: { createdAt: 'desc' }
          },
          transactionsRecues: {
            where: { createdAt: dateFilter },
            include: {
              envoyeur: {
                select: { id: true, nomComplet: true, role: true }
              },
              partenaire: {
                select: { id: true, nomComplet: true }
              }
            },
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { nomComplet: 'asc' }
      });

      let totalDebutGlobal = 0;
      let totalSortieGlobal = 0;
      let uvMasterSolde = 0;
      let uvMasterSorties = 0;

      const supervisorCards = supervisors.map(supervisor => {
        const accountsByType = {
          debut: {},
          sortie: {}
        };

        let uvMasterTotal = 0;

        // Ajouter les comptes standards
        supervisor.accounts.forEach(account => {
          const initial = this.convertFromBigInt(account.initialBalance);
          const current = this.convertFromBigInt(account.balance);
          
          if (account.type === 'UV_MASTER') {
            uvMasterTotal += current;
            accountsByType.sortie['UV_MASTER'] = current;
            uvMasterSorties += current;
            uvMasterSolde += initial;
            accountsByType.debut['UV_MASTER'] = initial;
          } else {
            accountsByType.debut[account.type] = initial;
            accountsByType.sortie[account.type] = current;
          }
        });

        // Ajouter les transactions partenaires dans les comptes
        const allTransactions = [...supervisor.transactionsEnvoyees, ...supervisor.transactionsRecues];
        const partenaireTransactions = {};
        
        allTransactions.forEach(tx => {
          const montant = this.convertFromBigInt(tx.montant);
          
          if (tx.partenaireId && tx.partenaire) {
            const partnerName = `part-${tx.partenaire.nomComplet}`;
            
            if (!partenaireTransactions[partnerName]) {
              partenaireTransactions[partnerName] = {
                depots: 0,
                retraits: 0
              };
            }
            
            if (tx.type === 'DEPOT') {
              partenaireTransactions[partnerName].depots += montant;
            } else if (tx.type === 'RETRAIT') {
              partenaireTransactions[partnerName].retraits += montant;
            }
          }
        });

        Object.entries(partenaireTransactions).forEach(([partnerName, amounts]) => {
          if (amounts.depots > 0) {
            accountsByType.debut[partnerName] = amounts.depots;
          }
          if (amounts.retraits > 0) {
            accountsByType.sortie[partnerName] = amounts.retraits;
          }
        });

        // Calculer debutTotal AVEC UV Master maintenant
        let debutTotal = 0;
        let sortieTotal = 0;

        Object.entries(accountsByType.debut).forEach(([key, value]) => {
          debutTotal += value;
        });

        Object.entries(accountsByType.sortie).forEach(([key, value]) => {
          sortieTotal += value;
        });

        const grTotal = debutTotal - sortieTotal;

        totalDebutGlobal += debutTotal;
        totalSortieGlobal += sortieTotal;

        return {
          id: supervisor.id,
          nom: supervisor.nomComplet,
          status: supervisor.status,
          comptes: {
            debut: accountsByType.debut,
            sortie: accountsByType.sortie
          },
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
      });

      // Totaux globaux
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
        formatted: {
          debutTotalGlobal: this.formatAmount(totalDebutGlobal),
          sortieTotalGlobal: this.formatAmount(totalSortieGlobal)
        }
      };

      return {
        period,
        globalTotals,
        supervisorCards
      };

    } catch (error) {
      console.error('Erreur getAdminDashboard:', error);
      throw error;
    }
  }

  // =====================================
  // TRANSFERT QUOTIDIEN
  // =====================================
  async checkAndTransferDaily() {
    try {
      const today = new Date();
      const todayString = today.toDateString();
      
      // Vérifier si on a déjà fait le transfert aujourd'hui
      const lastTransferDate = await this.getLastTransferDate();
      
      if (!lastTransferDate || lastTransferDate !== todayString) {
        console.log('Nouveau jour détecté - Transfert des soldes...');
        await this.transferBalancesToInitial();
        await this.saveTransferDate(todayString);
      }
      
    } catch (error) {
      console.error('Erreur checkAndTransferDaily:', error);
      // Ne pas bloquer l'application
    }
  }

  async transferBalancesToInitial() {
    try {
      const accounts = await prisma.account.findMany({
        where: {
          balance: { gt: BigInt(0) },
          user: {
            role: 'SUPERVISEUR',
            status: 'ACTIVE'
          }
        }
      });

      for (const account of accounts) {
        const currentBalance = account.balance;
        
        // Transférer balance vers initialBalance et remettre balance à 0
        await prisma.account.update({
          where: { id: account.id },
          data: {
            initialBalance: currentBalance,
            balance: BigInt(0)
          }
        });
      }

      console.log(`Transfert terminé pour ${accounts.length} comptes`);

    } catch (error) {
      console.error('Erreur transferBalancesToInitial:', error);
      throw error;
    }
  }

  async getLastTransferDate() {
    try {
      const config = await prisma.systemConfig.findFirst({
        where: { key: 'last_transfer_date' }
      });
      
      return config?.value || null;
    } catch (error) {
      return null;
    }
  }

  async saveTransferDate(dateString) {
    try {
      await prisma.systemConfig.upsert({
        where: { key: 'last_transfer_date' },
        update: { value: dateString },
        create: { 
          key: 'last_transfer_date', 
          value: dateString 
        }
      });
    } catch (error) {
      console.log('Info: Table systemConfig non disponible');
    }
  }

  // =====================================
  // DASHBOARD SUPERVISEUR
  // =====================================
  async getSupervisorDashboard(superviseurId, period = 'today') {
    try {
      const supervisor = await prisma.user.findUnique({
        where: { id: superviseurId },
        include: {
          accounts: true,
          transactionsEnvoyees: {
            where: { createdAt: this.getDateFilter(period) },
            include: {
              destinataire: { select: { nomComplet: true, role: true } },
              partenaire: { select: { id: true, nomComplet: true } }
            },
            orderBy: { createdAt: 'desc' }
          },
          transactionsRecues: {
            where: { createdAt: this.getDateFilter(period) },
            include: {
              envoyeur: { select: { nomComplet: true, role: true } },
              partenaire: { select: { id: true, nomComplet: true } }
            },
            orderBy: { createdAt: 'desc' }
          },
          transactionsPartenaire: {
            where: { createdAt: this.getDateFilter(period) },
            include: {
              envoyeur: { select: { nomComplet: true, role: true } },
              destinataire: { select: { nomComplet: true, role: true } }
            },
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!supervisor) {
        throw new Error('Superviseur non trouvé');
      }

      // REQUÊTE DIRECTE ALTERNATIVE pour toutes les transactions
      const allTransactions = await prisma.transaction.findMany({
        where: {
          createdAt: this.getDateFilter(period),
          OR: [
            { envoyeurId: superviseurId },
            { destinataireId: superviseurId },
            { partenaireId: superviseurId }
          ]
        },
        include: {
          destinataire: { select: { nomComplet: true, role: true } },
          envoyeur: { select: { nomComplet: true, role: true } },
          partenaire: { select: { id: true, nomComplet: true } }
        },
        orderBy: { createdAt: 'desc' }
      });

      // CHOISIR LA SOURCE DE DONNÉES
      const combinedTransactions = allTransactions.length > 0 
        ? allTransactions 
        : [
            ...supervisor.transactionsEnvoyees,
            ...supervisor.transactionsRecues,
            ...supervisor.transactionsPartenaire
          ].filter((tx, index, self) => index === self.findIndex(t => t.id === tx.id));

      // ====== COMPTES DE BASE ======
      const accountsByType = { debut: {}, sortie: {} };

      supervisor.accounts.forEach(account => {
        const initial = this.convertFromBigInt(account.initialBalance);
        const current = this.convertFromBigInt(account.balance);

        if (account.type === 'UV_MASTER') {
          accountsByType.debut['UV_MASTER'] = initial;
          accountsByType.sortie['UV_MASTER'] = current;
        } else {
          accountsByType.debut[account.type] = initial;
          accountsByType.sortie[account.type] = current;
        }
      });

      // TRAITEMENT DES TRANSACTIONS PARTENAIRES
      combinedTransactions.forEach(tx => {
        const montant = this.convertFromBigInt(tx.montant);

        if (tx.partenaireId && tx.partenaire) {
          const partnerName = `part-${tx.partenaire.nomComplet}`;

          if (tx.type === 'DEPOT') {
            accountsByType.debut[partnerName] = (accountsByType.debut[partnerName] || 0) + montant;
          } else if (tx.type === 'RETRAIT') {
            accountsByType.sortie[partnerName] = (accountsByType.sortie[partnerName] || 0) + montant;
          }
        }
      });

      // ====== TOTAUX PERSONNELS ======
      let totalDebutPersonnel = 0;
      let totalSortiePersonnel = 0;
      let uvMasterDebut = 0;
      let uvMasterSortie = 0;

      // Comptes personnels du superviseur
      supervisor.accounts.forEach(account => {
        totalDebutPersonnel += this.convertFromBigInt(account.initialBalance);
        totalSortiePersonnel += this.convertFromBigInt(account.balance);
      });

      // ====== RÉCUPÉRATION UV_MASTER DE LA BOUTIQUE ======
      const uvMasterAccounts = await prisma.account.findMany({
        where: {
          type: 'UV_MASTER',
          user: {
            role: 'SUPERVISEUR',
            status: 'ACTIVE'
          }
        },
        include: {
          user: {
            select: { nomComplet: true, role: true }
          }
        }
      });

      // Calculer les totaux UV_MASTER de la boutique
      if (uvMasterAccounts && uvMasterAccounts.length > 0) {
        uvMasterDebut = uvMasterAccounts.reduce((total, account) => {
          return total + this.convertFromBigInt(account.initialBalance);
        }, 0);
        
        uvMasterSortie = uvMasterAccounts.reduce((total, account) => {
          return total + this.convertFromBigInt(account.balance);
        }, 0);
      }

      // Ajout des partenaires aux totaux personnels
      Object.entries(accountsByType.debut).forEach(([key, value]) => {
        if (key.startsWith('part-')) {
          totalDebutPersonnel += value;
        }
      });

      Object.entries(accountsByType.sortie).forEach(([key, value]) => {
        if (key.startsWith('part-')) {
          totalSortiePersonnel += value;
        }
      });

      const grTotal = totalDebutPersonnel - totalSortiePersonnel;

      // ====== FORMATAGE TRANSACTIONS RÉCENTES ======
      const recentTransactions = combinedTransactions
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)
        .map(tx => {
          let personne = '';
          
          if (tx.envoyeurId === superviseurId) {
            personne = tx.destinataire?.nomComplet || 'Destinataire inconnu';
          } else if (tx.destinataireId === superviseurId) {
            personne = tx.envoyeur?.nomComplet || 'Expéditeur inconnu';
          } else if (tx.partenaireId === superviseurId) {
            personne = tx.envoyeur?.nomComplet || 'Expéditeur inconnu';
          }

          if (['DEBUT_JOURNEE', 'FIN_JOURNEE'].includes(tx.type)) {
            personne = supervisor.nomComplet;
          }

          return {
            id: tx.id,
            type: tx.type,
            montant: this.convertFromBigInt(tx.montant),
            description: tx.description,
            personne,
            createdAt: tx.createdAt,
            envoyeurId: tx.envoyeurId,
            destinataireId: tx.destinataireId,
            partenaireId: tx.partenaireId
          };
        });

      // ====== RÉSULTAT FINAL ======
      const result = {
        superviseur: {
          id: supervisor.id,
          nom: supervisor.nomComplet,
          status: supervisor.status
        },
        period,
        uvMaster: {
          personal: {
            debut: uvMasterDebut,
            sortie: uvMasterSortie,
            formatted: uvMasterSortie.toLocaleString() + ' F'
          },
          personnel: {
            debut: uvMasterDebut,
            sortie: uvMasterSortie,
            formatted: uvMasterSortie.toLocaleString() + ' F'
          },
          total: uvMasterSortie,
          debut: uvMasterDebut,
          formatted: uvMasterSortie.toLocaleString() + ' F'
        },
        comptes: accountsByType,
        totaux: {
          debutTotal: totalDebutPersonnel,
          sortieTotal: totalSortiePersonnel,
          grTotal,
          debutTotalGlobal: totalDebutPersonnel,
          sortieTotalGlobal: totalSortiePersonnel,
          grTotalGlobal: grTotal,
          formatted: {
            debutTotal: totalDebutPersonnel.toLocaleString() + ' F',
            sortieTotal: totalSortiePersonnel.toLocaleString() + ' F',
            grTotal: (grTotal >= 0 ? '+' : '') + grTotal.toLocaleString() + ' F',
            debutTotalGlobal: totalDebutPersonnel.toLocaleString() + ' F',
            sortieTotalGlobal: totalSortiePersonnel.toLocaleString() + ' F',
            grTotalGlobal: (grTotal >= 0 ? '+' : '') + grTotal.toLocaleString() + ' F'
          }
        },
        recentTransactions
      };

      return result;

    } catch (error) {
      console.error('Erreur getSupervisorDashboard:', error);
      throw new Error('Erreur lors de la récupération du dashboard superviseur: ' + error.message);
    }
  }

  // =====================================
  // DASHBOARD PARTENAIRE
  // =====================================
  async getPartnerDashboard(partenaireId, period = 'today') {
    try {
      const dateFilter = this.getDateFilter(period);

      // Récupérer le partenaire avec ses transactions
      const partner = await prisma.user.findUnique({
        where: { id: partenaireId },
        include: {
          transactionsEnvoyees: {
            where: { createdAt: dateFilter },
            include: {
              destinataire: {
                select: { nomComplet: true, role: true }
              }
            },
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!partner) {
        throw new Error('Partenaire non trouvé');
      }

      // Analyser les transactions du jour
      const transactions = partner.transactionsEnvoyees;
      let totalDepots = 0;
      let totalRetraits = 0;

      const transactionDetails = transactions.map(tx => {
        const montant = this.convertFromBigInt(tx.montant);
        const isDepot = ['DEPOT'].includes(tx.type);
        
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

      // Superviseurs disponibles
      const availableSupervisors = await this.getActiveSupervisors();

      return {
        partenaire: {
          id: partner.id,
          nom: partner.nomComplet
        },
        period,
        statistiques: {
          totalDepots,
          totalRetraits,
          soldeNet: totalDepots - totalRetraits,
          nombreTransactions: transactions.length,
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
  // MISE À JOUR TRANSACTION
  // =====================================
  async updateTransaction(transactionId, updateData, userId) {
    try {
      console.log('🔄 [SERVICE] updateTransaction démarré:', {
        transactionId,
        updateData,
        userId
      });

      // Récupérer la transaction existante
      const existingTransaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: {
          envoyeur: { select: { id: true, nomComplet: true, role: true } },
          destinataire: { select: { id: true, nomComplet: true, role: true } },
          compteDestination: true
        }
      });

      if (!existingTransaction) {
        throw new Error('Transaction non trouvée');
      }

      // Vérifier les permissions
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('Utilisateur non trouvé');
      }

      // Logique de permissions
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

      // Préparer les données de mise à jour
      const updateFields = {};
      
      if (updateData.description) {
        updateFields.description = updateData.description;
      }

      if (updateData.montant) {
        const newMontantFloat = parseFloat(updateData.montant);
        if (isNaN(newMontantFloat) || newMontantFloat <= 0) {
          throw new Error('Montant invalide');
        }
        
        const newMontantBigInt = this.convertToBigInt(newMontantFloat);
        const oldMontantBigInt = existingTransaction.montant;
        
        updateFields.montant = newMontantBigInt;

        // Mise à jour du solde du compte si le montant change
        if (existingTransaction.compteDestination && newMontantBigInt !== oldMontantBigInt) {
          const difference = newMontantBigInt - oldMontantBigInt;
          
          if (existingTransaction.type === 'DEPOT' || existingTransaction.type === 'DEBUT_JOURNEE') {
            if (existingTransaction.type === 'DEBUT_JOURNEE') {
              await prisma.account.update({
                where: { id: existingTransaction.compteDestination.id },
                data: { initialBalance: { increment: difference } }
              });
            } else {
              await prisma.account.update({
                where: { id: existingTransaction.compteDestination.id },
                data: { balance: { increment: difference } }
              });
            }
          } else if (existingTransaction.type === 'RETRAIT') {
            // Pour les retraits, vérifier le solde disponible
            const currentAccount = await prisma.account.findUnique({
              where: { id: existingTransaction.compteDestination.id }
            });
            
            if (currentAccount.balance - difference < BigInt(0)) {
              throw new Error('Solde insuffisant pour cette modification');
            }
            
            await prisma.account.update({
              where: { id: existingTransaction.compteDestination.id },
              data: { balance: { decrement: difference } }
            });
          }
        }
      }

      // Mettre à jour la transaction
      const updatedTransaction = await prisma.transaction.update({
        where: { id: transactionId },
        data: updateFields,
        include: {
          envoyeur: { select: { nomComplet: true } },
          destinataire: { select: { nomComplet: true } },
          compteDestination: true
        }
      });

      // Créer une transaction d'audit
      await prisma.transaction.create({
        data: {
          montant: updatedTransaction.montant,
          type: 'AUDIT_MODIFICATION',
          description: `Modification transaction ${transactionId} par ${user.nomComplet}`,
          envoyeurId: userId,
          destinataireId: existingTransaction.destinataireId,
          metadata: JSON.stringify({
            originalTransaction: transactionId,
            changes: updateFields,
            modifiedBy: userId,
            modifiedAt: new Date().toISOString()
          })
        }
      });

      return {
        success: true,
        message: 'Transaction mise à jour avec succès',
        data: {
          id: updatedTransaction.id,
          type: updatedTransaction.type,
          montant: this.convertFromBigInt(updatedTransaction.montant),
          description: updatedTransaction.description,
          updatedAt: updatedTransaction.updatedAt
        }
      };

    } catch (error) {
      console.error('❌ [SERVICE] Erreur updateTransaction:', error);
      throw error;
    }
  }

  // =====================================
  // SUPERVISEURS ACTIFS
  // =====================================
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

  // =====================================
  // MISE À JOUR COMPTE SUPERVISEUR
  // =====================================
  async updateSupervisorAccount(supervisorId, accountType, accountKey, newValue, adminId) {
    try {
      console.log('🔄 [SERVICE] updateSupervisorAccount:', {
        supervisorId,
        accountType, 
        accountKey,
        newValue,
        adminId
      });

      // ✅ CONVERSION EN BIGINT POUR STOCKAGE
      const newValueBigInt = this.convertToBigInt(newValue);

      // Vérifier que le superviseur existe
      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId, role: 'SUPERVISEUR' }
      });

      if (!supervisor) {
        throw new Error('Superviseur non trouvé');
      }

      // Si c'est un compte standard (LIQUIDE, ORANGE_MONEY, etc.)
      if (!accountKey.startsWith('part-') && !accountKey.startsWith('sup-')) {
        let account = await prisma.account.findFirst({
          where: {
            userId: supervisorId,
            type: accountKey
          }
        });

        if (!account) {
          // Créer le compte s'il n'existe pas
          account = await prisma.account.create({
            data: {
              type: accountKey,
              userId: supervisorId,
              balance: accountType === 'sortie' ? newValueBigInt : BigInt(0),
              initialBalance: accountType === 'debut' ? newValueBigInt : BigInt(0)
            }
          });

          console.log('✅ Nouveau compte créé:', account);

          return {
            oldValue: 0,
            newValue: newValue,
            accountCreated: true
          };
        } else {
          // Mettre à jour le compte existant
          const oldValue = accountType === 'debut' ? account.initialBalance : account.balance;

          const updateData = {};
          if (accountType === 'debut') {
            updateData.initialBalance = newValueBigInt;
          } else {
            updateData.balance = newValueBigInt;
          }

          const updatedAccount = await prisma.account.update({
            where: { id: account.id },
            data: updateData
          });

          console.log('✅ Compte mis à jour:', { 
            accountId: account.id,
            accountKey, 
            oldValue: this.convertFromBigInt(oldValue), 
            newValue,
            updatedAccount
          });

          // Créer une transaction d'audit pour tracer la modification
          await prisma.transaction.create({
            data: {
              montant: newValueBigInt,
              type: 'AUDIT_MODIFICATION',
              description: `Modification compte ${accountKey} (${accountType}) par admin - Ancien: ${this.convertFromBigInt(oldValue)} F, Nouveau: ${newValue} F`,
              envoyeurId: adminId,
              destinataireId: supervisorId,
              compteDestinationId: account.id,
              metadata: JSON.stringify({
                action: 'UPDATE_SUPERVISOR_ACCOUNT',
                accountType,
                accountKey,
                oldValue: this.convertFromBigInt(oldValue),
                newValue,
                modifiedBy: adminId,
                modifiedAt: new Date().toISOString()
              })
            }
          });

          return {
            oldValue: this.convertFromBigInt(oldValue),
            newValue: newValue,
            accountUpdated: true
          };
        }
      } else {
        // Pour les comptes partenaires/superviseurs - implémentation basique
        console.log('⚠️ Modification compte partenaire/superviseur détectée');
        
        // Pour l'instant, juste créer une transaction d'audit
        await prisma.transaction.create({
          data: {
            montant: newValueBigInt,
            type: 'AUDIT_MODIFICATION',
            description: `Tentative modification compte ${accountKey} (${accountType}) par admin`,
            envoyeurId: adminId,
            destinataireId: supervisorId,
            metadata: JSON.stringify({
              action: 'UPDATE_PARTNER_ACCOUNT',
              accountType,
              accountKey,
              newValue,
              note: 'Modification compte partenaire - logique à implémenter',
              modifiedBy: adminId,
              modifiedAt: new Date().toISOString()
            })
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

  // =====================================
  // UTILITAIRES POUR TRANSACTIONS
  // =====================================
  
  // Obtenir le label d'un type de transaction
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

  // Obtenir la couleur d'un type de transaction
  getTransactionColor(type) {
    const positiveTypes = ['DEPOT', 'TRANSFERT_RECU', 'ALLOCATION_UV_MASTER', 'DEBUT_JOURNEE'];
    const negativeTypes = ['RETRAIT', 'TRANSFERT_ENVOYE', 'FIN_JOURNEE'];
    
    if (positiveTypes.includes(type)) return 'positive';
    if (negativeTypes.includes(type)) return 'negative';
    return 'neutral';
  }

  async createSupervisorTransaction(superviseurId, transactionData) {
    try {
      // Les superviseurs utilisent la même logique que les admins
      // mais avec le superviseur comme créateur
      return await this.createAdminTransaction(superviseurId, transactionData);
    } catch (error) {
      console.error('Erreur createSupervisorTransaction:', error);
      throw error;
    }
  }

  async createPartnerTransaction(partnerId, transactionData) {
    try {
      // Implémentation pour les transactions partenaires
      // À adapter selon vos besoins métier
      throw new Error('Fonctionnalité createPartnerTransaction à implémenter');
    } catch (error) {
      console.error('Erreur createPartnerTransaction:', error);
      throw error;
    }
  }

  // Obtenir le label d'un type de compte
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

  // Obtenir l'icône d'un type de compte
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

  // Formater une période pour l'affichage
  getPeriodLabel(period) {
    const labels = {
      'today': "Aujourd'hui",
      'week': 'Cette semaine',
      'month': 'Ce mois',
      'year': 'Cette année',
      'all': 'Tout'
    };
    
    return labels[period] || period;
  }

  // Valider les données de transaction admin
  validateAdminTransactionData(data) {
    const errors = [];

    if (!data.superviseurId) {
      errors.push('Superviseur requis');
    }

    if (!data.typeCompte) {
      errors.push('Type de compte requis');
    }

    if (!data.typeOperation) {
      errors.push('Type d\'opération requis');
    }

    if (!data.montant || data.montant <= 0) {
      errors.push('Montant doit être supérieur à 0');
    }

    return errors;
  }
}

export default new TransactionService();