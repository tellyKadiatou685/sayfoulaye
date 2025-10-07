// src/routes/userRoutes.js
import express from 'express';
import UserController from '../controllers/UserController.js';
import { 
  authenticateToken, 
  requireAdmin, 
  requireSupervisor, 
  requirePartner,
  requireSupervisorOrAdmin 
} from '../middleware/auth.js';
import { 
  validateLogin, 
  validateRegistration, 
  validateCreateUser,
  handleValidationErrors 
} from '../middleware/validation.js';

const router = express.Router();

// =====================================
// ROUTES PUBLIQUES (pas d'authentification)
// =====================================

// 🔐 Connexion
router.post('/login', 
  validateLogin, 
  handleValidationErrors, 
  UserController.login
);

// 📝 Demande d'inscription partenaire (public)
router.post('/register-request', 
  validateRegistration, 
  handleValidationErrors, 
  UserController.requestRegistration
);

// =====================================
// ROUTES AUTHENTIFIÉES (toutes nécessitent un token)
// =====================================

// 🚪 Déconnexion
router.post('/logout', 
  authenticateToken, 
  UserController.logout
);

// 👤 Profil utilisateur connecté
router.get('/profile', 
  authenticateToken, 
  UserController.getProfile
);


// =====================================
// NOTIFICATIONS (tous les rôles)
// =====================================
router.get('/partners', 
  authenticateToken, 
  requireSupervisorOrAdmin, 
  UserController.getPartners
);
// 🔔 Mes notifications
router.get('/notifications', 
  authenticateToken, 
  UserController.getNotifications
);

router.get('/partners', 
  authenticateToken, 
  requireSupervisorOrAdmin, 
  UserController.getPartners
);

// ✅ Marquer notification comme lue
router.patch('/notifications/:notificationId/read', 
  authenticateToken, 
  UserController.markNotificationRead
);

// =====================================
// ROUTES ADMIN SEULEMENT
// =====================================

// 📋 Demandes d'inscription en attente
router.get('/registration-requests', 
  authenticateToken, 
  requireAdmin, 
  UserController.getPendingRegistrations
);

// ✅ Approuver demande d'inscription
router.patch('/registration-requests/:requestId/approve', 
  authenticateToken, 
  requireAdmin, 
  UserController.approveRegistration
);

// ❌ Rejeter demande d'inscription
router.patch('/registration-requests/:requestId/reject', 
  authenticateToken, 
  requireAdmin, 
  UserController.rejectRegistration
);

// 👥 Créer utilisateur directement
router.post('/create', 
  authenticateToken, 
  requireAdmin, 
  validateCreateUser, 
  handleValidationErrors, 
  UserController.createUser
);

// 👥 Liste de tous les utilisateurs
router.get('/all', 
  authenticateToken, 
  requireAdmin, 
  UserController.getAllUsers
);

// ⏸️ Suspendre utilisateur
router.patch('/:userId/suspend', 
  authenticateToken, 
  requireAdmin, 
  UserController.suspendUser
);

// ▶️ Réactiver utilisateur
router.patch('/:userId/activate', 
  authenticateToken, 
  requireAdmin, 
  UserController.activateUser
);

// 🗑️ Supprimer utilisateur
router.delete('/:userId', 
  authenticateToken, 
  requireAdmin, 
  UserController.deleteUser
);

// 📢 Diffuser notification à tous les utilisateurs d'un rôle
router.post('/broadcast-notification', 
  authenticateToken, 
  requireAdmin, 
  UserController.broadcastNotification
);

// =====================================
// ROUTES SUPERVISEUR + ADMIN
// =====================================

// Exemple de route nécessitant superviseur OU admin
// router.get('/supervisors-only', 
//   authenticateToken, 
//   requireSupervisorOrAdmin, 
//   UserController.someMethodForSupervisorsAndAdmins
// );

// =====================================
// ROUTES PARTENAIRE SEULEMENT
// =====================================

// Exemple de routes réservées aux partenaires
// router.get('/partner-specific', 
//   authenticateToken, 
//   requirePartner, 
//   UserController.someMethodForPartnersOnly
// );

// =====================================
// MIDDLEWARE DE GESTION D'ERREURS SPÉCIFIQUE AUX ROUTES USERS
// =====================================

// Gestion d'erreurs pour les routes utilisateurs
router.use((error, req, res, next) => {
  console.error('❌ Erreur dans userRoutes:', error);
  
  // Erreurs de validation Prisma
  if (error.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: 'Conflit: cette donnée existe déjà (probablement numéro de téléphone)'
    });
  }
  
  // Erreurs de token JWT
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token invalide. Veuillez vous reconnecter.'
    });
  }
  
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Votre session a expiré. Veuillez vous reconnecter.'
    });
  }
  
  // Erreur générique
  res.status(500).json({
    success: false,
    message: 'Erreur interne du serveur'
  });
});

export default router;