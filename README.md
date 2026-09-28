# Bitrix24 Inventory & Quotation Middleware

A production-ready, full-stack enterprise middleware application designed for **automated daily Excel inventory synchronization**, **Bitrix24 Product Catalog management**, **multi-tier pricing (Dealer vs End User)**, **stock receipt arrivals**, **classic CRM invoices**, and **CRM quotation/deal pricing automation** via the Bitrix24 REST API.

Built with **Node.js 20 LTS, Express, TypeScript 5.5, React 18, PostgreSQL 15, Prisma ORM 5.19, Redis 7, BullMQ 5.12, and Docker**.

---

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Confirmed Functional Requirements Compliance (12 Specifications)](#2-confirmed-functional-requirements-compliance-12-specifications)
- [3. The 8 Canonical Excel Inventory Fields](#3-the-8-canonical-excel-inventory-fields)
- [4. Core Subsystems & Operational Workflows](#4-core-subsystems--operational-workflows)
  - [4.1 Automated Daily Import Scheduler (`uploads/daily_feed/`)](#41-automated-daily-import-scheduler-uploadsdaily_feed)
  - [4.2 Backend Quotation & Customer-Tier Pricing Engine](#42-backend-quotation--customer-tier-pricing-engine)
  - [4.3 Stock Receipt & Catalog Synchronization Wizard (`/inventory/stock-receipt`)](#43-stock-receipt--catalog-synchronization-wizard-inventorystock-receipt)
  - [4.4 Product & Inventory Import Wizard (`/inventory/import`)](#44-product--inventory-import-wizard-inventoryimport)
  - [4.5 Classic CRM Invoice Import Wizard (`/invoices/import`)](#45-classic-crm-invoice-import-wizard-invoicesimport)
  - [4.6 Asynchronous Processing Pipeline (Redis + BullMQ)](#46-asynchronous-processing-pipeline-redis--bullmq)
  - [4.7 Import Tracking, Error Reporting & Retry Engine](#47-import-tracking-error-reporting--retry-engine)
  - [4.8 Live Diagnostic Debug Console (`/debug`)](#48-live-diagnostic-debug-console-debug)
  - [4.9 Authentication & Portal Security](#49-authentication--portal-security)
- [5. Technology Stack](#5-technology-stack)
- [6. Database Architecture (Prisma Schema)](#6-database-architecture-prisma-schema)
- [7. Bitrix24 REST API Integration Reference](#7-bitrix24-rest-api-integration-reference)
- [8. REST API Endpoints Reference](#8-rest-api-endpoints-reference)
- [9. Configuration & Environment Variables](#9-configuration--environment-variables)
- [10. Deployment & Getting Started](#10-deployment--getting-started)
  - [10.1 Quick Start with Docker Compose](#101-quick-start-with-docker-compose)
  - [10.2 Setting Up the Daily Feed](#102-setting-up-the-daily-feed)
  - [10.3 Bitrix24 Quotation Webhook Setup](#103-bitrix24-quotation-webhook-setup)
  - [10.4 Local Development Setup](#104-local-development-setup)
- [11. Platform Considerations & Technical Notes](#11-platform-considerations--technical-notes)
- [License](#license)

---

## 1. Architecture Overview

The middleware decouples user interactions, file ingestion, and background schedulers from direct Bitrix24 REST execution. Heavy file parsing and high-volume REST synchronizations are queued in Redis and processed asynchronously by BullMQ workers with concurrency control, backoff retries, and database reconciliation.

```
                              ┌────────────────────────────────────────┐
                              │            React Frontend              │
                              │     (Vite + Tailwind + React Router)   │
                              └───────────────────┬────────────────────┘
                                                  │ HTTPS / JSON
                                                  ▼
┌───────────────────────┐     ┌────────────────────────────────────────┐
│   Daily Feed Folder   │────▶│          Express API Backend           │◀──── Bitrix Outgoing
│ (uploads/daily_feed/) │     │    (Auth / Rate Limiting / Multer)     │      Webhooks (Quotes)
└───────────────────────┘     └───────┬──────────────────────┬─────────┘
                                      │                      │
                     Enqueues Job     │                      │ SQL Queries
                                      ▼                      ▼
                   ┌───────────────────────┐      ┌─────────────────────────┐
                   │     Redis + BullMQ    │      │   PostgreSQL + Prisma   │
                   │    (import-queue)     │      │   (Jobs, Records, Logs) │
                   └──────────┬────────────┘      └─────────────────────────┘
                              │
                    Dequeues  │
                              ▼
                   ┌───────────────────────┐
                   │  Async Import Worker  │
                   │ (Controlled Concurrency)
                   └──────────┬────────────┘
                              │ Bitrix REST API (Rate-limit aware with retries)
                              ▼
                   ┌───────────────────────┐
                   │    Bitrix24 Portal    │
                   │ (Catalog/Price/CRM)   │
                   └───────────────────────┘
```

---

## 2. Confirmed Functional Requirements Compliance (12 Specifications)

The middleware fully implements the **12 confirmed functional requirements** for daily Excel inventory imports, Bitrix24 catalog synchronization, and quotation pricing:

| # | Requirement | Implementation Summary | Key File References |
|---|---|---|---|
| **1** | **Daily Import** | Automated background scheduler watches `uploads/daily_feed/`, runs daily at a configurable time (default `02:00` AM), processes the latest inventory status file, automatically archives it to `uploads/daily_feed/processed/`, and provides manual UI trigger & schedule management. | [`dailyImport.scheduler.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/schedule/dailyImport.scheduler.ts)<br>[`BitrixSettings.tsx`](file:///d:/bitrix24_inventory_middleware/frontend/src/pages/BitrixSettings.tsx) |
| **2** | **Product Matching** | Uses `CODE` as the golden unique product identifier to match existing Bitrix24 products and prevent duplicates. If `CODE` exists, the product is updated. If `CODE` does not exist, a new product is created. | [`BitrixCatalogService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts)<br>[`stockReceiptImport.service.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/import/stockReceiptImport.service.ts) |
| **3** | **Product Description** | `DESCRIPTION` is enforced as mandatory during file validation. Populates the Bitrix24 Product Catalog item description (`DESCRIPTION`) and custom property fields. | [`excel.validator.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/excel/excel.validator.ts)<br>[`BitrixCatalogService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **4** | **Existing Product Updates** | During every import, existing products matched by `CODE` are automatically updated with: `QTY IN STOCK`, `QTY ON ORDER`, `COST`, `DEALER PRICE`, and `END USER PRICE`. | [`BitrixCatalogService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **5** | **QTY ON ORDER Handling** | Inbound/pipeline inventory (`QTY ON ORDER`) is mapped into Bitrix24's reserved quantity (`quantityReserved` via `setReservedQuantity`), custom property `PROPERTY_QTY_ON_ORDER`, and stock receipt line item commentary. | [`BitrixCatalogService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts)<br>[`stockReceiptImport.service.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/import/stockReceiptImport.service.ts) |
| **6** | **New Product Creation** | When a `CODE` does not exist in Bitrix24, a new catalog product is automatically provisioned with all 8 fields (`CODE`, `PART NUMBER` as Title, `DESCRIPTION`, `QTY IN STOCK`, `QTY ON ORDER`, `COST`, `DEALER PRICE`, `END USER PRICE`). | [`BitrixCatalogService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **7** | **Separate Price Types** | Dealer Price (Price Type ID 4) and End User Price (Price Type ID 6 / Base Price) are maintained as separate price types in Bitrix24 via `catalog.price.*` REST endpoints. | [`BitrixCatalogService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **8** | **Import History** | Every manual and daily scheduled import is tracked in PostgreSQL `ImportJob` and `ImportRecord`. Administrators can view row-by-row status, timestamps, and execution summaries at `/imports`. | [`ImportHistory.tsx`](file:///d:/bitrix24_inventory_middleware/frontend/src/pages/ImportHistory.tsx)<br>[`ImportDetails.tsx`](file:///d:/bitrix24_inventory_middleware/frontend/src/pages/ImportDetails.tsx) |
| **9** | **Downloadable Error Reports** | If any row fails during an import, an `.xlsx` error report containing Row Number, SKU/Code, Product Title, and exact Bitrix API error message is downloadable with one click via `GET /api/imports/:id/error-report`. | [`import.controller.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/controllers/import.controller.ts)<br>[`ErrorHandling.tsx`](file:///d:/bitrix24_inventory_middleware/frontend/src/pages/ErrorHandling.tsx) |
| **10** | **Quotation Process & Customer-Based Pricing (Backend Logic)** | Backend service automatically inspects whether the Quote or Deal customer (Company/Contact) is a **Dealer** or **End User**. Resolves product line items (`Product Code`, `Part Number`, `Description`, `Price`) and applies Dealer Price to Dealers and End User Price to End Users. *(Pure backend logic; no UI)* | [`BitrixQuotationService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixQuotationService.ts)<br>[`bitrix.controller.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/controllers/bitrix.controller.ts) |
| **11** | **Quotation Workflow & Webhook Trigger** | Outgoing Bitrix24 webhook endpoint (`POST /api/bitrix/quote-pricing/webhook`) triggers automatic recalculation and application of customer-tier pricing whenever a Quote or Deal is created/updated in CRM. | [`BitrixQuotationService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixQuotationService.ts)<br>[`bitrix.routes.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/routes/bitrix.routes.ts) |
| **12** | **Product Title = PART NUMBER** | In the Bitrix24 Product Catalog, the Product Title (`product.NAME`) is strictly set to the `PART NUMBER` field from the Excel file. | [`BitrixCatalogService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |

---

## 3. The 8 Canonical Excel Inventory Fields

The middleware recognizes the following 8 canonical fields from the client's daily Excel inventory sheet:

| # | Excel Column Header | Required? | Bitrix24 Target Entity & Field | Behavior & Handling |
|---|---|---|---|---|
| **1** | `CODE` | **Yes** (Unique Key) | `crm.product.add / update` (`CODE`), `catalog.product.list` (`code`) | **Golden Match Key**: Matches existing catalog products and prevents duplicate creation. Case-insensitive and whitespace-trimmed. |
| **2** | `PART NUMBER` | **Yes** | `crm.product.add / update` (`NAME`), `PROPERTY_PART_NUMBER` | **Product Title**: The Bitrix24 Product Catalog item name (`NAME`) is **strictly set to the `PART NUMBER`** (Requirement 12). |
| **3** | `DESCRIPTION` | **Yes** | `crm.product.add / update` (`DESCRIPTION`), `PROPERTY_DESCRIPTION` | **Product Description**: Mandatory in the Excel validator. Populates catalog description so sales teams have full product specifications (Requirement 3). |
| **4** | `QTY IN STOCK` | Optional | `catalog.document.element.add` (`amount`), `catalog.storeproduct.update`, `catalog.product.update` (`quantity`) | **Available Stock**: Recorded as arrived inventory in arrival documents (`docType: 'A'`), updated in warehouse store balances, and synced to catalog quantity. |
| **5** | `QTY ON ORDER` | Optional | `catalog.product.update` (`quantityReserved`), `PROPERTY_QTY_ON_ORDER` | **Pipeline Inventory**: Stored in Bitrix's reserved quantity field and custom property `PROPERTY_QTY_ON_ORDER` for incoming inventory visibility (Requirement 5). |
| **6** | `COST` | Optional | `catalog.product.update` (`purchasingPrice`), `catalog.document.element.add` (`purchasingPrice`), `PROPERTY_COST` | **Purchasing Cost**: Stored as product purchasing price and document arrival cost valuation. |
| **7** | `DEALER PRICE` | Optional | `catalog.price.add / update` (`catalogGroupId: 4`), `PROPERTY_DEALER_PRICE` | **Dealer Tier**: Maintained as a separate price type (ID 4) for B2B/wholesale accounts. |
| **8** | `END USER PRICE` | Optional | `catalog.price.add / update` (`catalogGroupId: 6`), `crm.product.add / update` (`PRICE`) | **End User Tier**: Maintained as the retail base price type (ID 6) for standard customer quotations. |

---

## 4. Core Subsystems & Operational Workflows

### 4.1 Automated Daily Import Scheduler (`uploads/daily_feed/`)

The automated daily import subsystem provides hands-free inventory synchronization:

```
┌─────────────────────────────────┐
│ External FTP / ERP / User Drop  │
│  drops inventory.xlsx into:     │
│   uploads/daily_feed/           │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│      DailyImportScheduler       │
│ - Wakes up daily (default 02:00)│
│ - Detects newest .xlsx / .csv   │
│ - Validates 8 canonical fields  │
│ - Creates ImportJob & Records   │
│ - Enqueues to BullMQ worker     │
│ - Archives file to:             │
│   uploads/daily_feed/processed/ │
└─────────────────────────────────┘
```

- **Folder Path:** `uploads/daily_feed/` (auto-created on server boot).
- **Archive Path:** `uploads/daily_feed/processed/` with timestamp prefixes (`YYYYMMDD_HHMMSS_<filename>`).
- **Default Schedule:** Daily at `02:00` AM (configurable via `DAILY_IMPORT_CRON` or UI).
- **UI Management Card:** Located on the **Bitrix Configuration** page (`/settings/bitrix`):
  - Toggle scheduler enabled/disabled.
  - Set 24h execution time.
  - View waiting file count in `uploads/daily_feed/`.
  - View last run timestamp, file name, and status badge.
  - **"Run Daily Import Now"** on-demand trigger button.
- **REST Endpoints:**
  - `GET /api/imports/daily-schedule` — Returns scheduler status and pending file count.
  - `POST /api/imports/daily-schedule` — Updates schedule time and enable/disable state.
  - `POST /api/imports/daily-trigger` — Triggers an immediate import of the latest file in the feed directory.

---

### 4.2 Backend Quotation & Customer-Tier Pricing Engine

> **Note on UI Policy:** In accordance with explicit project requirements, quotation and customer-tier pricing is **implemented strictly as backend logic and webhook automation**. No frontend quotation UI page exists.

The backend engine ([`BitrixQuotationService.ts`](file:///d:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixQuotationService.ts)) handles multi-tier pricing for CRM Quotes and Deals:

```
Bitrix24 CRM User creates Quote / Deal
                  │
                  ▼
Bitrix Automation / Outgoing Webhook calls:
POST /api/bitrix/quote-pricing/webhook
                  │
                  ▼
       BitrixQuotationService
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
Check Company       Check Contact
(crm.company.get)   (crm.contact.get)
        │                   │
        └─────────┬─────────┘
                  │ Resolves Customer Type:
                  ├──────────────────────────────┐
                  ▼                              ▼
            DEALER Customer              END USER Customer
   (COMPANY_TYPE contains dealer/   (Standard client/customer)
    distributor/wholesale/partner)               │
                  │                              │
                  ▼                              ▼
         Fetch Catalog Price            Fetch Catalog Price
         Price Type ID: 4               Price Type ID: 6 (Base)
         (DEALER PRICE)                 (END USER PRICE)
                  │                              │
                  └──────────────┬───────────────┘
                                 ▼
                     crm.quote.productrows.set
                     - Product Code (CODE)
                     - Part Number (Product Title)
                     - Description
                     - Tiered Applied Price
                                 ▼
                         crm.quote.update
                     (OPPORTUNITY Total Amount)
```

#### Key Capabilities:
1. **Intelligent Customer Tier Resolution:**
   - Inspects linked Company (`crm.company.get`) or Contact (`crm.contact.get`).
   - Evaluates `COMPANY_TYPE`, `COMMENTS`, or custom fields like `UF_CRM_CUSTOMER_TYPE`.
   - Recognizes keywords: `dealer`, `distributor`, `wholesale`, `reseller`, `partner`.
   - If not a dealer, defaults to `END_USER`.
2. **Catalog Metadata Enrichment:**
   - Reads catalog product rows attached to the Quote or Deal.
   - Extracts `Product Code` (`CODE`), `Part Number` (`NAME`), `Description`, and price tiers.
3. **Automated Line Item Recalculation:**
   - Applies `DEALER PRICE` (Price Type ID 4) for Dealer accounts.
   - Applies `END USER PRICE` (Price Type ID 6 / Base Price) for End User accounts.
   - Updates Quote or Deal product rows via `crm.quote.productrows.set` or `crm.deal.productrows.set`.
   - Updates the total entity `OPPORTUNITY` valuation via `crm.quote.update` or `crm.deal.update`.
4. **Integration Methods:**
   - **Outgoing Webhook:** `POST /api/bitrix/quote-pricing/webhook` (called by Bitrix CRM Automation rules on `ONCRMQUOTEADD`, `ONCRMQUOTEUPDATE`, `ONCRMDEALADD`, `ONCRMDEALUPDATE`).
   - **Direct API Call:** `POST /api/bitrix/quote-pricing/apply` (`{ entityType: 'quote' | 'deal', entityId: 123 }`).
   - **Product Query:** `GET /api/bitrix/quote-pricing/products?search=...` (inspects catalog items with multi-tier pricing).

---

### 4.3 Stock Receipt & Catalog Synchronization Wizard (`/inventory/stock-receipt`)

A full interactive wizard connecting supplier arrival spreadsheets directly to **Bitrix24 Inventory Management Stock Receipts** and the **Product Catalog**:

1. **Upload & Preview:** Drag-and-drop `.xlsx`, `.xls`, or `.csv` files. Instant 50-row preview.
2. **Dynamic Field Discovery:**
   - Queries `GET /api/bitrix/stock-receipt-fields` to discover live portal schema (`catalog.document.element.getFields`, `catalog.product.getFields`, `catalog.store.list`).
3. **Column Mapping:**
   - Maps the 8 canonical fields (`CODE`, `PART NUMBER`, `DESCRIPTION`, `QTY IN STOCK`, `QTY ON ORDER`, `COST`, `DEALER PRICE`, `END USER PRICE`).
   - Target warehouse selection (defaults to Main Warehouse ID 62 or auto-matched by title).
4. **Execution Flow:**
   - Matches products by `CODE`.
   - Provisions missing products (setting Title = `PART NUMBER`).
   - Creates official Bitrix24 Arrival document (`catalog.document.add` with `docType: 'A'`).
   - Registers line items with arrival quantity and purchasing price (`catalog.document.element.add`).
   - Posts/conducts the arrival document (`catalog.document.conduct`) to credit warehouse inventory balances.
   - Updates store balances via `catalog.storeproduct.update` and catalog `quantityReserved`.

---

### 4.4 Product & Inventory Import Wizard (`/inventory/import`)

A 6-step workflow for ad-hoc catalog synchronization:
1. **Upload:** Select file up to `MAX_FILE_SIZE_MB`.
2. **Preview:** Instant table preview of headers and data rows.
3. **Map Columns:** Auto-mapping engine with fuzzy matching.
4. **Policy Selection:** `Create + Update` *(default)*, `Create Only`, or `Update Only`.
5. **Enqueue:** Job saved to PostgreSQL and sent to BullMQ.
6. **Live Progress:** Real-time polling with progress bar and row counts.

---

### 4.5 Classic CRM Invoice Import Wizard (`/invoices/import`)

Dedicated pipeline for Bitrix24's classic CRM invoice entity (`crm.invoice.*`):
- **Mapped Fields:** `ACCOUNT_NUMBER` (match key), `ORDER_TOPIC`, `CLIENT`, `PRICE`, `CURRENCY`, `STATUS_ID` (`N` = New, `S` = Sent, `P` = Paid, `D` = Unpaid), `DATE_BILL`, `DATE_PAY_BEFORE`, `COMMENT`.
- **Idempotent Sync:** Matches by `ACCOUNT_NUMBER` via `crm.invoice.list`. Updates existing invoices, creates new invoices via `crm.invoice.add`.

---

### 4.6 Asynchronous Processing Pipeline (Redis + BullMQ)

- **Queue Name:** `import-queue`.
- **Controlled Concurrency:** Bounded worker pool (default 5 concurrent requests) respects Bitrix REST rate limits (2 queries/sec standard limit with burst buffer).
- **Crash Recovery & Reconciliation:** On server restart, any jobs stranded in `PROCESSING` are reconciled and marked for retry.
- **Upload Staging Cleanup:** Intermediate uploaded files are cleaned up upon job completion or failure.

---

### 4.7 Import Tracking, Error Reporting & Retry Engine

- **Import History (`/imports`):** Search, filter by status (`PENDING`, `PROCESSING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED`), and view timestamps.
- **Import Details (`/imports/:id`):** Visual status breakdown chart, Bitrix document reference link, and detailed error logs table.
- **Downloadable Error Reports:** Generates an `.xlsx` file on-the-fly (`GET /api/imports/:id/error-report`) listing `Row Number | SKU / Code | Product Name | Status | Error Details`.
- **One-Click Retry:** **"Retry Failed Records"** button resets `FAILED` and `PARTIAL_FAILURE` rows to `PENDING` and re-submits the job without duplicating successful rows.

---

### 4.8 Live Diagnostic Debug Console (`/debug`)

- **Persistent Logging:** PostgreSQL `DebugLog` table stores structured audit trails.
- **Sources Tracked:** `SYSTEM`, `API`, `AUTH`, `SETTINGS`, `BITRIX`, `IMPORT`, `WORKER`.
- **Real-Time Stream:** Auto-refreshes every 3 seconds with expandable JSON metadata for payloads, HTTP status codes, durations, and error traces.
- **Filters:** Search keyword, log level (`DEBUG`, `INFO`, `WARN`, `ERROR`), source filter, and "Clear Logs" button.

---

### 4.9 Authentication & Portal Security

- **JWT Cookie Auth:** Secure HTTP-only cookies (`COOKIE_SECURE` configurable for HTTPS or HTTP).
- **Auto-Seeded Administrator:** Bootstraps default admin account defined in `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- **AES-256-GCM Encryption:** Bitrix24 incoming webhook tokens are encrypted using `BITRIX_ENCRYPTION_KEY` before database storage. Webhook URLs are masked as `******************************` in the UI and never leaked to logs or client responses.
- **Rate Limit Throttling Interceptor:** Intercepts Bitrix `QUERY_LIMIT_EXCEEDED` or `OPERATION_LIMIT` responses and applies exponential backoff retries.

---

## 5. Technology Stack

### Backend
- **Runtime & Language:** Node.js 20 LTS, TypeScript 5.5
- **Framework:** Express 4.21
- **Database & ORM:** PostgreSQL 15+, Prisma ORM 5.19
- **Job Queue:** BullMQ 5.12 backed by Redis 7
- **Excel & CSV Engine:** ExcelJS 4.4 + custom streaming CSV parser
- **Security & Crypto:** Node `crypto` (AES-256-GCM), bcrypt, jsonwebtoken, Helmet, express-rate-limit
- **Logging:** Pino 9 + Pino-pretty + PostgreSQL-backed `DebugLog` service

### Frontend
- **Framework & Tooling:** React 18, Vite 5, TypeScript 5.5
- **Routing:** React Router DOM v6
- **Styling:** Tailwind CSS 3.4
- **Forms & Validation:** React Hook Form 7, Zod 3.23
- **Notifications & Charts:** React Hot Toast, Recharts 2.12

### Infrastructure & Orchestration
- **Containerization:** Docker & Docker Compose
- **Web Server:** Nginx (frontend reverse proxy and static asset delivery)

---

## 6. Database Architecture (Prisma Schema)

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│              User               │       │       BitrixConfiguration       │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ id: UUID (PK)                   │       │ id: UUID (PK)                   │
│ email: String (Unique)          │       │ portalUrl: String               │
│ passwordHash: String            │       │ webhookUrlEncrypted: String     │
│ role: String                    │       │ isActive: Boolean               │
│ createdAt / updatedAt           │       │ connectionStatus: String        │
└───────────────┬─────────────────┘       │ lastTestedAt: DateTime?         │
                │ 1                       └─────────────────────────────────┘
                │
                │ creates
                ▼ N
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│            ImportJob            │ 1   N │          ImportRecord           │
├─────────────────────────────────┼───────┼─────────────────────────────────┤
│ id: UUID (PK)                   │       │ id: UUID (PK)                   │
│ fileName: String                │       │ importJobId: UUID (FK)          │
│ filePath: String                │       │ rowNumber: Int                  │
│ importMode: String              │       │ sku: String?                    │
│ type: String                    │       │ productName: String?            │
│   (PRODUCTS / INVOICES /        │       │ status: String                  │
│    STOCK_RECEIPTS)              │       │ bitrixProductId: String?        │
│ bitrixDocumentId: String?       │       │ bitrixDocumentId: String?       │
│ status: String                  │       │ warehouseId: Int?               │
│ totalRows / processedRows       │       │ quantityArrived: Float?         │
│ successfulRows / failedRows     │       │ purchasePrice: Float?           │
│ mappingJson: Json?              │       │ salesPrice: Float?              │
│ startedAt / completedAt         │       │ errorMessage / bitrixError      │
│ createdAt: DateTime             │       │ rawData: Json?                  │
└─────────────────────────────────┘       └─────────────────────────────────┘

┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│          ColumnMapping          │       │            DebugLog             │
├─────────────────────────────────┼───────┼─────────────────────────────────┤
│ id: UUID (PK)                   │       │ id: UUID (PK)                   │
│ name: String                    │       │ level: String (INFO/WARN/ERROR) │
│ mappingJson: Json?              │       │ source: String (API/BITRIX/etc) │
│ createdById: UUID (FK User)     │       │ message: String                 │
│ createdAt / updatedAt           │       │ details: Json?                  │
└─────────────────────────────────┘       │ createdAt: DateTime             │
                                          └─────────────────────────────────┘
```

---

## 7. Bitrix24 REST API Integration Reference

The middleware interfaces with official Bitrix24 REST API endpoints:

| Domain | Bitrix Method | Purpose |
|---|---|---|
| **System** | `scope` / `profile` | Webhook connectivity and permission verification |
| **Catalog** | `catalog.catalog.list` | Resolves primary commercial catalog ID |
| **Price** | `catalog.priceType.list` | Resolves base price type, Dealer price type (ID 4), and End User price type (ID 6) |
| **Price** | `catalog.price.list` | Looks up existing price entries for a product |
| **Price** | `catalog.price.add` / `.update` | Sets Base, Dealer, and End User prices |
| **Currency** | `crm.currency.list` | Resolves the portal's active base currency |
| **Product** | `catalog.product.getFields` | Discovers catalog schema and product field definitions |
| **Product** | `catalog.product.list` | Idempotent lookup by SKU / `CODE` / `XML_ID` or product name |
| **Product** | `crm.product.add` / `catalog.product.add` | Creates missing catalog products (sets Title = `PART NUMBER`) |
| **Product** | `crm.product.update` / `catalog.product.update` | Updates existing products, sets quantity, and updates `quantityReserved` |
| **Stores** | `catalog.store.list` | Lists available warehouses / stores |
| **Stock Receipt** | `catalog.document.element.getFields` | Discovers document line item fields (`amount`, `purchasingPrice`, `storeTo`) |
| **Stock Receipt** | `catalog.document.add` | Creates official arrival stock receipt document (`docType: 'A'`) |
| **Stock Receipt** | `catalog.document.element.add` | Adds line items with product ID, arrival qty, destination store, & purchase price |
| **Stock Receipt** | `catalog.document.conduct` | Officially conducts/posts arrival document into warehouse inventory |
| **Store Balance** | `catalog.storeproduct.update` | Updates physical store inventory balances directly |
| **Company & Contact** | `crm.company.get` / `crm.contact.get` | Resolves customer type (Dealer vs End User) for quotations |
| **Quotation & Deal** | `crm.quote.get` / `crm.deal.get` | Fetches Quote / Deal header information and linked customer ID |
| **Quotation Rows** | `crm.quote.productrows.get` / `.set` | Retrieves and updates line items with customer-tier pricing |
| **Deal Rows** | `crm.deal.productrows.get` / `.set` | Retrieves and updates Deal line items with customer-tier pricing |
| **Entity Valuation** | `crm.quote.update` / `crm.deal.update` | Recalculates total `OPPORTUNITY` amount based on tier pricing |
| **Invoice** | `crm.invoice.list` | Searches existing invoices by `ACCOUNT_NUMBER` |
| **Invoice** | `crm.invoice.add` | Creates new classic CRM invoices |
| **Invoice** | `crm.invoice.update` | Updates invoice values and payment status |
| **Batch** | `batch` | Bulk execution support |

---

## 8. REST API Endpoints Reference

Base URL: `http://localhost:5000/api`

### Authentication (`/api/auth`)
- `POST /api/auth/login` — Authenticate admin, returns user data and sets HTTP-only cookie.
- `POST /api/auth/logout` — Clears authentication cookie.
- `GET /api/auth/me` — Fetches current authenticated session.

### Dashboard (`/api/dashboard`)
- `GET /api/dashboard/stats` — Overall totals, Bitrix connection status, and recent imports list.

### Bitrix Settings (`/api/settings`)
- `GET /api/settings/bitrix` — Returns configured portal URL and connection status (encrypted token hidden).
- `POST /api/settings/bitrix` — Saves/replaces portal URL and webhook (encrypts with AES-256-GCM).
- `PUT /api/settings/bitrix` — Updates existing settings.
- `DELETE /api/settings/bitrix` — Deactivates active configuration.
- `POST /api/settings/bitrix/test` — Performs live connection test against Bitrix.

### Bitrix Discovery & Quotation Pricing (`/api/bitrix`)
- `GET /api/bitrix/catalogs` — Lists portal commercial catalogs.
- `GET /api/bitrix/products/fields` — Returns Bitrix product field schema.
- `GET /api/bitrix/inventory/fields` — Returns inventory/store field schema.
- `GET /api/bitrix/stores` — Lists warehouses/stores.
- `GET /api/bitrix/stock-receipt-fields` — Dynamically discovers available stock receipt arrival fields, catalog fields, and warehouse stores.
- `GET /api/bitrix/invoice-fields` — Returns supported invoice field definitions and statuses.
- `POST /api/bitrix/quote-pricing/webhook` — **Public webhook endpoint** for Bitrix24 Outgoing Webhooks (`ONCRMQUOTEADD`, `ONCRMQUOTEUPDATE`, `ONCRMDEALADD`, `ONCRMDEALUPDATE`).
- `POST /api/bitrix/quote-pricing/apply` — Manually applies customer-tier pricing (Dealer vs End User) to a Quote or Deal (`{ entityId, entityType, customerType? }`).
- `GET /api/bitrix/quote-pricing/config` — Returns quotation pricing configuration, supported events, and pricing tier rules.
- `GET /api/bitrix/quote-pricing/products` — Queries catalog products with both Dealer and End User prices for inspection.

### Imports Engine (`/api/imports`)
- `POST /api/imports/upload` — Uploads raw file (`multipart/form-data`) into staging.
- `POST /api/imports/preview` — Parses file and returns headers, row counts, and preview sample.
- `POST /api/imports` — Validates rows, creates `ImportJob` & `ImportRecord`s, and queues job (`type`: `PRODUCTS`, `INVOICES`, `STOCK_RECEIPTS`).
- `GET /api/imports/daily-schedule` — Returns automated daily import scheduler configuration, execution time, and pending feed files.
- `POST /api/imports/daily-schedule` — Updates daily import schedule time (`timeOfDay`) and enabled status.
- `POST /api/imports/daily-trigger` — Triggers immediate automated daily import of the newest file waiting in `uploads/daily_feed/`.
- `GET /api/imports` — Paginated list of import jobs with optional status filter.
- `GET /api/imports/:id` — Import job details with status counts.
- `GET /api/imports/:id/records` — Paginated list of records for a specific import job.
- `POST /api/imports/:id/records/:recordId/retry` — Retries a single failed record.
- `GET /api/imports/:id/errors` — Lists failed records for an import job.
- `GET /api/imports/:id/error-report` — **Downloads an Excel `.xlsx` file** containing all failed records (Row Number, SKU/Code, Product Name, Status, Error Message).
- `POST /api/imports/:id/retry` — Re-queues failed/partial records back to `PENDING`.
- `GET /api/imports/template` — Downloads sample Excel template with standard columns.

### Debug & Health (`/api/debug`, `/health`)
- `GET /api/debug/logs` — Query diagnostic logs (level, source, search, pagination).
- `GET /api/debug/stats` — Summary counts by log level and source.
- `DELETE /api/debug/logs` — Clears all diagnostic logs.
- `GET /health` — Health check endpoint verifying PostgreSQL and Redis connections.

---

## 9. Configuration & Environment Variables

Copy `.env.example` to `.env` in the root folder for Docker Compose or in `backend/.env` for manual execution:

| Variable | Default (Dev) | Description |
|---|---|---|
| `PORT` | `5000` | Port for the Express backend server |
| `NODE_ENV` | `development` | Environment mode (`development` or `production`) |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/bitrix_inventory` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string for BullMQ |
| `JWT_SECRET` | *(Required)* | Secret key used for signing JWT cookies |
| `ADMIN_EMAIL` | `admin@system.com` | Default email for seeded administrator |
| `ADMIN_PASSWORD` | `Admin@123456` | Default password for seeded administrator |
| `BITRIX_ENCRYPTION_KEY` | *(Required 32-char)* | Secret key used for AES-256-GCM webhook encryption |
| `UPLOAD_DIR` | `./uploads` | Staging upload directory |
| `MAX_FILE_SIZE_MB` | `10` | Maximum allowed file upload size in MB |
| `BITRIX_CONCURRENCY` | `5` | Maximum parallel calls to Bitrix per worker batch |
| `BITRIX_MAX_RETRIES` | `3` | Max retries when encountering Bitrix rate limits |
| `BITRIX_REQUEST_TIMEOUT`| `30000` | Timeout in ms for outbound Bitrix REST calls |
| `BATCH_SIZE` | `50` | Number of database records processed per worker batch |
| `COOKIE_SECURE` | `false` (plain HTTP) | Set to `true` when running behind HTTPS / TLS |

---

## 10. Deployment & Getting Started

### 10.1 Quick Start with Docker Compose

Docker Compose runs the entire stack in isolated containers with automated volume mounts and health checks:

1. **Create root `.env`:**
   ```bash
   cp .env.example .env
   ```
2. **Build and start the containers:**
   ```bash
   docker compose up -d --build
   ```
3. **Verify running containers:**
   ```bash
   docker compose ps
   ```
   You should see 4 healthy containers:
   - `bitrix_inventory_postgres` (Port 5432)
   - `bitrix_inventory_redis` (Port 6379)
   - `bitrix_inventory_backend` (Port 5000)
   - `bitrix_inventory_frontend` (Port 3000)

4. **Access the application:**
   - Open [http://localhost:3000](http://localhost:3000)
   - Login with:
     - **Email:** `admin@system.com`
     - **Password:** `Admin@123456`
   - Navigate to **Bitrix Configuration** (`/settings/bitrix`) to set your webhook URL and test the connection.

---

### 10.2 Setting Up the Daily Feed

1. On the host machine or container, place your daily Excel inventory file (`.xlsx` or `.csv`) into:
   ```
   uploads/daily_feed/
   ```
2. The scheduler will automatically pick up the newest file at the scheduled time (default `02:00` AM), validate the 8 fields, sync the catalog, and archive the file to `uploads/daily_feed/processed/`.
3. To trigger an immediate import without waiting for the scheduled time:
   - Navigate to **Bitrix Configuration** (`/settings/bitrix`) and click **Run Daily Import Now**, OR
   - Call the API:
     ```bash
     curl -X POST http://localhost:5000/api/imports/daily-trigger \
       -H "Cookie: token=<jwt_token>"
     ```

---

### 10.3 Bitrix24 Quotation Webhook Setup

To have Bitrix24 automatically apply customer-tier pricing whenever a Quote or Deal is created:

1. In your Bitrix24 Portal, navigate to **Developer Network / Applications / Webhooks / Outgoing Webhook**.
2. Set the **URL handler** to:
   ```
   http://<your-server-domain-or-ip>:5000/api/bitrix/quote-pricing/webhook
   ```
3. Select Events:
   - `ONCRMQUOTEADD` (On Quote Add)
   - `ONCRMQUOTEUPDATE` (On Quote Update)
   - *(Optional for Deals)*: `ONCRMDEALADD`, `ONCRMDEALUPDATE`
4. Whenever a Quote is created in Bitrix24, the middleware automatically:
   - Identifies if the linked customer is a Dealer or End User.
   - Recalculates product prices using the appropriate price tier (`DEALER PRICE` vs `END USER PRICE`).
   - Updates the Quote line items and total opportunity valuation in real time.

---

### 10.4 Local Development Setup

If running directly on your host machine without Docker:

#### Prerequisites
- Node.js 20+
- PostgreSQL running locally on port `5432`
- Redis running locally on port `6379`

#### 1. Setup Backend
```bash
cd backend
cp .env.example .env
# Verify DATABASE_URL and REDIS_URL in .env
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev
# Backend starts at http://localhost:5000
```

#### 2. Setup Frontend
```bash
cd frontend
npm install
npm run dev
# Frontend starts at http://localhost:3000 (or http://localhost:5173)
```

---

## 11. Platform Considerations & Technical Notes

1. **Bitrix Inventory Management Mode:**
   - On Bitrix24 commercial plans with **Inventory Management** activated, direct writes to `catalog.product.update` (`quantity`) may be restricted by the portal. The middleware handles this by creating and conducting official stock receipt arrival documents (`catalog.document.add` + `catalog.document.conduct`) and updating warehouse store balances via `catalog.storeproduct.update`.
2. **Product Title Policy:**
   - In accordance with Requirement 12, the product catalog item name (`NAME`) is strictly set to `PART NUMBER`. If `PART NUMBER` is empty in a row, it falls back to `CODE`.
3. **Leading Zeros in Identifiers:**
   - All codes, SKUs, and barcodes are parsed as raw strings (e.g. `000452`) and never converted to floating-point numbers.
4. **Quotation Pricing Architecture:**
   - Built purely as backend service logic to enable Bitrix24 CRM workflows and automation rules without requiring manual data re-entry in an external UI.

---

## License

Internal proprietary software. All rights reserved.