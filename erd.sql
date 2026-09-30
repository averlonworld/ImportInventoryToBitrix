-- ==============================================================================
-- Bitrix24 Inventory & Catalog Middleware - Database Schema & ERD (PostgreSQL)
-- ==============================================================================
-- Description: Complete DDL script for database creation, tables, constraints,
--              foreign keys, indexes, and default administrator seed record.
-- Database Target: PostgreSQL 14+ / 15+
--
-- Entity Relationships (ERD):
--   [User] 1 --------< 0..* [BitrixConfiguration] (Per-user Bitrix24 portal credentials)
--   [User] 1 --------< 0..* [ImportJob]           (Per-user Excel import jobs)
--   [User] 1 --------< 0..* [ColumnMapping]       (Per-user saved column mappings)
--   [ImportJob] 1 ---< 0..* [ImportRecord]        (Row-level records & error audits)
--   [DebugLog]                                    (System-wide event & diagnostic logs)
-- ==============================================================================

-- Enable UUID extension for generating UUID primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. Table: User (System Users & Authentication)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS "User" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL UNIQUE,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 2. Table: BitrixConfiguration (Bitrix24 Portal Connection & Webhook Settings)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS "BitrixConfiguration" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "portalUrl" VARCHAR(500) NOT NULL,
    "webhookUrlEncrypted" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "lastTestedAt" TIMESTAMP(3) WITH TIME ZONE,
    "connectionStatus" VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    CONSTRAINT "fk_bitrixconfiguration_user" FOREIGN KEY ("createdById") 
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ==============================================================================
-- 3. Table: ImportJob (Excel Import Executions & Batches)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS "ImportJob" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "fileName" VARCHAR(500) NOT NULL,
    "filePath" VARCHAR(1000) NOT NULL,
    "importMode" VARCHAR(50) NOT NULL DEFAULT 'CREATE_UPDATE',
    "type" VARCHAR(50) NOT NULL DEFAULT 'PRODUCTS',
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successfulRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "createdProductsCount" INTEGER NOT NULL DEFAULT 0,
    "updatedProductsCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "mappingJson" JSONB,
    "bitrixDocumentId" VARCHAR(255),
    "startedAt" TIMESTAMP(3) WITH TIME ZONE,
    "completedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    CONSTRAINT "fk_importjob_user" FOREIGN KEY ("createdById") 
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ==============================================================================
-- 4. Table: ImportRecord (Row-level Records & Error Audit Trail)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS "ImportRecord" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "importJobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sku" VARCHAR(255),
    "productName" VARCHAR(500),
    "partNumber" VARCHAR(255),
    "description" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "actionTaken" VARCHAR(50),
    "bitrixProductId" VARCHAR(255),
    "bitrixDocumentId" VARCHAR(255),
    "warehouseId" INTEGER,
    "quantityArrived" DOUBLE PRECISION,
    "purchasePrice" DOUBLE PRECISION,
    "salesPrice" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "dealerPrice" DOUBLE PRECISION,
    "endUserPrice" DOUBLE PRECISION,
    "qtyOnOrder" DOUBLE PRECISION,
    "qtyInStock" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "bitrixError" TEXT,
    "errorType" VARCHAR(100),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_importrecord_job" FOREIGN KEY ("importJobId") 
        REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ==============================================================================
-- 5. Table: ColumnMapping (Saved Excel-to-Bitrix Header Configurations)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS "ColumnMapping" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "mappingJson" JSONB,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    CONSTRAINT "fk_columnmapping_user" FOREIGN KEY ("createdById") 
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ==============================================================================
-- 6. Table: DebugLog (System Diagnostics, API Metrics & Audit Logs)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS "DebugLog" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "level" VARCHAR(50) NOT NULL DEFAULT 'INFO',
    "source" VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- Indexes for High Throughput & Fast Querying
-- ==============================================================================
CREATE INDEX IF NOT EXISTS "idx_bitrixconfig_createdbyid" ON "BitrixConfiguration"("createdById");
CREATE INDEX IF NOT EXISTS "idx_importjob_createdbyid" ON "ImportJob"("createdById");
CREATE INDEX IF NOT EXISTS "idx_columnmapping_createdbyid" ON "ColumnMapping"("createdById");

CREATE INDEX IF NOT EXISTS "idx_importrecord_jobid" ON "ImportRecord"("importJobId");
CREATE INDEX IF NOT EXISTS "idx_importrecord_status" ON "ImportRecord"("status");
CREATE INDEX IF NOT EXISTS "idx_importrecord_sku" ON "ImportRecord"("sku");
CREATE INDEX IF NOT EXISTS "idx_importrecord_partnumber" ON "ImportRecord"("partNumber");

CREATE INDEX IF NOT EXISTS "idx_debuglog_level" ON "DebugLog"("level");
CREATE INDEX IF NOT EXISTS "idx_debuglog_source" ON "DebugLog"("source");
CREATE INDEX IF NOT EXISTS "idx_debuglog_createdat" ON "DebugLog"("createdAt");

-- ==============================================================================
-- 7. Seed Data: Default Administrator User Creation & Initial Assignment
-- ==============================================================================
-- Default Credentials:
-- Email:    admin@system.com
-- Password: Admin@123456
-- Hash:     $2b$10$9EHNBPQMVLW3Qd8aJpSXheTc7sD5eIonKxaXVBSIrWkam4m2/1X0e (bcrypt 10 rounds)

INSERT INTO "User" (
    "id",
    "email",
    "passwordHash",
    "role",
    "isActive",
    "createdAt",
    "updatedAt"
) VALUES (
    gen_random_uuid(),
    'admin@system.com',
    '$2b$10$9EHNBPQMVLW3Qd8aJpSXheTc7sD5eIonKxaXVBSIrWkam4m2/1X0e',
    'ADMIN',
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("email") DO UPDATE SET
    "role" = 'ADMIN',
    "isActive" = TRUE,
    "updatedAt" = CURRENT_TIMESTAMP;

-- Backfill unassigned Bitrix configuration to the default administrator
UPDATE "BitrixConfiguration"
SET "createdById" = (SELECT "id" FROM "User" WHERE "email" = 'admin@system.com' LIMIT 1)
WHERE "createdById" IS NULL;

-- ==============================================================================
-- End of Schema Definition
-- ==============================================================================
