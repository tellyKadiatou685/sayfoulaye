// api/cron.js - VERSION SIMPLIFIÉE

import { PrismaClient } from '@prisma/client';
import TransactionService from '../src/services/TransactionService.js';

const prisma = new PrismaClient();

export default async function handler(req, res) {
  console.log("🚀 [VERCEL CRON] Démarrage du CRON automatique");
  
  try {
    // Vérification autorisation
    const authHeader = req.headers.authorization;
    const isVercelCron = req.headers['user-agent']?.includes('vercel') || 
                        req.headers['x-vercel-cron'] === '1';
    
    if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log("❌ [VERCEL CRON] Accès non autorisé");
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized',
        timestamp: new Date().toISOString()
      });
    }

    // ⭐ APPEL DU SERVICE - supprimez la ligne getResetConfig
    const result = await TransactionService.forceReset('vercel-cron');
    
    console.log("✅ [VERCEL CRON] Exécution terminée avec succès");
    
    return res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
      nextExecution: "Quotidien à 00h00 UTC via Vercel CRON"
    });

  } catch (error) {
    console.error("❌ [VERCEL CRON] Erreur fatale:", error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    await prisma.$disconnect();
  }
}