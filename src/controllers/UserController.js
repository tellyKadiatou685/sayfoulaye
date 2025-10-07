// src/controllers/UserController.js
import UserService from '../services/UserService.js';
import prisma from '../config/database.js'; 

class UserController {
  // =====================================
  // AUTHENTIFICATION
  // =====================================

  // 🔐 CONNEXION UTILISATEUR
  async login(req, res) {
    try {
      const { telephone, Code } = req.body;
      
      const result = await UserService.login(telephone, Code);
      
      res.json({
        success: true,
        message: `Connexion réussie ! Bienvenue ${result.user.nomComplet}`,
        data: result
      });
    } catch (error) {
      console.error('❌ Erreur connexion:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // 🚪 DÉCONNEXION
  async logout(req, res) {
    try {
      res.json({
        success: true,
        message: 'Déconnexion réussie. À bientôt !'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la déconnexion'
      });
    }
  }

  // 👤 PROFIL UTILISATEUR CONNECTÉ
  async getProfile(req, res) {
    try {
      const user = req.user; // Vient du middleware auth
      
      res.json({
        success: true,
        message: 'Profil récupéré avec succès',
        data: {
          user: {
            id: user.id,
            telephone: user.telephone,
            nomComplet: user.nomComplet,
            adresse: user.adresse,
            role: user.role,
            status: user.status
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du profil'
      });
    }
  }

  // =====================================
  // DEMANDES D'INSCRIPTION PARTENAIRES
  // =====================================

  // 📝 DEMANDE D'INSCRIPTION PARTENAIRE
  async requestRegistration(req, res) {
    try {
      const { telephone, nomComplet, adresse, message } = req.body;
      
      const request = await UserService.requestRegistration(telephone, nomComplet, adresse, message);
      
      res.status(201).json({
        success: true,
        message: 'Votre demande d\'inscription a été envoyée avec succès. L\'administrateur va l\'examiner.',
        data: {
          id: request.id,
          telephone: request.telephone,
          nomComplet: request.nomComplet,
          status: request.status,
          createdAt: request.createdAt
        }
      });
    } catch (error) {
      console.error('❌ Erreur inscription:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // 📋 DEMANDES EN ATTENTE (Admin)
  async getPendingRegistrations(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      
      const result = await UserService.getPendingRegistrations({
        page: parseInt(page),
        limit: parseInt(limit)
      });
      
      res.json({
        success: true,
        message: `${result.requests.length} demande(s) d'inscription en attente`,
        data: result
      });
    } catch (error) {
      console.error('❌ Erreur demandes en attente:', error.message);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des demandes d\'inscription'
      });
    }
  }

  // ✅ APPROUVER DEMANDE (Admin)
  async approveRegistration(req, res) {
    try {
      const { requestId } = req.params;
      const adminId = req.user.id;
      
      const result = await UserService.approveRegistration(adminId, requestId);
      
      res.json({
        success: true,
        message: `Demande approuvée ! Nouveau partenaire: ${result.user.nomComplet}`,
        data: {
          user: result.user,
          codeAcces: result.codeAcces,
          notification: `Code d'accès généré: ${result.codeAcces}`
        }
      });
    } catch (error) {
      console.error('❌ Erreur approbation:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // ❌ REJETER DEMANDE (Admin)
  async rejectRegistration(req, res) {
    try {
      const { requestId } = req.params;
      const { reason } = req.body;
      const adminId = req.user.id;
      
      const result = await UserService.rejectRegistration(adminId, requestId, reason);
      
      res.json({
        success: true,
        message: 'Demande d\'inscription rejetée',
        data: result
      });
    } catch (error) {
      console.error('❌ Erreur rejet:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // =====================================
  // GESTION UTILISATEURS (Admin)
  // =====================================

  // 👥 CRÉER UTILISATEUR DIRECTEMENT (Admin)
  async createUser(req, res) {
    try {
      const { telephone, nomComplet, role, adresse } = req.body;
  
      // Validation des données
      if (!telephone || !nomComplet || !role) {
        return res.status(400).json({
          success: false,
          message: 'Données manquantes: telephone, nomComplet et role requis'
        });
      }
  
      const result = await UserService.createUser({
        telephone,
        nomComplet,
        role,
        adresse
      });
  
      res.status(201).json({
        success: true,
        message: `Nouveau ${role.toLowerCase()} créé avec succès !`,
        data: result
      });
    } catch (error) {
      console.error('❌ Erreur création utilisateur:', error.message);
      
      res.status(500).json({
        success: false,
        message: error.message.includes('unique') 
          ? 'Ce numéro de téléphone est déjà utilisé'
          : 'Erreur lors de la création de l\'utilisateur'
      });
    }
  }

  // 👥 LISTE DES UTILISATEURS (Admin)
  async getAllUsers(req, res) {
    try {
      const { 
        role, 
        status, 
        search, 
        page = 1, 
        limit = 20,
        showCodes = false 
      } = req.query;
      
      // ✅ Vérifier si l'utilisateur est admin
      const isAdmin = req.user && req.user.role === 'ADMIN';
      
      if (showCodes === 'true' && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Seuls les administrateurs peuvent voir les codes d\'accès'
        });
      }
      
      const result = await UserService.getAllUsers({
        role,
        status,
        search,
        page: parseInt(page),
        limit: parseInt(limit),
        showCodes: isAdmin && showCodes === 'true'
      });

      res.json({
        success: true,
        message: `${result.users.length} utilisateur(s) trouvé(s)`,
        data: {
          ...result,
          codesDisplayed: isAdmin && showCodes === 'true',
          adminHelp: isAdmin ? {
            showCodes: "Ajoutez ?showCodes=true pour voir les codes d'accès",
            regenerateCode: "POST /api/users/:userId/regenerate-code pour régénérer",
            getCode: "GET /api/users/:userId/code pour voir le code spécifique"
          } : null
        }
      });
    } catch (error) {
      console.error('❌ Erreur récupération utilisateurs:', error.message);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de la liste des utilisateurs'
      });
    }
  }

  // ⏸️ SUSPENDRE UTILISATEUR (Admin)
  async suspendUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      
      const user = await UserService.suspendUser(userId, reason);
      
      res.json({
        success: true,
        message: `L'utilisateur ${user.nomComplet} a été suspendu`,
        data: user
      });
    } catch (error) {
      console.error('❌ Erreur suspension:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // ▶️ RÉACTIVER UTILISATEUR (Admin)
  async activateUser(req, res) {
    try {
      const { userId } = req.params;
      
      const user = await UserService.activateUser(userId);
      
      res.json({
        success: true,
        message: `L'utilisateur ${user.nomComplet} a été réactivé`,
        data: user
      });
    } catch (error) {
      console.error('❌ Erreur réactivation:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // 🗑️ SUPPRIMER UTILISATEUR (Admin)


// 🗑️ SUPPRIMER UTILISATEUR (Admin)
// Contrôleur deleteUser corrigé (remplacez votre version actuelle)


async deleteUser(req, res) {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    
    // La raison est optionnelle - peut venir du body ou query params
    const reason = req.body.reason || req.query.reason || null;

    console.log('🗑️ [CONTROLLER] Suppression utilisateur:', {
      userId,
      adminId,
      reason: reason || 'Aucune raison fournie',
      timestamp: new Date().toISOString()
    });

    // Validation de base
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'ID utilisateur requis'
      });
    }

    if (!adminId) {
      return res.status(403).json({
        success: false,
        message: 'Authentification admin requise'
      });
    }

    // Appel du service (la raison est optionnelle)
    const result = await UserService.deleteUser(adminId, userId, reason);

    console.log('✅ [CONTROLLER] Utilisateur supprimé avec succès:', {
      deletedUserId: userId,
      auditId: result.audit?.id
    });

    res.json({
      success: true,
      message: 'Utilisateur supprimé avec succès',
      data: result
    });

  } catch (error) {
    console.error('❌ [CONTROLLER] Erreur suppression:', {
      error: error.message,
      stack: error.stack,
      userId: req.params.userId,
      adminId: req.user?.id,
      timestamp: new Date().toISOString()
    });
    
    // Gestion des erreurs spécifiques
    if (error.message.includes('introuvable')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('Impossible de supprimer')) {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('soldes non nuls')) {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'USER_HAS_BALANCE'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur interne lors de la suppression de l\'utilisateur',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
}
  // =====================================
  // NOUVELLES MÉTHODES POUR CODES D'ACCÈS
  // =====================================

  // 🔍 OBTENIR LE CODE D'UN UTILISATEUR SPÉCIFIQUE (Admin)
  async getUserCode(req, res) {
    try {
      const { userId } = req.params;

      // Vérifier que c'est un admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const result = await UserService.getUserAccessCode(userId);

      res.json({
        success: true,
        message: `Code d'accès de ${result.user.nomComplet}`,
        data: result
      });
    } catch (error) {
      console.error('❌ Erreur récupération code:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // 🔄 RÉGÉNÉRER LE CODE D'ACCÈS (Admin)
  async regenerateUserCode(req, res) {
    try {
      const { userId } = req.params;

      // Vérifier que c'est un admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const result = await UserService.regenerateAccessCode(userId);

      res.json({
        success: true,
        message: `Nouveau code généré pour ${result.user.nomComplet}`,
        data: {
          user: {
            id: result.user.id,
            nomComplet: result.user.nomComplet,
            telephone: result.user.telephone,
            role: result.user.role
          },
          nouveauCode: result.newCode,
          notification: `L'utilisateur a été notifié du nouveau code: ${result.newCode}`
        }
      });
    } catch (error) {
      console.error('❌ Erreur régénération code:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // 📊 STATISTIQUES CODES D'ACCÈS (Admin)
  async getCodesStats(req, res) {
    try {
      // Vérifier que c'est un admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const stats = await UserService.getAccessCodesStats();

      res.json({
        success: true,
        message: 'Statistiques des codes d\'accès',
        data: stats
      });
    } catch (error) {
      console.error('❌ Erreur stats codes:', error.message);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors du calcul des statistiques'
      });
    }
  }

  // 🔍 RECHERCHER UTILISATEUR PAR CODE (Admin) 
  async findUserByCode(req, res) {
    try {
      const { code } = req.query;

      // Vérifier que c'est un admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Code d\'accès requis'
        });
      }

      const result = await UserService.findUserByAccessCode(code);

      res.json({
        success: true,
        message: `Utilisateur trouvé: ${result.user.nomComplet}`,
        data: result
      });
    } catch (error) {
      console.error('❌ Erreur recherche par code:', error.message);
      
      if (error.message.includes('Aucun utilisateur trouvé')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        message: 'Erreur lors de la recherche'
      });
    }
  }

  // 📋 LISTE COMPLÈTE AVEC CODES (Admin)
  async getAllUsersWithCodes(req, res) {
    try {
      // Vérifier que c'est un admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const { 
        role, 
        status, 
        search, 
        page = 1, 
        limit = 50 
      } = req.query;

      const result = await UserService.getAllUsers({
        role,
        status,
        search,
        page: parseInt(page),
        limit: parseInt(limit),
        showCodes: true // Toujours afficher les codes pour cette méthode
      });

      res.json({
        success: true,
        message: `${result.users.length} utilisateur(s) avec codes d'accès`,
        data: {
          ...result,
          note: "Liste complète avec codes d'accès pour administration"
        }
      });
    } catch (error) {
      console.error('❌ Erreur liste avec codes:', error.message);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de la liste avec codes'
      });
    }
  }

  // 🔧 RÉINITIALISER TOUS LES CODES (Admin - Urgence)
  async resetAllCodes(req, res) {
    try {
      // Vérifier que c'est un admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }

      const { confirmReset } = req.body;

      if (confirmReset !== 'CONFIRM_RESET_ALL_CODES') {
        return res.status(400).json({
          success: false,
          message: 'Confirmation requise: confirmReset doit être "CONFIRM_RESET_ALL_CODES"'
        });
      }

      // Cette fonctionnalité nécessiterait une implémentation dans UserService
      // Pour l'instant, on retourne une réponse d'avertissement
      res.status(501).json({
        success: false,
        message: 'Fonctionnalité de réinitialisation globale non implémentée pour des raisons de sécurité',
        suggestion: 'Utilisez la régénération individuelle des codes'
      });
    } catch (error) {
      console.error('❌ Erreur reset codes:', error.message);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la réinitialisation'
      });
    }
  }

  // =====================================
  // NOTIFICATIONS
  // =====================================

  // 🔔 NOTIFICATIONS UTILISATEUR
  async getNotifications(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, unreadOnly = false } = req.query;
      
      const result = await UserService.getUserNotifications(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        unreadOnly: unreadOnly === 'true'
      });
      
      res.json({
        success: true,
        message: `${result.notifications.length} notification(s) trouvée(s)`,
        data: result
      });
    } catch (error) {
      console.error('❌ Erreur notifications:', error.message);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des notifications'
      });
    }
  }

  // ✅ MARQUER NOTIFICATION COMME LUE
  async markNotificationRead(req, res) {
    try {
      const { notificationId } = req.params;
      
      const notification = await UserService.markNotificationAsRead(notificationId);
      
      res.json({
        success: true,
        message: 'Notification marquée comme lue',
        data: notification
      });
    } catch (error) {
      console.error('❌ Erreur notification lue:', error.message);
      
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
  // Dans UserService.js - Ajouter cette méthode



// Ajoutez cette méthode dans votre UserController.js backend
// Placez-la après la méthode broadcastNotification

// 🤝 RÉCUPÉRER LES PARTENAIRES (Admin + Superviseur)
async getPartners(req, res) {
  try {
    // Vérifier les permissions (Admin ou Superviseur peuvent voir les partenaires)
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERVISEUR') {
      return res.status(403).json({
        success: false,
        message: 'Accès réservé aux administrateurs et superviseurs'
      });
    }

    const { 
      status, 
      search, 
      page = 1, 
      limit = 20,
      showCodes = false 
    } = req.query;
    
    // Seuls les admins peuvent voir les codes
    const isAdmin = req.user.role === 'ADMIN';
    const canShowCodes = isAdmin && showCodes === 'true';

    const result = await UserService.getPartners({
      status,
      search,
      page: parseInt(page),
      limit: parseInt(limit),
      showCodes: canShowCodes
    });

    res.json({
      success: true,
      message: `${result.partners.length} partenaire(s) trouvé(s)`,
      data: {
        ...result,
        codesDisplayed: canShowCodes,
        userRole: req.user.role,
        ...(isAdmin && {
          adminOptions: {
            showCodes: "Ajoutez ?showCodes=true pour voir les codes d'accès",
            filterByStatus: "Utilisez ?status=ACTIVE ou ?status=SUSPENDED",
            search: "Utilisez ?search=nom_ou_telephone pour rechercher"
          }
        })
      }
    });

  } catch (error) {
    console.error('Erreur getPartners:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de la récupération des partenaires'
    });
  }
}
  // 📢 DIFFUSER NOTIFICATION (Admin)
  async broadcastNotification(req, res) {
    try {
      const adminId = req.user.id;
      const { title, message, type, targetRole } = req.body;

      if (!title || !message) {
        return res.status(400).json({
          success: false,
          message: 'Titre et message requis'
        });
      }

      const result = await UserService.broadcastNotification(adminId, {
        title,
        message,
        type: type || 'CREATION_UTILISATEUR',
        targetRole: targetRole || 'PARTENAIRE'
      });

      res.status(201).json({
        success: true,
        message: 'Notification diffusée avec succès',
        data: result
      });
    } catch (error) {
      console.error('❌ Erreur diffusion notification:', error.message);
      
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la diffusion'
      });
    }
  }
}

export default new UserController();