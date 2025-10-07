// app.js
import express from 'express';
import cors from 'cors';

// Import des routes
import UserRoute from './routes/UserRoute.js';
import TransactionRoute from './routes/transactionRoutes.js';
import RecentTransactionRoutes from './routes/recentTransactionRoutes.js';
import AccountLines from './routes/accountLines.js';

// Créer l'application Express
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'API SBK fonctionne !',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// Route de test santé
app.get('/api/health', async (req, res) => {
  try {
    const { testConnection } = await import('./config/database.js');
    const dbStatus = await testConnection();
    
    res.json({
      status: 'healthy',
      database: dbStatus ? 'connected' : 'disconnected',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Monter les routes
app.use('/api/users', UserRoute);
app.use('/api/transactions', TransactionRoute);
app.use('/api/recent', RecentTransactionRoutes);
app.use('/api', AccountLines);


// Gestion des erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'Route non trouvée'
  });
});

export default app;