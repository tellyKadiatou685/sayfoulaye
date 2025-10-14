// src/controllers/ExportController.js - CONTRÔLEUR SIMPLIFIÉ
import fs from 'fs';
import ExportService from '../services/ExportService.js';

class ExportController {
  
  // =====================================
  // EXPORT COMPLET (ADMIN)
  // =====================================
  static async exportFullExcel(req, res) {
    try {
      const { period } = req.params;
      const { customDate } = req.query;
      const userId = req.user?.id;

      console.log(`📥 [CONTROLLER] Export complet - User: ${userId}, Période: ${period}, Date: ${customDate || 'N/A'}`);

      // Validation période
      const validPeriods = ['today', 'yesterday', 'week', 'month', 'year', 'all', 'custom'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          error: 'Période invalide',
          validPeriods,
          received: period
        });
      }

      // Validation date custom
      if (period === 'custom' && !customDate) {
        return res.status(400).json({
          success: false,
          error: 'Date requise pour une période custom',
          format: 'YYYY-MM-DD'
        });
      }

      // Validation format date
      if (period === 'custom' && customDate) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(customDate)) {
          return res.status(400).json({
            success: false,
            error: 'Format de date invalide',
            format: 'YYYY-MM-DD',
            received: customDate
          });
        }
      }

      // Appel du service
      console.log('🔄 Appel du service d\'export...');
      const result = await ExportService.exportDailyDataToExcel(period, customDate);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'Erreur lors de la génération du fichier',
          details: result.error
        });
      }

      // Vérification existence fichier
      if (!fs.existsSync(result.filePath)) {
        return res.status(500).json({
          success: false,
          error: 'Fichier non trouvé après génération'
        });
      }

      console.log(`✅ Fichier prêt: ${result.fileName}`);

      // Envoi du fichier
      res.download(result.filePath, result.fileName, (err) => {
        if (err) {
          console.error('❌ Erreur envoi fichier:', err);
        } else {
          console.log(`📤 Fichier envoyé: ${result.fileName}`);
        }

        // Nettoyage
        setTimeout(() => {
          try {
            fs.unlinkSync(result.filePath);
            console.log(`🗑️ Fichier temporaire supprimé: ${result.fileName}`);
          } catch (unlinkErr) {
            console.error('⚠️ Erreur suppression fichier:', unlinkErr);
          }
        }, 1000);
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur export complet:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'export',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // =====================================
  // EXPORT SIMPLE (SUPERVISEUR/ADMIN)
  // =====================================
  static async exportSimpleExcel(req, res) {
    try {
      const { period } = req.params;
      const { customDate } = req.query;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      console.log(`📥 [CONTROLLER] Export simple - User: ${userId} (${userRole}), Période: ${period}`);

      // Validation période
      const validPeriods = ['today', 'yesterday', 'week', 'month', 'year', 'all', 'custom'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          error: 'Période invalide',
          validPeriods
        });
      }

      // Validation date custom
      if (period === 'custom' && !customDate) {
        return res.status(400).json({
          success: false,
          error: 'Date requise pour une période custom'
        });
      }

      // Appel du service
      console.log('🔄 Appel du service d\'export simple...');
      const result = await ExportService.exportSimpleDailyData(period, customDate);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'Erreur lors de la génération du fichier',
          details: result.error
        });
      }

      // Vérification existence fichier
      if (!fs.existsSync(result.filePath)) {
        return res.status(500).json({
          success: false,
          error: 'Fichier non trouvé après génération'
        });
      }

      console.log(`✅ Fichier simple prêt: ${result.fileName}`);

      // Envoi du fichier
      res.download(result.filePath, result.fileName, (err) => {
        if (err) {
          console.error('❌ Erreur envoi fichier:', err);
        } else {
          console.log(`📤 Fichier simple envoyé: ${result.fileName}`);
        }

        // Nettoyage
        setTimeout(() => {
          try {
            fs.unlinkSync(result.filePath);
            console.log(`🗑️ Fichier temporaire supprimé: ${result.fileName}`);
          } catch (unlinkErr) {
            console.error('⚠️ Erreur suppression fichier:', unlinkErr);
          }
        }, 1000);
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur export simple:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'export',
        message: error.message
      });
    }
  }

  // =====================================
  // INFO SUR LES EXPORTS
  // =====================================
  static async getExportInfo(req, res) {
    try {
      const userRole = req.user?.role;

      console.log(`📋 [CONTROLLER] Info demandée par: ${userRole}`);

      const info = {
        success: true,
        exportAvailable: true,
        formats: ['xlsx', 'simple'],
        availablePeriods: ['today', 'yesterday', 'week', 'month', 'year', 'all', 'custom'],
        userRole,
        endpoints: {
          full: {
            url: '/api/export/excel/full/:period',
            method: 'GET',
            description: 'Export complet avec 3 feuilles Excel',
            requiresRole: 'ADMIN',
            queryParams: {
              customDate: 'YYYY-MM-DD (optionnel pour custom)'
            },
            examples: [
              '/api/export/excel/full/today',
              '/api/export/excel/full/custom?customDate=2024-12-01',
              '/api/export/excel/full/week'
            ]
          },
          simple: {
            url: '/api/export/excel/simple/:period',
            method: 'GET',
            description: 'Export simplifié sur 1 feuille',
            requiresRole: 'SUPERVISEUR ou ADMIN',
            queryParams: {
              customDate: 'YYYY-MM-DD (optionnel pour custom)'
            },
            examples: [
              '/api/export/excel/simple/today',
              '/api/export/excel/simple/yesterday',
              '/api/export/excel/simple/custom?customDate=2024-12-01'
            ]
          },
          info: {
            url: '/api/export/excel/info',
            method: 'GET',
            description: 'Informations sur les exports disponibles'
          }
        },
        fileFormats: {
          full: [
            'Feuille 1: Résumé global avec UV Master',
            'Feuille 2: Détail par superviseur',
            'Feuille 3: Synthèse par type de compte'
          ],
          simple: [
            'Vue condensée sur une seule feuille',
            'Idéale pour impression rapide'
          ]
        }
      };

      res.json(info);

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur info:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des infos',
        message: error.message
      });
    }
  }

  // =====================================
  // EXPORT PAR PÉRIODE (POST)
  // =====================================
  static async exportByPeriod(req, res) {
    try {
      const { period, format, customDate } = req.body;
      const userId = req.user?.id;

      console.log(`📥 [CONTROLLER] Export POST - Période: ${period}, Format: ${format}`);

      // Validations
      const validPeriods = ['today', 'yesterday', 'week', 'month', 'year', 'all', 'custom'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          error: 'Période invalide',
          validPeriods
        });
      }

      const validFormats = ['xlsx', 'simple'];
      if (!validFormats.includes(format)) {
        return res.status(400).json({
          success: false,
          error: 'Format invalide',
          validFormats
        });
      }

      // Rediriger vers la bonne méthode
      req.params.period = period;
      req.query.customDate = customDate;

      if (format === 'simple') {
        return await this.exportSimpleExcel(req, res);
      } else {
        return await this.exportFullExcel(req, res);
      }

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur export POST:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'export',
        message: error.message
      });
    }
  }

  // =====================================
  // VÉRIFIER DISPONIBILITÉ
  // =====================================
  static async checkExportAvailability(req, res) {
    try {
      const { period, customDate } = req.query;

      console.log(`🔍 [CONTROLLER] Vérification - Période: ${period}`);

      if (!period) {
        return res.status(400).json({
          success: false,
          error: 'Période requise'
        });
      }

      const result = await ExportService.checkExportAvailability(period, customDate);

      res.json(result);

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur vérification:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la vérification',
        message: error.message
      });
    }
  }
}

export default ExportController;