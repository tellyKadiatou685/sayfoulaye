/*
  Warnings:

  - You are about to alter the column `balance` on the `accounts` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - You are about to alter the column `initialBalance` on the `accounts` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - You are about to alter the column `montant` on the `transactions` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.

*/
-- AlterTable
ALTER TABLE "public"."accounts" ALTER COLUMN "balance" SET DATA TYPE INTEGER,
ALTER COLUMN "initialBalance" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "public"."transactions" ALTER COLUMN "montant" SET DATA TYPE INTEGER;

-- CreateIndex
CREATE INDEX "accounts_userId_type_idx" ON "public"."accounts"("userId", "type");

-- CreateIndex
CREATE INDEX "accounts_type_idx" ON "public"."accounts"("type");

-- CreateIndex
CREATE INDEX "accounts_balance_idx" ON "public"."accounts"("balance");

-- CreateIndex
CREATE INDEX "daily_snapshots_date_idx" ON "public"."daily_snapshots"("date");

-- CreateIndex
CREATE INDEX "daily_snapshots_userId_date_idx" ON "public"."daily_snapshots"("userId", "date");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "public"."notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "public"."notifications"("createdAt");

-- CreateIndex
CREATE INDEX "system_config_key_idx" ON "public"."system_config"("key");

-- CreateIndex
CREATE INDEX "transactions_type_createdAt_idx" ON "public"."transactions"("type", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_envoyeurId_createdAt_idx" ON "public"."transactions"("envoyeurId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_destinataireId_createdAt_idx" ON "public"."transactions"("destinataireId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_partenaireId_createdAt_idx" ON "public"."transactions"("partenaireId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "public"."transactions"("createdAt");

-- CreateIndex
CREATE INDEX "transactions_type_destinataireId_createdAt_idx" ON "public"."transactions"("type", "destinataireId", "createdAt");
