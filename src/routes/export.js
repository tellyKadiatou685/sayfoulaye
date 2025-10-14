// src/routes/export.js

import express from 'express';
import ExportController from '../controllers/ExportController.js';
import {
  authenticateToken,
  requireAdmin,
  requireSupervisorOrAdmin
} from '../middleware/auth.js';

const router = express.Router();

// =====================================
// ROUTES D'EXPORT EXCEL
// =====================================

// Export complet (ADMIN uniquement)
// GET /api/export/excel/full/today
// GET /api/export/excel/full/custom?customDate=2024-12-01
router.get(
  '/excel/full/:period',
  authenticateToken,
  requireAdmin,
  ExportController.exportFullExcel.bind(ExportController)
);

// Export simple (SUPERVISEUR et ADMIN)
// GET /api/export/excel/simple/today
// GET /api/export/excel/simple/yesterday
router.get(
  '/excel/simple/:period',
  authenticateToken,
  requireSupervisorOrAdmin,
  ExportController.exportSimpleExcel.bind(ExportController)
);

// Info sur les exports disponibles
// GET /api/export/excel/info
router.get(
  '/excel/info',
  authenticateToken,
  ExportController.getExportInfo.bind(ExportController)
);

// Export par période avec validation (POST)
// POST /api/export/excel/by-period
// Body: { period: 'today', format: 'simple', customDate?: '2024-12-01' }
router.post(
  '/excel/by-period',
  authenticateToken,
  requireAdmin,
  ExportController.exportByPeriod.bind(ExportController)
);

// Vérifier la disponibilité d'un export
// GET /api/export/excel/check-availability?period=today
router.get(
  '/excel/check-availability',
  authenticateToken,
  ExportController.checkExportAvailability.bind(ExportController)
);

// =====================================
// ROUTES SUPPLÉMENTAIRES
// =====================================

// Lister tous les formats disponibles
// GET /api/export/formats
router.get(
  '/formats',
  authenticateToken,
  (req, res) => {
    res.json({
      success: true,
      formats: [
        {
          name: 'full',
          label: 'Export complet',
          description: 'Tous les détails avec 4 feuilles Excel',
          requiresRole: 'ADMIN',
          endpoint: '/api/export/excel/full/:period'
        },
        {
          name: 'simple',
          label: 'Export simple',
          description: 'Vue condensée et simplifiée',
          requiresRole: 'SUPERVISEUR ou ADMIN',
          endpoint: '/api/export/excel/simple/:period'
        }
      ]
    });
  }
);

// Lister toutes les périodes disponibles
// GET /api/export/periods
router.get(
  '/periods',
  authenticateToken,
  (req, res) => {
    res.json({
      success: true,
      periods: [
        {
          value: 'today',
          label: "Aujourd'hui",
          description: 'Données du jour actuel'
        },
        {
          value: 'yesterday',
          label: 'Hier',
          description: 'Données du jour précédent'
        },
        {
          value: 'week',
          label: 'Cette semaine',
          description: 'Derniers 7 jours'
        },
        {
          value: 'month',
          label: 'Ce mois',
          description: 'Depuis le début du mois'
        },
        {
          value: 'year',
          label: 'Cette année',
          description: 'Depuis le début de l\'année'
        },
        {
          value: 'all',
          label: 'Tout',
          description: 'Toutes les données disponibles'
        },
        {
          value: 'custom',
          label: 'Personnalisé',
          description: 'Date spécifique',
          requiresDate: true,
          dateFormat: 'YYYY-MM-DD',
          example: '2024-12-01'
        }
      ]
    });
  }
);

export default router;