// src/controllers/TransactionController.js
import TransactionService from '../services/TransactionService.js';
import NotificationService from '../services/NotificationService.js';
import prisma from '../config/database.js'; 

class TransactionController {
  // =====================================
  // DASHBOARDS SELON RÔLE
  // =====================================

  // 📊 DASHBOARD UNIVERSEL (adapté selon le rôle connecté)
  async getDashboard(req, res) {
    try {
      const user = req.user;
      const { period = 'today' } = req.query;

      let dashboardData;

      switch (user.role) {
        case 'ADMIN':
          dashboardData = await TransactionService.getAdminDashboard(period);
          break;
        case 'SUPERVISEUR':
          dashboardData = await TransactionService.getSupervisorDashboard(user.id, period);
          break;
        case 'PARTENAIRE':
          dashboardData = await TransactionService.getPartnerDashboard(user.id, period);
          break;
        default:
          throw new Error('Rôle utilisateur non reconnu');
      }

      res.json({
        success: true,
        message: `Dashboard ${user.role.toLowerCase()} récupéré avec succès`,
        data: {
          userRole: user.role,
          period,
          dashboard: dashboardData
        }
      });

    } catch (error) {
      console.error('Erreur getDashboard:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération du dashboard'
      });
    }
  }

  // 📊 DASHBOARD ADMIN SPÉCIFIQUE (avec tous les superviseurs)
  async getAdminDashboard(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const { period = 'today' } = req.query;
      const dashboardData = await TransactionService.getAdminDashboard(period);

      res.json({
        success: true,
        message: 'Dashboard administrateur récupéré',
        data: dashboardData
      });

    } catch (error) {
      console.error('Erreur getAdminDashboard:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération du dashboard admin'
      });
    }
  }

  // 👤 DASHBOARD SUPERVISEUR SPÉCIFIQUE 
  async getSupervisorDashboard(req, res) {
    try {
      const supervisorId = req.params.supervisorId || req.user.id;
      const { period = 'today' } = req.query;

      // Vérification des permissions
      if (req.user.role !== 'ADMIN' && req.user.id !== supervisorId) {
        return res.status(403).json({
          success: false,
          message: 'Vous ne pouvez voir que votre propre dashboard'
        });
      }

      const dashboardData = await TransactionService.getSupervisorDashboard(supervisorId, period);

      res.json({
        success: true,
        message: 'Dashboard superviseur récupéré',
        data: dashboardData
      });

    } catch (error) {
      console.error('Erreur getSupervisorDashboard:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération du dashboard superviseur'
      });
    }
  }

  // 🤝 DASHBOARD PARTENAIRE SPÉCIFIQUE
  async getPartnerDashboard(req, res) {
    try {
      const partnerId = req.user.id;
      const { period = 'today' } = req.query;

      if (req.user.role !== 'PARTENAIRE') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux partenaires'
        });
      }

      const dashboardData = await TransactionService.getPartnerDashboard(partnerId, period);

      res.json({
        success: true,
        message: 'Dashboard partenaire récupéré',
        data: dashboardData
      });

    } catch (error) {
      console.error('Erreur getPartnerDashboard:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération du dashboard partenaire'
      });
    }
  }

  // =====================================
  // CRÉATION DE TRANSACTIONS
  // =====================================

  // ⚡ TRANSACTION UNIVERSELLE (admin/superviseur/partenaire)
  async createTransaction(req, res) {
    try {
      const user = req.user;
      const transactionData = req.body;

      // ✅ CONVERSION SÉCURISÉE DU MONTANT
      if (transactionData.montant) {
        transactionData.montant = parseFloat(transactionData.montant);
      }

      let result;

      switch (user.role) {
        case 'ADMIN':
          result = await TransactionService.createAdminTransaction(user.id, transactionData);
          break;
        case 'SUPERVISEUR':
          result = await TransactionService.createSupervisorTransaction(user.id, transactionData);
          break;
        case 'PARTENAIRE':
          result = await TransactionService.createPartnerTransaction(user.id, transactionData);
          break;
        default:
          throw new Error('Rôle non autorisé pour cette action');
      }

      res.status(201).json({
        success: true,
        message: 'Transaction créée avec succès',
        data: result
      });

    } catch (error) {
      console.error('Erreur createTransaction:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la création de la transaction'
      });
    }
  }

  // 💰 TRANSACTION ADMIN (dépôt/retrait direct) - VERSION CORRIGÉE
  async createAdminTransaction(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const adminId = req.user.id;
      const { superviseurId, typeCompte, typeOperation, montant, partenaireId } = req.body;

      // Validation des champs obligatoires
      if (!superviseurId || !typeCompte || !typeOperation || !montant) {
        return res.status(400).json({
          success: false,
          message: 'Données manquantes: superviseurId, typeCompte, typeOperation et montant requis'
        });
      }

      // ✅ CONVERSION SÉCURISÉE DU MONTANT
      const montantFloat = parseFloat(montant);
      
      if (isNaN(montantFloat) || montantFloat <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Le montant doit être un nombre positif'
        });
      }

      // Validation du type d'opération
      if (!['depot', 'retrait'].includes(typeOperation)) {
        return res.status(400).json({
          success: false,
          message: 'typeOperation doit être "depot" ou "retrait"'
        });
      }

      // Validation du type de compte
      const validAccountTypes = ['LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER'];
      if (!validAccountTypes.includes(typeCompte.toUpperCase())) {
        return res.status(400).json({
          success: false,
          message: 'Type de compte invalide'
        });
      }

      const result = await TransactionService.createAdminTransaction(adminId, {
        superviseurId,
        typeCompte: typeCompte.toUpperCase(),
        typeOperation,
        montant: montantFloat, // ✅ Passer en tant que Number
        partenaireId // Peut être null/undefined
      });

      // Réponse différenciée selon le type de transaction
      const isPartnerTransaction = !!partenaireId;
      const operationLabel = typeOperation === 'depot' ? 'Dépôt' : 'Retrait';
      const transactionTypeLabel = isPartnerTransaction 
        ? `${operationLabel} partenaire` 
        : `${operationLabel} journée`;

      res.status(201).json({
        success: true,
        message: `${transactionTypeLabel} créé avec succès`,
        data: {
          ...result,
          // Informations supplémentaires pour le frontend
          summary: {
            type: isPartnerTransaction ? 'PARTENAIRE' : 'JOURNEE',
            operation: typeOperation,
            superviseur: result.transaction.superviseurNom,
            partenaire: result.transaction.partnerName,
            montant: result.transaction.montant,
            typeCompte: typeCompte.toUpperCase(),
            soldeApres: result.soldeActuel
          }
        }
      });

    } catch (error) {
      console.error('Erreur createAdminTransaction:', error);
      
      // Gestion spécifique des erreurs
      if (error.message.includes('Superviseur non trouvé')) {
        return res.status(404).json({
          success: false,
          message: 'Superviseur non trouvé ou inactif'
        });
      }
      
      if (error.message.includes('Partenaire non trouvé')) {
        return res.status(404).json({
          success: false,
          message: 'Partenaire non trouvé ou inactif'
        });
      }
      
      if (error.message.includes('Solde insuffisant')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la création de la transaction admin'
      });
    }
  }

  // ✏️ Mettre à jour une transaction
  async updateTransaction(req, res) {
    console.log('🔄 [CONTROLLER] updateTransaction démarré:', {
      transactionId: req.params.transactionId,
      updateData: req.body,
      userId: req.user.id,
      userRole: req.user.role,
      timestamp: new Date().toISOString()
    });

    try {
      const { transactionId } = req.params;
      const updateData = req.body;
      const userId = req.user.id;

      // ✅ CONVERSION SÉCURISÉE DU MONTANT SI PRÉSENT
      if (updateData.montant) {
        updateData.montant = parseFloat(updateData.montant);
      }

      // Validation de base
      if (!transactionId) {
        return res.status(400).json({
          success: false,
          message: 'ID de transaction requis'
        });
      }

      if (!updateData || Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Données de mise à jour requises'
        });
      }

      // ✅ Appeler la méthode du service
      const result = await TransactionService.updateTransaction(transactionId, updateData, userId);

      console.log('✅ [CONTROLLER] Transaction mise à jour avec succès');

      res.json(result);

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur updateTransaction:', {
        error: error.message,
        stack: error.stack,
        transactionId: req.params.transactionId,
        updateData: req.body,
        userId: req.user?.id,
        timestamp: new Date().toISOString()
      });

      // Gestion des erreurs spécifiques
      if (error.message.includes('non trouvée') || error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      if (error.message.includes('Permissions insuffisantes') || error.message.includes('permissions')) {
        return res.status(403).json({
          success: false,
          message: error.message
        });
      }

      if (error.message.includes('montant') || error.message.includes('amount') || error.message.includes('validation')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        message: 'Erreur interne lors de la mise à jour de la transaction',
        ...(process.env.NODE_ENV === 'development' && { details: error.message })
      });
    }
  }

  // 📊 RÉCUPÉRER DÉTAILS D'UNE TRANSACTION
  async getTransactionDetails(req, res) {
    try {
      const { transactionId } = req.params;

      if (!transactionId) {
        return res.status(400).json({
          success: false,
          message: 'ID de transaction requis'
        });
      }

      // Logs pour debug
      console.log('🔍 [CONTROLLER] getTransactionDetails:', {
        transactionId,
        userId: req.user.id,
        userRole: req.user.role,
        timestamp: new Date().toISOString()
      });

      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: {
          envoyeur: {
            select: { id: true, nomComplet: true, role: true }
          },
          destinataire: {
            select: { id: true, nomComplet: true, role: true }
          },
          partenaire: {
            select: { id: true, nomComplet: true }
          },
          compteDestination: {
            select: { id: true, type: true, balance: true, initialBalance: true }
          }
        }
      });

      if (!transaction) {
        console.log('❌ [CONTROLLER] Transaction non trouvée:', transactionId);
        return res.status(404).json({
          success: false,
          message: 'Transaction non trouvée'
        });
      }

      console.log('📊 [CONTROLLER] Transaction trouvée:', {
        id: transaction.id,
        type: transaction.type,
        envoyeurId: transaction.envoyeurId,
        destinataireId: transaction.destinataireId,
        partenaireId: transaction.partenaireId
      });

      // PERMISSIONS CORRIGÉES - Plus permissives pour les superviseurs
      const isAdmin = req.user.role === 'ADMIN';
      const isSupervisor = req.user.role === 'SUPERVISEUR';
      const isPartner = req.user.role === 'PARTENAIRE';
      
      // Vérifier les permissions de visualisation
      let canView = false;
      let viewReason = '';

      if (isAdmin) {
        canView = true;
        viewReason = 'Admin - accès total';
      } else if (isSupervisor) {
        // CORRECTION: Superviseur peut voir ses transactions reçues ET envoyées
        if (req.user.id === transaction.destinataireId) {
          canView = true;
          viewReason = 'Superviseur - transaction reçue';
        } else if (req.user.id === transaction.envoyeurId) {
          canView = true;
          viewReason = 'Superviseur - transaction envoyée';
        }
        // AJOUT: Superviseur peut voir les transactions de ses partenaires
        else if (transaction.partenaireId) {
          canView = true;
          viewReason = 'Superviseur - transaction partenaire';
        }
      } else if (isPartner) {
        if (req.user.id === transaction.partenaireId || req.user.id === transaction.envoyeurId) {
          canView = true;
          viewReason = 'Partenaire - sa transaction';
        }
      }

      console.log('🔐 [CONTROLLER] Vérification permissions:', {
        userId: req.user.id,
        userRole: req.user.role,
        canView,
        viewReason,
        envoyeurId: transaction.envoyeurId,
        destinataireId: transaction.destinataireId,
        partenaireId: transaction.partenaireId
      });

      if (!canView) {
        console.log('❌ [CONTROLLER] Accès refusé - permissions insuffisantes');
        return res.status(403).json({
          success: false,
          message: 'Vous n\'avez pas accès à cette transaction',
          debug: {
            userRole: req.user.role,
            userId: req.user.id,
            transactionEnvoyeur: transaction.envoyeurId,
            transactionDestinataire: transaction.destinataireId,
            transactionPartenaire: transaction.partenaireId
          }
        });
      }

      // Calculer l'âge de la transaction
      const ageInDays = Math.floor((new Date() - new Date(transaction.createdAt)) / (1000 * 60 * 60 * 24));
      
      // Types modifiables
      const modifiableTypes = ['DEPOT', 'RETRAIT', 'DEBUT_JOURNEE', 'FIN_JOURNEE'];
      
      // PERMISSIONS SELON LE RÔLE - CORRIGÉES
      let canModify = false;
      let canDelete = false;
      let timeLimit = 0;
      let restrictions = [];

      if (isAdmin) {
        canModify = modifiableTypes.includes(transaction.type) && ageInDays <= 7;
        canDelete = modifiableTypes.includes(transaction.type) && ageInDays <= 7;
        timeLimit = 7;
        restrictions = [
          'Admin peut modifier toutes les transactions',
          'Limite de 7 jours après création'
        ];
      } else if (isSupervisor) {
        const isOwnTransaction = transaction.destinataireId === req.user.id;
        const isNotAdminCreated = !(['DEBUT_JOURNEE', 'FIN_JOURNEE'].includes(transaction.type) && 
                                     transaction.envoyeur?.role === 'ADMIN');
        
        // CORRECTION: Permissions plus souples pour les superviseurs
        canModify = isOwnTransaction && modifiableTypes.includes(transaction.type) && 
                    ageInDays <= 1;
        canDelete = isOwnTransaction && ['DEPOT', 'RETRAIT'].includes(transaction.type) && 
                    ageInDays <= 1;
        timeLimit = 1;
        
        restrictions = [
          'Superviseur peut modifier ses propres transactions seulement',
          'Limite de 1 jour après création'
        ];
        
        if (!isOwnTransaction) {
          restrictions.push('Cette transaction ne vous appartient pas');
        }
        if (!isNotAdminCreated) {
          restrictions.push('Transactions admin non modifiables');
        }
      } else {
        // Partenaires ne peuvent pas modifier
        restrictions = ['Les partenaires ne peuvent pas modifier les transactions'];
      }

      console.log('✅ [CONTROLLER] Permissions calculées:', {
        canView,
        canModify,
        canDelete,
        timeLimit,
        ageInDays,
        viewReason
      });

      res.json({
        success: true,
        message: 'Détails de la transaction récupérés',
        data: {
          transaction: {
            id: transaction.id,
            type: transaction.type,
            montant: Number(transaction.montant) / 100, // ✅ Conversion BigInt vers Number
            description: transaction.description,
            createdAt: transaction.createdAt,
            envoyeur: transaction.envoyeur,
            destinataire: transaction.destinataire,
            partenaire: transaction.partenaire,
            compte: transaction.compteDestination ? {
              ...transaction.compteDestination,
              balance: Number(transaction.compteDestination.balance) / 100, // ✅ Conversion
              initialBalance: Number(transaction.compteDestination.initialBalance) / 100 // ✅ Conversion
            } : null,
            metadata: transaction.metadata ? JSON.parse(transaction.metadata) : null
          },
          permissions: {
            canView: canView,
            canModify: canModify,
            canDelete: canDelete,
            userRole: req.user.role,
            timeLimit: `${timeLimit} jour(s)`,
            restrictions: restrictions,
            viewReason: viewReason
          },
          ageInDays,
          rules: {
            admin: {
              timeLimit: 7,
              canModifyAll: true,
              canDeleteAll: true
            },
            superviseur: {
              timeLimit: 1,
              canModifyOwn: true,
              canDeleteOwn: 'DEPOT/RETRAIT seulement',
              restrictions: [
                'Seulement ses propres transactions',
                'Maximum 24h après création'
              ]
            },
            partenaire: {
              canView: 'Ses propres transactions seulement',
              canModify: false,
              canDelete: false
            }
          }
        }
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur getTransactionDetails:', {
        error: error.message,
        stack: error.stack,
        transactionId: req.params.transactionId,
        userId: req.user?.id,
        userRole: req.user?.role
      });
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des détails de la transaction',
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // 📋 HISTORIQUE DES MODIFICATIONS (Admin)
  async getTransactionAuditHistory(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const { page = 1, limit = 20, type = 'all' } = req.query;

      const whereClause = {
        type: { in: ['AUDIT_MODIFICATION', 'AUDIT_SUPPRESSION'] }
      };

      if (type === 'modifications') {
        whereClause.type = 'AUDIT_MODIFICATION';
      } else if (type === 'suppressions') {
        whereClause.type = 'AUDIT_SUPPRESSION';
      }

      const [auditTransactions, totalCount] = await Promise.all([
        prisma.transaction.findMany({
          where: whereClause,
          include: {
            envoyeur: {
              select: { nomComplet: true }
            },
            destinataire: {
              select: { nomComplet: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit)
        }),
        prisma.transaction.count({ where: whereClause })
      ]);

      const formattedAudit = auditTransactions.map(audit => ({
        id: audit.id,
        type: audit.type,
        description: audit.description,
        createdAt: audit.createdAt,
        adminResponsable: audit.envoyeur.nomComplet,
        superviseurConcerne: audit.destinataire.nomComplet,
        montant: Number(audit.montant) / 100, // ✅ Conversion BigInt
        metadata: audit.metadata ? JSON.parse(audit.metadata) : null
      }));

      res.json({
        success: true,
        message: `${auditTransactions.length} enregistrement(s) d'audit trouvé(s)`,
        data: {
          auditHistory: formattedAudit,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalCount,
            limit: parseInt(limit)
          }
        }
      });

    } catch (error) {
      console.error('Erreur getTransactionAuditHistory:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de l\'historique d\'audit'
      });
    }
  }

  // 🔧 MISE À JOUR COMPTE SUPERVISEUR (Admin seulement)
  async updateSupervisorAccount(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const { supervisorId } = req.params;
      const { accountType, accountKey, newValue, updatedBy } = req.body;

      // Validation des données
      if (!accountType || !accountKey || newValue === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Données manquantes: accountType, accountKey et newValue requis'
        });
      }

      // ✅ CONVERSION SÉCURISÉE DU MONTANT
      const newValueFloat = parseFloat(newValue);
      
      if (isNaN(newValueFloat) || newValueFloat < 0) {
        return res.status(400).json({
          success: false,
          message: 'La valeur doit être un nombre positif'
        });
      }

      // Vérifier que le superviseur existe
      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId, role: 'SUPERVISEUR' }
      });

      if (!supervisor) {
        return res.status(404).json({
          success: false,
          message: 'Superviseur non trouvé'
        });
      }

      const result = await TransactionService.updateSupervisorAccount(
        supervisorId,
        accountType,
        accountKey,
        newValueFloat, // ✅ Passer en tant que Number
        req.user.id
      );

      res.json({
        success: true,
        message: `Compte ${accountKey} mis à jour avec succès`,
        data: {
          supervisorId,
          accountType,
          accountKey,
          oldValue: result.oldValue,
          newValue: result.newValue,
          updatedAt: new Date(),
          updatedBy: req.user.nomComplet
        }
      });

    } catch (error) {
      console.error('Erreur updateSupervisorAccount:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la mise à jour du compte'
      });
    }
  }

  // 👥 SUPERVISEURS DISPONIBLES (pour partenaires)
  async getAvailableSupervisors(req, res) {
    try {
      if (req.user.role !== 'PARTENAIRE') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux partenaires'
        });
      }

      const supervisors = await TransactionService.getActiveSupervisors();

      res.json({
        success: true,
        message: 'Liste des superviseurs disponibles',
        data: { supervisors }
      });

    } catch (error) {
      console.error('Erreur getAvailableSupervisors:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération des superviseurs'
      });
    }
  }
}

export default new TransactionController();