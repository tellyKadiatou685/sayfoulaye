// src/routes/transactionRoutes.js
import express from 'express';
import TransactionController from '../controllers/TransactionController.js';
import prisma from '../config/database.js';
import { 
  authenticateToken, 
  requireAdmin, 
  requireSupervisor, 
  requirePartner,
  requireSupervisorOrAdmin 
} from '../middleware/auth.js';

const router = express.Router();

// =====================================
// MIDDLEWARE DE VALIDATION
// =====================================

// Middleware de validation pour les montants
const validateAmount = (req, res, next) => {
  const { montant } = req.body;
  
  if (!montant || isNaN(montant) || montant <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Montant invalide - doit être un nombre positif'
    });
  }

  // Suppression de la limite de montant maximum
  
  next();
};

const validateAccountType = (req, res, next) => {
  const { typeCompte, partenaireId, partenaireNom } = req.body;
  
  // EXEMPTION pour les transactions partenaires (enregistrés OU libres)
  if (partenaireId || partenaireNom) {
    return next();
  }
  
  const validTypes = ['LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER', 'AUTRES'];
  
  if (!typeCompte || !validTypes.includes(typeCompte.toUpperCase())) {
    return res.status(400).json({
      success: false,
      message: `Type de compte invalide. Types autorisés: ${validTypes.join(', ')}`
    });
  }

  next();
};

// Middleware de validation pour les opérations
const validateOperation = (req, res, next) => {
  const { typeOperation } = req.body;
  
  if (!typeOperation) {
    return res.status(400).json({
      success: false,
      message: 'Type d\'opération requis'
    });
  }

  next();
};






router.patch('/supervisors/:supervisorId/accounts/update', 
  authenticateToken, 
  requireAdmin,
  TransactionController.updateSupervisorAccount
);













// 📊 Dashboard universel adapté au rôle connecté
router.get('/dashboard', 
  authenticateToken, 
  TransactionController.getDashboard
);

// Dans routes/transactionRoutes.js ou adminRoutes.js
router.get('/dashboard/dates/available', authenticateToken, TransactionController.getAvailableDates);
router.post('/dashboard/test-date-filter', authenticateToken, TransactionController.testDateFilter);

// 📊 Dashboard admin spécifique (tous les superviseurs)
router.get('/dashboard/admin', 
  authenticateToken, 
  requireAdmin, 
  TransactionController.getAdminDashboard
);

// Dans transactionRoutes.js

router.get('/test-yesterday-full-flow', async (req, res) => {
  try {
    const now = new Date();
    const today = now.toDateString();
    
    // Calculer la plage "hier"
    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(now.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    
    const yesterdayEnd = new Date(now);
    yesterdayEnd.setHours(0, 0, 0, -1);
    
    // Compter manuellement dans la DB
    const archivedCount = await prisma.transaction.count({
      where: {
        createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
        partenaireId: { not: null },
        archived: true
      }
    });
    
    const archivedTransactions = await prisma.transaction.findMany({
      where: {
        createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
        partenaireId: { not: null },
        archived: true
      },
      select: {
        id: true,
        type: true,
        montant: true,
        createdAt: true,
        partenaire: { select: { nomComplet: true } },
        destinataire: { select: { nomComplet: true } }
      }
    });
    
    // Vérifier reset detection
    const config = await prisma.systemConfig.findFirst({
      where: { key: 'last_reset_date' }
    });
    
    const resetDetected = config?.value?.includes(today) && config.value.includes('SUCCESS');
    
    res.json({
      currentTime: now.toISOString(),
      yesterdayRange: {
        start: yesterdayStart.toISOString(),
        end: yesterdayEnd.toISOString()
      },
      transactionsInDB: {
        count: archivedCount,
        transactions: archivedTransactions
      },
      resetDetection: {
        lastResetDate: config?.value,
        resetDetectedToday: resetDetected,
        shouldIncludeArchived: resetDetected && archivedCount > 0
      },
      nextStep: "Appelez maintenant GET /api/transactions/dashboard/admin?period=yesterday et comparez"
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.post('/force-show-yesterday', async (req, res) => {
  try {
    // 1. Forcer shouldIncludeArchivedTransactions à retourner true
    await prisma.systemConfig.upsert({
      where: { key: 'last_reset_date' },
      update: { value: `${new Date().toDateString()}-SUCCESS-forced` },
      create: { key: 'last_reset_date', value: `${new Date().toDateString()}-SUCCESS-forced` }
    });

    // 2. Mettre les transactions exactement dans la plage d'hier
    const now = new Date();
    const yesterdayMidday = new Date(now);
    yesterdayMidday.setDate(now.getDate() - 1);
    yesterdayMidday.setHours(12, 0, 0, 0);

    await prisma.transaction.updateMany({
      where: {
        archived: true,
        partenaireId: { not: null }
      },
      data: {
        createdAt: yesterdayMidday,
        archived: true,
        archivedAt: now
      }
    });

    res.json({
      success: true,
      message: "Transactions forcées dans Hier",
      instruction: "Rafraîchissez la page et cliquez sur Hier"
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 👤 Dashboard superviseur spécifique
router.get('/dashboard/supervisor/:supervisorId?', 
  authenticateToken, 
  requireSupervisorOrAdmin, 
  TransactionController.getSupervisorDashboard
);

// 🤝 Dashboard partenaire spécifique
router.get('/dashboard/partner', 
  authenticateToken, 
  requirePartner, 
  TransactionController.getPartnerDashboard
);

// =====================================
// CRÉATION DE TRANSACTIONS
// =====================================

// ⚡ Transaction universelle (route principale)
router.post('/create', 
  authenticateToken,
  validateAmount,
  validateAccountType,
  validateOperation,
  TransactionController.createTransaction
);

// 💰 Transaction admin spécifique (dépôt/retrait direct)
router.post('/admin/create', 
  authenticateToken, 
  requireAdmin,
  validateAmount,
  validateAccountType,
  validateOperation,
  TransactionController.createAdminTransaction
);

// =====================================
// UTILITAIRES ET HELPERS
// =====================================

// 👥 Liste des superviseurs disponibles (pour partenaires)
router.get('/supervisors/available', 
  authenticateToken, 
  requirePartner, 
  TransactionController.getAvailableSupervisors
);

// 📊 Liste des partenaires actifs (pour superviseurs/admin)
router.get('/partners/active', 
  authenticateToken, 
  requireSupervisorOrAdmin,
  async (req, res) => {
    try {
      const partners = await prisma.user.findMany({
        where: {
          role: 'PARTENAIRE',
          status: 'ACTIVE'
        },
        select: {
          id: true,
          nomComplet: true,
          telephone: true
        },
        orderBy: { nomComplet: 'asc' }
      });

      res.json({
        success: true,
        message: 'Liste des partenaires actifs',
        data: { partners }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des partenaires'
      });
    }
  }
);

router.get('/admin/daily-transfer/status', TransactionController.getDailyTransferStatus);
router.get('/admin/transactions/archived', TransactionController.getArchivedTransactions);

// 📊 Types de comptes disponibles
router.get('/account-types', 
  authenticateToken,
  (req, res) => {
    const accountTypes = [
      { key: 'LIQUIDE', label: 'Liquide', icon: '💵' },
      { key: 'ORANGE_MONEY', label: 'Orange Money', icon: '📱' },
      { key: 'WAVE', label: 'Wave', icon: '🌊' },
      { key: 'UV_MASTER', label: 'UV Master', icon: '⭐', adminOnly: true },
      { key: 'AUTRES', label: 'Autres', icon: '📦' }
    ];

    // Filtrer selon le rôle
    let filteredTypes = accountTypes;
    if (req.user.role !== 'ADMIN') {
      filteredTypes = accountTypes.filter(type => !type.adminOnly);
    }

    res.json({
      success: true,
      message: 'Types de comptes disponibles',
      data: { accountTypes: filteredTypes }
    });
  }
);



// =====================================
// GESTION D'ERREURS SPÉCIFIQUE AUX TRANSACTIONS
// =====================================

router.use((error, req, res, next) => {
  console.error('❌ Erreur dans transactionRoutes:', error);
  
  // Erreurs de solde insuffisant
  if (error.message.includes('solde insuffisant') || error.message.includes('Solde insuffisant')) {
    return res.status(400).json({
      success: false,
      message: 'Solde insuffisant pour effectuer cette opération',
      code: 'INSUFFICIENT_BALANCE'
    });
  }
  
  // Erreurs de compte non trouvé
  if (error.message.includes('compte non trouvé') || error.message.includes('Account not found')) {
    return res.status(404).json({
      success: false,
      message: 'Compte non trouvé',
      code: 'ACCOUNT_NOT_FOUND'
    });
  }
  
  // Erreurs de superviseur non trouvé
  if (error.message.includes('Superviseur non trouvé')) {
    return res.status(404).json({
      success: false,
      message: 'Superviseur non trouvé ou inactif',
      code: 'SUPERVISOR_NOT_FOUND'
    });
  }
  
  // Erreurs de validation Prisma
  if (error.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: 'Conflit de données - cette entrée existe déjà',
      code: 'DATA_CONFLICT'
    });
  }
  
  if (error.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Enregistrement non trouvé',
      code: 'RECORD_NOT_FOUND'
    });
  }
  
  // Erreurs de montant
  if (error.message.includes('montant') || error.message.includes('amount')) {
    return res.status(400).json({
      success: false,
      message: 'Montant invalide',
      code: 'INVALID_AMOUNT'
    });
  }
  
  // Erreurs de permissions
  if (error.message.includes('permission') || error.message.includes('autorisé')) {
    return res.status(403).json({
      success: false,
      message: 'Permissions insuffisantes pour cette opération',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
  }
  
  // Erreur générique
  res.status(500).json({
    success: false,
    message: 'Erreur interne du serveur lors de la transaction',
    code: 'TRANSACTION_ERROR',
    ...(process.env.NODE_ENV === 'development' && { details: error.message })
  });
});

export default router;