// src/services/RecentTransactionService.js
import prisma from '../config/database.js';

class RecentTransactionService {

  // =====================================
  // MÉTHODE PRINCIPALE AVEC FILTRAGE AVANCÉ
  // =====================================

  async getRecentTransactionsWithFilters(filters = {}, pagination = {}) {
    try {
      const {
        search,
        supervisorId,
        partnerId,
        operatorId,
        transactionType,
        period = 'today',
        accountType,
        supervisorName,
        partnerName,
        operatorName,
        userName
      } = filters;

      const {
        page = 1,
        limit = 5, // Pagination par 5 par défaut
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = pagination;

      // Construction du filtre de date
      const dateFilter = this.getDateFilter(period);

      // Construction des filtres WHERE complexes
      const whereConditions = {
        AND: []
      };

      // Filtre par date
      if (Object.keys(dateFilter).length > 0) {
        whereConditions.AND.push({ createdAt: dateFilter });
      }

      // ====== FILTRAGE PAR ID SPÉCIFIQUES ======
      
      // Filtre par superviseur (ID exact)
      if (supervisorId) {
        whereConditions.AND.push({
          OR: [
            { envoyeurId: supervisorId },
            { destinataireId: supervisorId }
          ]
        });
      }

      // Filtre par partenaire (ID exact)
      if (partnerId) {
        whereConditions.AND.push({
          partenaireId: partnerId
        });
      }

      // Filtre par opérateur (ID exact) - CORRECTION
      if (operatorId) {
        whereConditions.AND.push({
          OR: [
            { envoyeurId: operatorId },
            { destinataireId: operatorId }
          ]
        });
      }

      // ====== FILTRAGE PAR NOM ======
      
      // Recherche par nom de superviseur
      if (supervisorName && typeof supervisorName === 'string' && supervisorName.trim()) {
        whereConditions.AND.push({
          OR: [
            {
              envoyeur: {
                nomComplet: {
                  contains: supervisorName.trim()
                }
              }
            },
            {
              destinataire: {
                nomComplet: {
                  contains: supervisorName.trim()
                }
              }
            }
          ]
        });
      }

      // Recherche par nom de partenaire
      if (partnerName && typeof partnerName === 'string' && partnerName.trim()) {
        whereConditions.AND.push({
          partenaire: {
            nomComplet: {
              contains: partnerName.trim()
            }
          }
        });
      }

      // Recherche par nom d'opérateur
      if (operatorName && typeof operatorName === 'string' && operatorName.trim()) {
        whereConditions.AND.push({
          OR: [
            {
              envoyeur: {
                nomComplet: {
                  contains: operatorName.trim()
                }
              }
            },
            {
              destinataire: {
                nomComplet: {
                  contains: operatorName.trim()
                }
              }
            }
          ]
        });
      }

      // ====== RECHERCHE GLOBALE ======
      
      // Recherche globale par nom d'utilisateur (tous rôles confondus)
      if (userName && typeof userName === 'string' && userName.trim()) {
        whereConditions.AND.push({
          OR: [
            {
              envoyeur: {
                nomComplet: {
                  contains: userName.trim()
                }
              }
            },
            {
              destinataire: {
                nomComplet: {
                  contains: userName.trim()
                }
              }
            },
            {
              partenaire: {
                nomComplet: {
                  contains: userName.trim()
                }
              }
            }
          ]
        });
      }

      // Recherche textuelle générale (description + noms)
      if (search && typeof search === 'string' && search.trim()) {
        whereConditions.AND.push({
          OR: [
            {
              description: {
                contains: search.trim()
              }
            },
            {
              envoyeur: {
                nomComplet: {
                  contains: search.trim()
                }
              }
            },
            {
              destinataire: {
                nomComplet: {
                  contains: search.trim()
                }
              }
            },
            {
              partenaire: {
                nomComplet: {
                  contains: search.trim()
                }
              }
            }
          ]
        });
      }

      // ====== AUTRES FILTRES ======

      // Filtre par type de transaction
      if (transactionType && transactionType.toLowerCase() !== 'all' && transactionType.trim() !== '') {
        let typeFilter;
        switch (transactionType.toLowerCase()) {
          case 'depot':
          case 'depots':
            typeFilter = { type: { in: ['DEPOT', 'DEBUT_JOURNEE'] } };
            break;
          case 'retrait':
          case 'retraits':
            typeFilter = { type: { in: ['RETRAIT', 'FIN_JOURNEE'] } };
            break;
          case 'transfert':
          case 'transferts':
            typeFilter = { type: { in: ['TRANSFERT_ENVOYE', 'TRANSFERT_RECU'] } };
            break;
          case 'allocation':
          case 'allocations':
            typeFilter = { type: 'ALLOCATION_UV_MASTER' };
            break;
          default:
            const validTypes = ['DEPOT', 'RETRAIT', 'TRANSFERT_ENVOYE', 'TRANSFERT_RECU', 'ALLOCATION_UV_MASTER', 'DEBUT_JOURNEE', 'FIN_JOURNEE'];
            if (validTypes.includes(transactionType.toUpperCase())) {
              typeFilter = { type: transactionType.toUpperCase() };
            }
        }
        if (typeFilter) {
          whereConditions.AND.push(typeFilter);
        }
      }

      // Filtre par type de compte
      if (accountType && accountType.toLowerCase() !== 'all' && accountType.trim() !== '') {
        const validAccountTypes = ['LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER'];
        if (validAccountTypes.includes(accountType.toUpperCase())) {
          whereConditions.AND.push({
            compteDestination: {
              type: accountType.toUpperCase()
            }
          });
        }
      }

      const skip = (page - 1) * limit;

      // Requête principale avec tous les includes nécessaires
      const transactions = await prisma.transaction.findMany({
        where: whereConditions.AND.length > 0 ? whereConditions : {},
        include: {
          envoyeur: {
            select: {
              id: true,
              nomComplet: true,
              role: true,
              telephone: true
            }
          },
          destinataire: {
            select: {
              id: true,
              nomComplet: true,
              role: true,
              telephone: true
            }
          },
          partenaire: {
            select: {
              id: true,
              nomComplet: true,
              telephone: true
            }
          },
          compteDestination: {
            select: {
              type: true
            }
          }
        },
        orderBy: {
          [sortBy]: sortOrder
        },
        skip,
        take: limit
      });

      // Compter le total pour la pagination
      const totalCount = await prisma.transaction.count({
        where: whereConditions.AND.length > 0 ? whereConditions : {}
      });

      // Formatage amélioré des transactions
      const formattedTransactions = transactions.map(tx => {
        const montant = Number(tx.montant) / 100;
        
        // Déterminer l'intervenant principal avec rôle
        let intervenant = { nom: 'ADMIN', role: 'ADMIN', id: null };
        
        if (tx.partenaire) {
          intervenant = {
            nom: `part-${tx.partenaire.nomComplet}`,
            role: 'PARTENAIRE',
            id: tx.partenaire.id,
            telephone: tx.partenaire.telephone
          };
        } else if (tx.envoyeur && tx.envoyeur.role !== 'ADMIN') {
          intervenant = {
            nom: `sup-${tx.envoyeur.nomComplet}`,
            role: tx.envoyeur.role,
            id: tx.envoyeur.id,
            telephone: tx.envoyeur.telephone
          };
        } else if (tx.destinataire && tx.destinataire.role !== 'ADMIN') {
          intervenant = {
            nom: `sup-${tx.destinataire.nomComplet}`,
            role: tx.destinataire.role,
            id: tx.destinataire.id,
            telephone: tx.destinataire.telephone
          };
        }

        // Déterminer le superviseur concerné
        let superviseur = { nom: 'N/A', id: null };
        if (tx.destinataire?.role === 'SUPERVISEUR') {
          superviseur = {
            nom: tx.destinataire.nomComplet,
            id: tx.destinataire.id
          };
        } else if (tx.envoyeur?.role === 'SUPERVISEUR') {
          superviseur = {
            nom: tx.envoyeur.nomComplet,
            id: tx.envoyeur.id
          };
        }

        return {
          id: tx.id,
          dateHeure: tx.createdAt.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          intervenant,
          type: {
            code: tx.type,
            label: this.getTransactionTypeLabel(tx.type),
            category: this.getTransactionCategory(tx.type)
          },
          montant: {
            valeur: montant,
            formatted: this.formatAmount(montant),
            signe: ['DEPOT', 'DEBUT_JOURNEE', 'ALLOCATION_UV_MASTER', 'TRANSFERT_RECU'].includes(tx.type) ? '+' : '-'
          },
          compte: tx.compteDestination?.type || 'N/A',
          superviseur,
          description: tx.description,
          statut: 'Validé ✅',
          // Métadonnées pour filtrage frontend
          metadata: {
            hasPartner: !!tx.partenaire,
            hasSupervisor: superviseur.id !== null,
            hasOperator: [tx.envoyeur, tx.destinataire].some(u => u?.role === 'OPERATEUR')
          }
        };
      });

      // Statistiques enrichies
      const stats = this.calculateEnhancedStats(transactions);

      // Informations de pagination
      const totalPages = Math.ceil(totalCount / limit);

      return {
        transactions: formattedTransactions,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
          limit
        },
        stats,
        filters: {
          applied: filters,
          summary: `${totalCount} transaction(s) trouvée(s) avec les filtres appliqués`
        }
      };

    } catch (error) {
      console.error('Erreur getRecentTransactionsWithFilters:', error);
      throw new Error('Erreur lors de la récupération des transactions avec filtres avancés');
    }
  }

  // =====================================
  // PAGINATION SPÉCIFIQUE PAR 5
  // =====================================

  async getTransactionsPaginatedByFive(filters = {}, page = 1) {
    return await this.getRecentTransactionsWithFilters(filters, { page, limit: 5 });
  }

  // =====================================
  // RECHERCHE D'ENTITÉS
  // =====================================

  async searchEntities(query, type = 'all', limit = 10) {
    try {
      const searchTerm = query.trim();
      const results = {
        superviseurs: [],
        partenaires: [],
        operateurs: [],
        total: 0
      };

      if (type === 'all' || type === 'superviseur') {
        results.superviseurs = await prisma.user.findMany({
          where: {
            role: 'SUPERVISEUR',
            status: 'ACTIVE',
            nomComplet: {
              contains: searchTerm
            }
          },
          select: {
            id: true,
            nomComplet: true,
            telephone: true
          },
          take: limit
        });
      }

      if (type === 'all' || type === 'partenaire') {
        results.partenaires = await prisma.user.findMany({
          where: {
            role: 'PARTENAIRE',
            status: 'ACTIVE',
            nomComplet: {
              contains: searchTerm
            }
          },
          select: {
            id: true,
            nomComplet: true,
            telephone: true
          },
          take: limit
        });
      }

      if (type === 'all' || type === 'operateur') {
        results.operateurs = await prisma.user.findMany({
          where: {
            role: 'OPERATEUR',
            status: 'ACTIVE',
            nomComplet: {
              contains: searchTerm
            }
          },
          select: {
            id: true,
            nomComplet: true,
            telephone: true
          },
          take: limit
        });
      }

      results.total = results.superviseurs.length + results.partenaires.length + results.operateurs.length;

      return results;

    } catch (error) {
      console.error('Erreur searchEntities:', error);
      throw new Error('Erreur lors de la recherche d\'entités');
    }
  }

  // =====================================
  // VÉRIFICATION DE SOLDE
  // =====================================

  async checkAccountBalance(supervisorId, accountType, amount) {
    try {
      const account = await prisma.account.findFirst({
        where: {
          userId: supervisorId,
          type: accountType.toUpperCase()
        }
      });

      if (!account) {
        return {
          exists: false,
          sufficient: false,
          currentBalance: 0,
          requested: parseFloat(amount) || 0
        };
      }

      const currentBalance = Number(account.balance) / 100;
      const requestedAmount = parseFloat(amount) || 0;

      return {
        exists: true,
        sufficient: currentBalance >= requestedAmount,
        currentBalance,
        requested: requestedAmount,
        difference: currentBalance - requestedAmount
      };

    } catch (error) {
      console.error('Erreur checkAccountBalance:', error);
      throw new Error('Erreur lors de la vérification du solde');
    }
  }

  // =====================================
  // EXPORT EXCEL/CSV
  // =====================================

  async exportTransactionsToExcel(filters, userRole) {
    try {
      // Récupérer toutes les transactions selon les filtres
      const result = await this.getRecentTransactionsWithFilters(filters, { limit: 5000 });

      const exportData = result.transactions.map(tx => ({
        'Date et Heure': tx.dateHeure,
        'Intervenant': tx.intervenant.nom,
        'Rôle': tx.intervenant.role,
        'Type Transaction': tx.type.label,
        'Montant (F CFA)': tx.montant.valeur,
        'Compte': tx.compte,
        'Superviseur': tx.superviseur.nom,
        'Description': tx.description,
        'Statut': tx.statut.replace(/[✅⏳]/g, '').trim()
      }));

      const metadata = {
        nomFichier: `transactions_${new Date().toISOString().split('T')[0]}_${userRole.toLowerCase()}.json`,
        dateExport: new Date().toISOString(),
        nombreTransactions: exportData.length,
        filtresAppliques: filters,
        exportePar: userRole
      };

      return {
        success: true,
        data: exportData,
        metadata
      };

    } catch (error) {
      console.error('Erreur exportTransactionsToExcel:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // =====================================
  // MÉTHODES UTILITAIRES
  // =====================================

  getTransactionCategory(type) {
    const categories = {
      'DEPOT': 'depot',
      'DEBUT_JOURNEE': 'depot',
      'TRANSFERT_RECU': 'depot',
      'ALLOCATION_UV_MASTER': 'allocation',
      'RETRAIT': 'retrait',
      'FIN_JOURNEE': 'retrait',
      'TRANSFERT_ENVOYE': 'transfert'
    };
    
    return categories[type] || 'autre';
  }

  calculateEnhancedStats(transactions) {
    const stats = {
      total: transactions.length,
      byType: {},
      byRole: {},
      byCategory: { depot: 0, retrait: 0, transfert: 0, allocation: 0 },
      amounts: { total: 0, entrees: 0, sorties: 0 }
    };

    transactions.forEach(tx => {
      const montant = Number(tx.montant) / 100;
      
      // Stats par type
      stats.byType[tx.type] = (stats.byType[tx.type] || 0) + 1;
      
      // Stats par rôle d'intervenant
      const role = tx.partenaire ? 'PARTENAIRE' : 
                   tx.envoyeur?.role || tx.destinataire?.role || 'ADMIN';
      stats.byRole[role] = (stats.byRole[role] || 0) + 1;
      
      // Stats par catégorie et montants
      const category = this.getTransactionCategory(tx.type);
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
      
      if (['DEPOT', 'DEBUT_JOURNEE', 'ALLOCATION_UV_MASTER', 'TRANSFERT_RECU'].includes(tx.type)) {
        stats.amounts.entrees += montant;
      } else {
        stats.amounts.sorties += montant;
      }
      
      stats.amounts.total += Math.abs(montant);
    });

    return stats;
  }

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

  getDateFilter(period) {
    const now = new Date();
    
    switch (period.toLowerCase()) {
      case 'today':
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return { gte: startOfDay, lte: endOfDay };
      case 'yesterday':
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
        return { gte: startOfYesterday, lte: endOfYesterday };
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
        return {};
    }
  }

  formatAmount(amount, withSign = false) {
    const absAmount = Math.abs(amount);
    
    if (absAmount >= 1000000) {
      const millions = (amount / 1000000).toFixed(1);
      return `${withSign && amount > 0 ? '+' : ''}${millions}M F`;
    } else if (absAmount >= 1000) {
      const thousands = Math.round(amount / 1000);
      return `${withSign && amount > 0 ? '+' : ''}${thousands}K F`;
    } else {
      return `${withSign && amount > 0 ? '+' : ''}${amount.toLocaleString()} F`;
    }
  }
}

export default new RecentTransactionService();