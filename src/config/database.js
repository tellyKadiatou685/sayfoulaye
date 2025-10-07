// src/config/database.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  errorFormat: "pretty",
  log: process.env.NODE_ENV === "development" ? ["query", "info", "warn", "error"] : ["error"]
});

// Test de connexion
async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log("✅ Base de données MySQL connectée avec succès");
    console.log("🔗 Prêt pour les notifications automatiques");
  } catch (error) {
    console.error("❌ Erreur de connexion à la base de données:", error);
    console.log("💡 Vérifiez que MySQL est démarré et que la base 'saf' existe");
    // NE PAS exit, juste logger l'erreur
    // process.exit(1);
  }
}

// Fermeture propre
async function disconnectDatabase() {
  await prisma.$disconnect();
  console.log("🔌 Base de données déconnectée");
}

// RETIRER l'appel automatique ici
// connectDatabase();

export { prisma, connectDatabase, disconnectDatabase };
export default prisma;