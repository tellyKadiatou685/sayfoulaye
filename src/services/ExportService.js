// src/services/ExportService.js - SERVICE BACKEND AVEC DESIGN EXCEL PROFESSIONNEL
import TransactionService from './TransactionService.js';
import ExcelJS from 'exceljs';

class ExportService {
  
  // =====================================
  // CONFIGURATION DES STYLES
  // =====================================
  
  getStyles() {
    return {
      // En-tête superviseur (fond vert)
      supervisorHeader: {
        font: { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF000000' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'medium', color: { argb: 'FF000000' } },
          left: { style: 'medium', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          right: { style: 'medium', color: { argb: 'FF000000' } }
        }
      },
      
      // En-têtes de colonnes (DEBUT, ENTRE+, FIN, SORTIE-)
      columnHeader: {
        font: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF000000' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'medium', color: { argb: 'FF000000' } },
          left: { style: 'medium', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          right: { style: 'medium', color: { argb: 'FF000000' } }
        }
      },
      
      // Cellules labels (DEBUT LIQUIDE, FIN OM, etc.)
      labelCell: {
        font: { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } },
        alignment: { horizontal: 'left', vertical: 'middle' },
        border: {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'medium', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        }
      },
      
      // Cellules numériques bleues (ENTRE+)
      numberCellBlue: {
        font: { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0070C0' } },
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: '#,##0 "F CFA"',
        border: {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        }
      },
      
      // Cellules numériques normales (SORTIE-)
      numberCell: {
        font: { name: 'Calibri', size: 11, color: { argb: 'FF000000' } },
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: '#,##0 "F CFA"',
        border: {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'medium', color: { argb: 'FF000000' } }
        }
      },
      
      // Ligne TOTAL (fond bleu clair)
      totalLabel: {
        font: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF000000' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'medium', color: { argb: 'FF000000' } },
          left: { style: 'medium', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        }
      },
      
      // Valeurs TOTAL (rouge sur fond bleu)
      totalNumber: {
        font: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFF0000' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } },
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: '#,##0 "F CFA"',
        border: {
          top: { style: 'medium', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'medium', color: { argb: 'FF000000' } }
        }
      },
      
      // Label GR TOTAL (centré)
      grTotalLabel: {
        font: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF000000' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        }
      },
      
      // Valeur GR TOTAL (rouge)
      grTotalNumber: {
        font: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFF0000' } },
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: '#,##0 "F CFA"',
        border: {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          right: { style: 'medium', color: { argb: 'FF000000' } }
        }
      },
      
      // Cellule vide avec bordures
      emptyCell: {
        border: {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'medium', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        }
      }
    };
  }

  // =====================================
  // HELPERS
  // =====================================
  
  getPeriodLabel(period, customDate) {
    if (period === 'custom' && customDate) {
      return new Date(customDate).toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      });
    }
    
    const labels = {
      'today': "Aujourd'hui",
      'yesterday': 'Hier',
      'week': 'Cette semaine',
      'month': 'Ce mois',
      'year': 'Cette année',
      'all': 'Toutes les données'
    };
    
    return labels[period] || period;
  }
  
  getAccountTypeLabel(type) {
    const labels = {
      'LIQUIDE': 'DEBUT LIQUIDE',
      'ORANGE_MONEY': 'DEBUT OM',
      'WAVE': 'WAV +',
      'UV_MASTER': 'UV MASTER',
      'AUTRES': 'Autres'
    };
    
    return labels[type] || type;
  }

  getAccountTypeLabelFin(type) {
    const labels = {
      'LIQUIDE': 'FIN LIQUIDE',
      'ORANGE_MONEY': 'FIN OM',
      'WAVE': 'WAV +',
      'UV_MASTER': 'UV MASTER',
      'AUTRES': 'Autres'
    };
    
    return labels[type] || type;
  }

  // =====================================
  // EXPORT SIMPLE STYLISÉ
  // =====================================
  async exportSimpleDailyData(period = 'today', customDate = null) {
    try {
      console.log(`📄 [EXPORT SERVICE] Génération fichier simple stylisé - Période: ${period}`);
      
      const dashboardData = await TransactionService.getAdminDashboard(period, customDate);
      
      if (!dashboardData || !dashboardData.supervisorCards || dashboardData.supervisorCards.length === 0) {
        throw new Error('Aucune donnée disponible pour cette période');
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Rapport Quotidien');
      
      const styles = this.getStyles();
      let currentRow = 1;

      // Traiter chaque superviseur
      dashboardData.supervisorCards.forEach((supervisor, index) => {
        // Espace entre superviseurs (sauf le premier)
        if (index > 0) {
          currentRow += 1;
        }

        // 1. LIGNE EN-TÊTE SUPERVISEUR (fusionnée sur 4 colonnes, fond vert)
        worksheet.mergeCells(currentRow, 1, currentRow, 4);
        const headerRow = worksheet.getRow(currentRow);
        headerRow.getCell(1).value = supervisor.nom.toUpperCase();
        headerRow.getCell(1).style = styles.supervisorHeader;
        headerRow.height = 28;
        currentRow++;

        // 2. LIGNE EN-TÊTES COLONNES
        const colHeaderRow = worksheet.getRow(currentRow);
        colHeaderRow.getCell(1).value = 'DEBUT';
        colHeaderRow.getCell(2).value = 'ENTRE +';
        colHeaderRow.getCell(3).value = 'FIN';
        colHeaderRow.getCell(4).value = 'SORTIE -';
        
        [1, 2, 3, 4].forEach(col => {
          colHeaderRow.getCell(col).style = styles.columnHeader;
        });
        colHeaderRow.height = 22;
        currentRow++;

        // 3. LIGNES DE DONNÉES PAR TYPE DE COMPTE
        const accountTypes = Object.keys(supervisor.comptes.debut);
        
        accountTypes.forEach(accountType => {
          const debut = supervisor.comptes.debut[accountType] || 0;
          const sortie = supervisor.comptes.sortie[accountType] || 0;
          
          const dataRow = worksheet.getRow(currentRow);
          
          // Colonne A: DEBUT label
          dataRow.getCell(1).value = this.getAccountTypeLabel(accountType);
          dataRow.getCell(1).style = styles.labelCell;
          
          // Colonne B: ENTRE + (bleu)
          dataRow.getCell(2).value = debut;
          dataRow.getCell(2).style = styles.numberCellBlue;
          
          // Colonne C: FIN label
          dataRow.getCell(3).value = this.getAccountTypeLabelFin(accountType);
          dataRow.getCell(3).style = styles.labelCell;
          
          // Colonne D: SORTIE -
          dataRow.getCell(4).value = sortie;
          dataRow.getCell(4).style = styles.numberCell;
          
          dataRow.height = 20;
          currentRow++;
        });

        // 4. LIGNE TOTAL (fond bleu clair, valeurs rouges)
        const totalRow = worksheet.getRow(currentRow);
        
        totalRow.getCell(1).value = 'TOTAL';
        totalRow.getCell(1).style = styles.totalLabel;
        
        totalRow.getCell(2).value = supervisor.totaux.debutTotal;
        totalRow.getCell(2).style = styles.totalNumber;
        
        totalRow.getCell(3).value = 'TOTAL';
        totalRow.getCell(3).style = styles.totalLabel;
        
        totalRow.getCell(4).value = supervisor.totaux.sortieTotal;
        totalRow.getCell(4).style = styles.totalNumber;
        
        totalRow.height = 24;
        currentRow++;

        // 5. LIGNE GR TOTAL (centré sur colonnes B+C, valeur rouge en D)
        const grRow = worksheet.getRow(currentRow);
        
        // Colonne A vide avec bordure
        grRow.getCell(1).style = styles.emptyCell;
        
        // Colonnes B et C fusionnées pour "GR TOTAL"
        worksheet.mergeCells(currentRow, 2, currentRow, 3);
        grRow.getCell(2).value = 'GR TOTAL';
        grRow.getCell(2).style = styles.grTotalLabel;
        
        // Colonne D: montant GR en rouge
        grRow.getCell(4).value = supervisor.totaux.grTotal;
        grRow.getCell(4).style = styles.grTotalNumber;
        
        grRow.height = 24;
        currentRow++;
      });

      // Largeurs des colonnes
      worksheet.getColumn(1).width = 20;
      worksheet.getColumn(2).width = 25;
      worksheet.getColumn(3).width = 20;
      worksheet.getColumn(4).width = 25;

      // Générer le fichier
      const fileName = `Rapport_Simple_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filePath = `/tmp/${fileName}`;
      
      await workbook.xlsx.writeFile(filePath);
      
      console.log(`✅ [EXPORT SERVICE] Fichier simple stylisé généré: ${filePath}`);
      
      return {
        success: true,
        fileName,
        filePath,
        period
      };
      
    } catch (error) {
      console.error('❌ [EXPORT SERVICE] Erreur export simple:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // =====================================
  // EXPORT COMPLET STYLISÉ
  // =====================================
  async exportDailyDataToExcel(period = 'today', customDate = null) {
    try {
      console.log(`📊 [EXPORT SERVICE] Génération fichier complet stylisé - Période: ${period}`);
      
      const dashboardData = await TransactionService.getAdminDashboard(period, customDate);
      
      if (!dashboardData || !dashboardData.supervisorCards || dashboardData.supervisorCards.length === 0) {
        throw new Error('Aucune donnée disponible pour cette période');
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Rapport Détaillé');
      
      const styles = this.getStyles();
      let currentRow = 1;

      // Traiter chaque superviseur (même structure que simple)
      dashboardData.supervisorCards.forEach((supervisor, index) => {
        if (index > 0) {
          currentRow += 1;
        }

        // En-tête superviseur
        worksheet.mergeCells(currentRow, 1, currentRow, 4);
        const headerRow = worksheet.getRow(currentRow);
        headerRow.getCell(1).value = supervisor.nom.toUpperCase();
        headerRow.getCell(1).style = styles.supervisorHeader;
        headerRow.height = 28;
        currentRow++;

        // En-têtes colonnes
        const colHeaderRow = worksheet.getRow(currentRow);
        colHeaderRow.getCell(1).value = 'DEBUT';
        colHeaderRow.getCell(2).value = 'ENTRE +';
        colHeaderRow.getCell(3).value = 'FIN';
        colHeaderRow.getCell(4).value = 'SORTIE -';
        
        [1, 2, 3, 4].forEach(col => {
          colHeaderRow.getCell(col).style = styles.columnHeader;
        });
        colHeaderRow.height = 22;
        currentRow++;

        // Données
        const accountTypes = Object.keys(supervisor.comptes.debut);
        
        accountTypes.forEach(accountType => {
          const debut = supervisor.comptes.debut[accountType] || 0;
          const sortie = supervisor.comptes.sortie[accountType] || 0;
          
          const dataRow = worksheet.getRow(currentRow);
          
          dataRow.getCell(1).value = this.getAccountTypeLabel(accountType);
          dataRow.getCell(1).style = styles.labelCell;
          
          dataRow.getCell(2).value = debut;
          dataRow.getCell(2).style = styles.numberCellBlue;
          
          dataRow.getCell(3).value = this.getAccountTypeLabelFin(accountType);
          dataRow.getCell(3).style = styles.labelCell;
          
          dataRow.getCell(4).value = sortie;
          dataRow.getCell(4).style = styles.numberCell;
          
          dataRow.height = 20;
          currentRow++;
        });

        // Ligne TOTAL
        const totalRow = worksheet.getRow(currentRow);
        totalRow.getCell(1).value = 'TOTAL';
        totalRow.getCell(1).style = styles.totalLabel;
        totalRow.getCell(2).value = supervisor.totaux.debutTotal;
        totalRow.getCell(2).style = styles.totalNumber;
        totalRow.getCell(3).value = 'TOTAL';
        totalRow.getCell(3).style = styles.totalLabel;
        totalRow.getCell(4).value = supervisor.totaux.sortieTotal;
        totalRow.getCell(4).style = styles.totalNumber;
        totalRow.height = 24;
        currentRow++;

        // Ligne GR TOTAL
        const grRow = worksheet.getRow(currentRow);
        grRow.getCell(1).style = styles.emptyCell;
        worksheet.mergeCells(currentRow, 2, currentRow, 3);
        grRow.getCell(2).value = 'GR TOTAL';
        grRow.getCell(2).style = styles.grTotalLabel;
        grRow.getCell(4).value = supervisor.totaux.grTotal;
        grRow.getCell(4).style = styles.grTotalNumber;
        grRow.height = 24;
        currentRow++;
      });

      worksheet.getColumn(1).width = 20;
      worksheet.getColumn(2).width = 25;
      worksheet.getColumn(3).width = 20;
      worksheet.getColumn(4).width = 25;

      const fileName = `Rapport_Complet_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filePath = `/tmp/${fileName}`;
      
      await workbook.xlsx.writeFile(filePath);
      
      console.log(`✅ [EXPORT SERVICE] Fichier complet stylisé généré: ${filePath}`);
      
      return {
        success: true,
        fileName,
        filePath,
        period,
        sheets: ['Rapport Détaillé']
      };
      
    } catch (error) {
      console.error('❌ [EXPORT SERVICE] Erreur export complet:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // =====================================
  // VÉRIFIER DISPONIBILITÉ
  // =====================================
  async checkExportAvailability(period, customDate = null) {
    try {
      console.log(`🔍 [EXPORT SERVICE] Vérification disponibilité - Période: ${period}`);
      
      const dashboardData = await TransactionService.getAdminDashboard(period, customDate);
      
      return {
        success: true,
        period,
        available: true,
        supervisorCount: dashboardData?.supervisorCards?.length || 0,
        hasData: dashboardData?.supervisorCards?.length > 0,
        totalAmount: dashboardData?.globalTotals?.sortieTotalGlobal || 0,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ [EXPORT SERVICE] Erreur vérification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default new ExportService();