// src/routes/accountLines.js
import express from 'express';
import AccountLineController from '../controllers/AccountLineController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// =====================================
// ROUTES POUR GESTION DES LIGNES DE COMPTE
// =====================================

/**
 * @route DELETE /api/account-lines/supervisor/:supervisorId/:lineType
 * @desc Supprimer une ligne de compte (début ou sortie)
 * @access Admin, Superviseur (ses propres comptes seulement)
 * @params supervisorId - ID du superviseur
 * @params lineType - Type de ligne ('debut' ou 'sortie')
 * @body accountKey - Clé du compte ('LIQUIDE', 'ORANGE_MONEY', 'part-nomPartenaire', etc.)
 */
router.delete('/supervisor/:supervisorId/:lineType', 
  authenticateToken, 
  AccountLineController.deleteAccountLine
);

/**
 * @route PUT /api/account-lines/supervisor/:supervisorId/:lineType/reset
 * @desc Réinitialiser une ligne de compte à une valeur spécifique
 * @access Admin seulement
 * @params supervisorId - ID du superviseur
 * @params lineType - Type de ligne ('debut' ou 'sortie')
 * @body accountKey - Clé du compte
 * @body newValue - Nouvelle valeur (optionnel, défaut: 0)
 */
router.put('/supervisor/:supervisorId/:lineType/reset', 
  authenticateToken, 
  AccountLineController.resetAccountLine
);

/**
 * @route GET /api/account-lines/deletion-history
 * @desc Obtenir l'historique des suppressions de lignes
 * @access Admin seulement
 * @query page - Numéro de page (optionnel, défaut: 1)
 * @query limit - Nombre d'éléments par page (optionnel, défaut: 20)
 * @query supervisorId - Filtrer par superviseur (optionnel)
 */
router.get('/deletion-history', 
  authenticateToken, 
  AccountLineController.getAccountDeletionHistory
);

// =====================================
// EXEMPLE D'UTILISATION DES ROUTES
// =====================================

/*
// Supprimer une ligne de début LIQUIDE
DELETE /api/account-lines/supervisor/abc123/debut
Body: { "accountKey": "LIQUIDE" }

// Supprimer une ligne de sortie partenaire
DELETE /api/account-lines/supervisor/abc123/sortie
Body: { "accountKey": "part-Jean Dupont" }

// Réinitialiser une ligne à zéro
PUT /api/account-lines/supervisor/abc123/debut/reset
Body: { "accountKey": "ORANGE_MONEY", "newValue": 0 }

// Réinitialiser une ligne à une valeur spécifique
PUT /api/account-lines/supervisor/abc123/sortie/reset
Body: { "accountKey": "WAVE", "newValue": 5000 }

// Obtenir l'historique des suppressions
GET /api/account-lines/deletion-history?page=1&limit=10

// Filtrer l'historique par superviseur
GET /api/account-lines/deletion-history?supervisorId=abc123
*/

export default router;