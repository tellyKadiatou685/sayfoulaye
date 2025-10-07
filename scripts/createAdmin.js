// scripts/createAdmin.js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createDefaultAdmin() {
  try {
    console.log('🔧 Création de l\'administrateur par défaut SBK...');
    console.log('='.repeat(60));

    // Vérifier si un admin existe déjà
    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'ADMIN' }
    });

    if (existingAdmin) {
      console.log('❌ Un administrateur existe déjà dans la base de données');
      console.log(`📱 Téléphone existant: ${existingAdmin.telephone}`);
      console.log(`👤 Nom: ${existingAdmin.nomComplet}`);
      console.log('💡 Utilisez ces informations pour vous connecter');
      return;
    }

    // Données admin par défaut
    const adminData = {
      telephone: '775261930',
      code: '123456', // Code par défaut
      nomComplet: 'Administrateur SBK',
      adresse: 'Kolda, Sénégal',
      role: 'ADMIN'
    };

    // Hasher le code d'accès
    const hashedCode = await bcrypt.hash(adminData.code, 12);

    // Créer l'administrateur
    const admin = await prisma.user.create({
      data: {
        telephone: adminData.telephone,
        nomComplet: adminData.nomComplet,
        code: hashedCode,
        role: adminData.role,
        status: 'ACTIVE',
        adresse: adminData.adresse
      }
    });

    console.log('✅ Administrateur créé avec succès !');
    console.log('='.repeat(60));
    console.log('🏢 INFORMATIONS DE CONNEXION ADMINISTRATEUR');
    console.log('='.repeat(60));
    console.log(`📱 Téléphone: ${admin.telephone}`);
    console.log(`🔑 Code d'accès: ${adminData.code}`);
    console.log(`👤 Nom: ${admin.nomComplet}`);
    console.log(`🏢 Rôle: ${admin.role}`);
    console.log(`📍 Adresse: ${admin.adresse}`);
    console.log('='.repeat(60));
    console.log('💡 Conservez ces informations pour vous connecter');
    console.log('🚀 Vous pouvez maintenant démarrer le serveur: npm run dev');

  } catch (error) {
    console.error('❌ Erreur lors de la création de l\'administrateur:', error);
    
    if (error.code === 'P2002') {
      console.log('📱 Le numéro de téléphone est déjà utilisé');
    } else {
      console.log('🔧 Vérifiez votre configuration de base de données');
    }
  } finally {
    await prisma.$disconnect();
    console.log('🔌 Connexion base de données fermée');
  }
}

// Exécuter si appelé directement
if (import.meta.url === `file://${process.argv[1]}`) {
  createDefaultAdmin();
}

export default createDefaultAdmin;