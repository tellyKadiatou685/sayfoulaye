// src/services/UserService.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import NotificationService from './NotificationService.js';

class UserService {
  // =====================================
  // UTILITAIRES GÉNÉRATION
  // =====================================

  // Générer un code d'accès à 6 chiffres
  generateAccessCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Hasher le code d'accès
  async hashAccessCode(code) {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    return await bcrypt.hash(code, saltRounds);
  }

  // Vérifier le code d'accès
  async verifyAccessCode(code, hash) {
    return await bcrypt.compare(code, hash);
  }

  // Générer un token JWT
  generateToken(user) {
    return jwt.sign(
      { 
        userId: user.id, 
        telephone: user.telephone,
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  // =====================================
  // AUTHENTIFICATION
  // =====================================

  // 🔐 CONNEXION UTILISATEUR
  async login(telephone, accessCode) {
    try {
      // Chercher l'utilisateur par téléphone
      const user = await prisma.user.findUnique({
        where: { telephone }
      });

      if (!user) {
        throw new Error('Numéro de téléphone ou code d\'accès incorrect');
      }

      if (user.status !== 'ACTIVE') {
        throw new Error('Votre compte n\'est pas encore activé ou a été suspendu');
      }

      // Vérifier le code d'accès
      const isValidCode = await this.verifyAccessCode(accessCode, user.code);
      if (!isValidCode) {
        throw new Error('Numéro de téléphone ou code d\'accès incorrect');
      }

      // Générer le token
      const token = this.generateToken(user);

      // Mettre à jour la dernière connexion
      await prisma.user.update({
        where: { id: user.id },
        data: { 
          updatedAt: new Date() // Dernière activité
        }
      });

      // Enregistrer notification de connexion
      await NotificationService.createNotification({
        userId: user.id,
        title: 'Connexion réussie',
        message: `Bienvenue ${user.nomComplet}`,
        type: 'DEPOT_PARTENAIRE' // Utiliser un type existant du schema
      });

      return {
        user: {
          id: user.id,
          telephone: user.telephone,
          nomComplet: user.nomComplet,
          role: user.role,
          adresse: user.adresse,
          status: user.status
        },
        token
      };
    } catch (error) {
      throw error;
    }
  }

  // =====================================
  // DEMANDES D'INSCRIPTION PARTENAIRES
  // =====================================

  // 📝 DEMANDE D'INSCRIPTION PARTENAIRE
  async requestRegistration(telephone, nomComplet, adresse, message = null) {
    try {
      // Vérifier si le numéro existe déjà dans les utilisateurs
      const existingUser = await prisma.user.findUnique({
        where: { telephone }
      });

      if (existingUser) {
        throw new Error('Ce numéro de téléphone est déjà utilisé par un compte existant');
      }

      // Vérifier si une demande existe déjà
      const existingRequest = await prisma.registrationRequest.findUnique({
        where: { telephone }
      });

      if (existingRequest && existingRequest.status === 'PENDING') {
        throw new Error('Une demande d\'inscription est déjà en cours pour ce numéro');
      }

      // Supprimer l'ancienne demande si elle existe (rejetée/approuvée)
      if (existingRequest) {
        await prisma.registrationRequest.delete({
          where: { telephone }
        });
      }

      // Créer la nouvelle demande
      const request = await prisma.registrationRequest.create({
        data: {
          telephone,
          nomComplet,
          adresse,
          message,
          status: 'PENDING'
        }
      });

      // 🔔 Notifier tous les admins
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' }
      });

      for (const admin of admins) {
        await NotificationService.createNotification({
          userId: admin.id,
          title: 'Nouvelle Demande d\'Inscription',
          message: `${nomComplet} demande à devenir partenaire`,
          type: 'DEMANDE_INSCRIPTION'
        });
      }

      return request;
    } catch (error) {
      throw error;
    }
  }
 
  // 📋 OBTENIR DEMANDES EN ATTENTE
  async getPendingRegistrations(options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const [requests, totalCount] = await Promise.all([
        prisma.registrationRequest.findMany({
          where: { status: 'PENDING' },
          include: {
            reviewedBy: {
              select: { nomComplet: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.registrationRequest.count({
          where: { status: 'PENDING' }
        })
      ]);

      return {
        requests,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error('Erreur lors de la récupération des demandes d\'inscription');
    }
  }

  // ✅ APPROUVER DEMANDE D'INSCRIPTION (Admin)
  async approveRegistration(adminId, requestId) {
    try {
      // Récupérer la demande
      const request = await prisma.registrationRequest.findUnique({
        where: { id: requestId }
      });

      if (!request) {
        throw new Error('Demande d\'inscription introuvable');
      }

      if (request.status !== 'PENDING') {
        throw new Error('Cette demande a déjà été traitée');
      }

      // Vérifier que le numéro n'est pas déjà utilisé
      const existingUser = await prisma.user.findUnique({
        where: { telephone: request.telephone }
      });

      if (existingUser) {
        throw new Error('Ce numéro de téléphone est déjà utilisé');
      }

      // Générer un code d'accès
      const accessCode = this.generateAccessCode();
      const hashedCode = await this.hashAccessCode(accessCode);

      // Transaction pour créer l'utilisateur et mettre à jour la demande
      const result = await prisma.$transaction(async (tx) => {
        // Créer l'utilisateur
        const user = await tx.user.create({
          data: {
            telephone: request.telephone,
            nomComplet: request.nomComplet,
            adresse: request.adresse,
            code: hashedCode,
            codeClair: accessCode, // ✅ Stocker le code en clair pour admin
            role: 'PARTENAIRE',
            status: 'ACTIVE'
          }
        });

        // Marquer la demande comme approuvée
        await tx.registrationRequest.update({
          where: { id: requestId },
          data: { 
            status: 'APPROVED',
            reviewedById: adminId,
            reviewedAt: new Date(),
            codeGenere: accessCode // Code en clair pour l'admin
          }
        });

        return user;
      });

      // 🔔 Notification au nouveau partenaire
      await NotificationService.createNotification({
        userId: result.id,
        title: 'Inscription Approuvée !',
        message: `Bienvenue ${result.nomComplet} ! Votre code d'accès: ${accessCode}`,
        type: 'CREATION_UTILISATEUR'
      });

      return { 
        user: result, 
        codeAcces: accessCode // Code non hashé pour l'affichage
      };
    } catch (error) {
      throw error;
    }
  }

  // ❌ REJETER DEMANDE D'INSCRIPTION (Admin)
  async rejectRegistration(adminId, requestId, reason) {
    try {
      const request = await prisma.registrationRequest.findUnique({
        where: { id: requestId }
      });

      if (!request) {
        throw new Error('Demande d\'inscription introuvable');
      }

      if (request.status !== 'PENDING') {
        throw new Error('Cette demande a déjà été traitée');
      }

      const updated = await prisma.registrationRequest.update({
        where: { id: requestId },
        data: { 
          status: 'REJECTED',
          reviewedById: adminId,
          reviewedAt: new Date()
        }
      });

      return { request: updated, reason };
    } catch (error) {
      throw error;
    }
  }

  // =====================================
  // GESTION UTILISATEURS (Admin)
  // =====================================

  // 👥 CRÉER UTILISATEUR DIRECTEMENT (Admin)
  async createUser(userData) {
    try {
      // Générer le code d'accès (6 chiffres)
      const accessCode = this.generateAccessCode();
      
      // Hasher le code pour la sécurité
      const hashedAccessCode = await this.hashAccessCode(accessCode);
      
      // Créer l'utilisateur
      const user = await prisma.user.create({
        data: {
          ...userData,
          code: hashedAccessCode,
          codeClair: accessCode, // ✅ Stocker le code en clair pour admin
          status: 'ACTIVE'
        }
      });

      // Notification au nouvel utilisateur
      await NotificationService.createNotification({
        userId: user.id,
        title: 'Compte Créé !',
        message: `Votre compte ${user.role.toLowerCase()} a été créé. Code: ${accessCode}`,
        type: 'CREATION_UTILISATEUR'
      });

      return {
        user: {
          id: user.id,
          telephone: user.telephone,
          nomComplet: user.nomComplet,
          adresse: user.adresse,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt
        },
        codeAcces: accessCode, // Code en clair pour la réponse
        notification: `${user.nomComplet} peut se connecter avec le code: ${accessCode}`
      };
    } catch (error) {
      if (error.code === 'P2002') {
        throw new Error('Ce numéro de téléphone est déjà utilisé');
      }
      throw new Error(`Erreur création utilisateur: ${error.message}`);
    }
  }

  // 👥 OBTENIR TOUS LES UTILISATEURS
  async getAllUsers(options = {}) {
    try {
      const { role, status, search, page = 1, limit = 20, showCodes = false } = options;
      const skip = (page - 1) * limit;

      let whereCondition = {};
      
      if (role && role !== 'all') whereCondition.role = role;
      if (status && status !== 'all') whereCondition.status = status;
      
      if (search) {
        whereCondition.OR = [
          { nomComplet: { contains: search, mode: 'insensitive' } },
          { telephone: { contains: search } }
        ];
      }

      // ✅ Sélection conditionnelle des champs
      const selectFields = {
        id: true,
        telephone: true,
        nomComplet: true,
        adresse: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true
      };

      // ✅ Ajouter le code clair si demandé (admin seulement)
      if (showCodes) {
        selectFields.codeClair = true;
      }

      const [users, totalCount] = await Promise.all([
        prisma.user.findMany({
          where: whereCondition,
          select: selectFields,
          orderBy: { nomComplet: 'asc' },
          skip,
          take: limit
        }),
        prisma.user.count({ where: whereCondition })
      ]);
      
      return {
        users,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error(`Erreur récupération utilisateurs: ${error.message}`);
    }
  }

  // ⏸️ SUSPENDRE UTILISATEUR
  async suspendUser(userId, reason = null) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('Utilisateur introuvable');
      }

      if (user.role === 'ADMIN') {
        throw new Error('Impossible de suspendre un administrateur');
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { status: 'SUSPENDED' }
      });

      // 🔔 Notification à l'utilisateur
      await NotificationService.createNotification({
        userId: user.id,
        title: 'Compte Suspendu',
        message: `Votre compte a été temporairement suspendu. ${reason || ''}`,
        type: 'CREATION_UTILISATEUR' // Réutiliser type existant
      });

      return updatedUser;
    } catch (error) {
      throw error;
    }
  }

  // ▶️ RÉACTIVER UTILISATEUR
  async activateUser(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('Utilisateur introuvable');
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE' }
      });

      // 🔔 Notification à l'utilisateur
      await NotificationService.createNotification({
        userId: userId,
        title: 'Compte Réactivé',
        message: 'Votre compte a été réactivé avec succès',
        type: 'CREATION_UTILISATEUR'
      });

      return updatedUser;
    } catch (error) {
      throw new Error('Erreur lors de la réactivation de l\'utilisateur');
    }
  }

 

  // =====================================
  // NOUVELLES MÉTHODES POUR CODES D'ACCÈS
  // =====================================

  // 🔄 RÉGÉNÉRER LE CODE D'ACCÈS D'UN UTILISATEUR
  async regenerateAccessCode(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('Utilisateur introuvable');
      }

      const newAccessCode = this.generateAccessCode();
      const hashedCode = await this.hashAccessCode(newAccessCode);

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { 
          code: hashedCode,
          codeClair: newAccessCode
        }
      });

      // Notification à l'utilisateur
      await NotificationService.createNotification({
        userId: userId,
        title: 'Nouveau Code d\'Accès',
        message: `Votre nouveau code d'accès: ${newAccessCode}`,
        type: 'CREATION_UTILISATEUR'
      });

      return {
        user: updatedUser,
        newCode: newAccessCode
      };
    } catch (error) {
      throw new Error(`Erreur régénération code: ${error.message}`);
    }
  }

  // 🔍 OBTENIR LE CODE D'UN UTILISATEUR (Admin seulement)
  async getUserAccessCode(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          nomComplet: true,
          telephone: true,
          codeClair: true,
          role: true,
          status: true
        }
      });

      if (!user) {
        throw new Error('Utilisateur introuvable');
      }

      return {
        user: {
          id: user.id,
          nomComplet: user.nomComplet,
          telephone: user.telephone,
          role: user.role,
          status: user.status
        },
        codeAcces: user.codeClair
      };
    } catch (error) {
      throw new Error(`Erreur récupération code: ${error.message}`);
    }
  }

  // 🔍 RECHERCHER UTILISATEUR PAR CODE
  async findUserByAccessCode(accessCode) {
    try {
      const user = await prisma.user.findFirst({
        where: { codeClair: accessCode },
        select: {
          id: true,
          telephone: true,
          nomComplet: true,
          adresse: true,
          role: true,
          status: true,
          codeClair: true,
          createdAt: true
        }
      });

      if (!user) {
        throw new Error('Aucun utilisateur trouvé avec ce code');
      }

      return { user };
    } catch (error) {
      throw new Error(`Erreur recherche par code: ${error.message}`);
    }
  }

  // 📊 STATISTIQUES DES CODES D'ACCÈS
  async getAccessCodesStats() {
    try {
      const allUsers = await prisma.user.findMany({
        select: {
          role: true,
          status: true,
          codeClair: true
        }
      });

      const stats = {
        totalUsers: allUsers.length,
        usersWithCodes: allUsers.filter(u => u.codeClair).length,
        usersWithoutCodes: allUsers.filter(u => !u.codeClair).length,
        byRole: {
          ADMIN: allUsers.filter(u => u.role === 'ADMIN').length,
          SUPERVISEUR: allUsers.filter(u => u.role === 'SUPERVISEUR').length,
          PARTENAIRE: allUsers.filter(u => u.role === 'PARTENAIRE').length
        },
        byStatus: {
          ACTIVE: allUsers.filter(u => u.status === 'ACTIVE').length,
          SUSPENDED: allUsers.filter(u => u.status === 'SUSPENDED').length,
          PENDING: allUsers.filter(u => u.status === 'PENDING').length,
          REJECTED: allUsers.filter(u => u.status === 'REJECTED').length
        },
        codesWithStatus: {
          ACTIVE: allUsers.filter(u => u.status === 'ACTIVE' && u.codeClair).length,
          SUSPENDED: allUsers.filter(u => u.status === 'SUSPENDED' && u.codeClair).length,
          PENDING: allUsers.filter(u => u.status === 'PENDING' && u.codeClair).length
        }
      };

      return stats;
    } catch (error) {
      throw new Error(`Erreur calcul statistiques: ${error.message}`);
    }
  }

  // =====================================
  // NOTIFICATIONS
  // =====================================
// Ajoutez cette méthode dans votre UserService.js backend
// Placez-la après la méthode broadcastNotification

// 🤝 OBTENIR LES PARTENAIRES
async getPartners(options = {}) {
  try {
    const {
      status = null,
      search = null,
      page = 1,
      limit = 20,
      showCodes = false
    } = options;

    // Construire les conditions de filtrage
    const where = {
      role: 'PARTENAIRE'
    };

    // Filtrer par statut si spécifié
    if (status && ['ACTIVE', 'SUSPENDED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }

    // Recherche par nom ou téléphone
    if (search && search.trim()) {
      where.OR = [
        { nomComplet: { contains: search.trim(), mode: 'insensitive' } },
        { telephone: { contains: search.trim() } }
      ];
    }

    // Calculer l'offset pour la pagination
    const offset = (page - 1) * limit;

    // Sélection des champs
    const selectFields = {
      id: true,
      telephone: true,
      nomComplet: true,
      adresse: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true
    };

    // Inclure le code d'accès seulement si demandé
    if (showCodes) {
      selectFields.codeClair = true;
    }

    // Récupérer les partenaires avec pagination
    const [partners, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        select: selectFields,
        orderBy: [
          { status: 'asc' }, // ACTIVE en premier
          { nomComplet: 'asc' }
        ],
        skip: offset,
        take: limit
      }),
      prisma.user.count({ where })
    ]);

    // Calculer les métadonnées de pagination
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      partners,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPrevPage
      },
      summary: {
        totalPartners: totalCount,
        activePartners: partners.filter(p => p.status === 'ACTIVE').length,
        suspendedPartners: partners.filter(p => p.status === 'SUSPENDED').length
      }
    };

  } catch (error) {
    console.error('Erreur getPartners:', error);
    throw new Error('Erreur lors de la récupération des partenaires');
  }
}
  // 🔔 OBTENIR NOTIFICATIONS UTILISATEUR
  async getUserNotifications(userId, options = {}) {
    try {
      const { page = 1, limit = 20, unreadOnly = false } = options;
      const skip = (page - 1) * limit;

      let whereCondition = { userId };
      if (unreadOnly) {
        whereCondition.isRead = false;
      }

      const [notifications, totalCount] = await Promise.all([
        prisma.notification.findMany({
          where: whereCondition,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.notification.count({ where: whereCondition })
      ]);

      return {
        notifications,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error('Erreur lors de la récupération des notifications');
    }
  }

  // ✅ MARQUER NOTIFICATION COMME LUE
  async markNotificationAsRead(notificationId) {
    try {
      const notification = await prisma.notification.findUnique({
        where: { id: notificationId }
      });

      if (!notification) {
        throw new Error('Notification introuvable');
      }

      return await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true }
      });
    } catch (error) {
      throw new Error('Erreur lors de la mise à jour de la notification');
    }
  }

  // Ajoutez cette méthode dans votre UserService.js
// Placez-la dans la section "GESTION UTILISATEURS (Admin)" après la méthode activateUser

// Dans UserService.js, remplacez la méthode deleteUser par :
// Dans UserService.js, remplacez la méthode deleteUser par :

// Dans UserService.js, remplacez complètement la méthode deleteUser par cette version simplifiée :

async deleteUser(adminId, userId, reason = null) {
  try {
    console.log('🗑️ [SERVICE] Début suppression:', { adminId, userId, reason });

    // Vérifier que l'utilisateur à supprimer existe
    const userToDelete = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: true,
        transactionsEnvoyees: { take: 1 },
        transactionsRecues: { take: 1 },
        transactionsPartenaire: { take: 1 }
      }
    });

    if (!userToDelete) {
      throw new Error('Utilisateur introuvable');
    }

    console.log('✅ [SERVICE] Utilisateur trouvé:', userToDelete.nomComplet);

    // Vérifier que ce n'est pas un admin
    if (userToDelete.role === 'ADMIN') {
      throw new Error('Impossible de supprimer un administrateur');
    }

    // Vérifier que l'admin ne se supprime pas lui-même
    if (userId === adminId) {
      throw new Error('Vous ne pouvez pas supprimer votre propre compte');
    }

    // Vérifier s'il y a des comptes avec solde
    const hasBalance = userToDelete.accounts.some(account => 
      account.balance > 0 || account.initialBalance > 0
    );

    if (hasBalance) {
      throw new Error('Impossible de supprimer un utilisateur avec des soldes non nuls');
    }

    console.log('🚀 [SERVICE] Début transaction de suppression');

    // Transaction simplifiée pour supprimer l'utilisateur
    const result = await prisma.$transaction(async (tx) => {
      // Supprimer les comptes
      await tx.account.deleteMany({
        where: { userId: userId }
      });

      // Supprimer les notifications
      await tx.notification.deleteMany({
        where: { userId: userId }
      });

      // Supprimer l'utilisateur
      const deletedUser = await tx.user.delete({
        where: { id: userId }
      });

      return { deletedUser };
    });

    console.log('✅ [SERVICE] Suppression réussie');

    return {
      message: `Utilisateur ${userToDelete.nomComplet} supprimé avec succès`,
      deletedUser: {
        id: result.deletedUser.id,
        nomComplet: result.deletedUser.nomComplet,
        telephone: result.deletedUser.telephone,
        role: result.deletedUser.role
      }
    };

  } catch (error) {
    console.error('❌ [SERVICE] Erreur deleteUser:', error.message);
    throw error;
  }
}

  // 📢 DIFFUSER NOTIFICATION (Admin)
  async broadcastNotification(adminId, notificationData) {
    try {
      const { title, message, type, targetRole } = notificationData;

      // Obtenir tous les utilisateurs cibles
      const targetUsers = await prisma.user.findMany({
        where: { 
          role: targetRole,
          status: 'ACTIVE'
        },
        select: { id: true, nomComplet: true }
      });

      if (targetUsers.length === 0) {
        throw new Error(`Aucun utilisateur actif trouvé avec le rôle ${targetRole}`);
      }

      // Créer notifications pour tous
      const notifications = await Promise.all(
        targetUsers.map(user =>
          prisma.notification.create({
            data: {
              userId: user.id,
              type,
              title,
              message: `${message}\n\nMessage de l'administration`
            }
          })
        )
      );

      return {
        sent: notifications.length,
        targetRole,
        recipients: targetUsers.map(user => user.nomComplet)
      };
    } catch (error) {
      throw new Error(`Erreur lors de la diffusion: ${error.message}`);
    }
  }
}

export default new UserService();