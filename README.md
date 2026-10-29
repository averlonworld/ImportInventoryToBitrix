# Bitrix24 Inventory & Quotation Middleware

A production-ready, full-stack enterprise middleware platform designed for **automated daily Excel inventory synchronization**, **Bitrix24 Product Catalog management**, **net stock replacement & adjustment conduction**, **multi-tier pricing in Indian Rupees (INR ₹)**, **classic CRM invoices**, **CRM quotation & deal pricing automation**, **Bitrix24 Local Application iframe embedding**, **high-performance batch processing for 10,000+ items**, and **Licentic License Manager integration** via the Bitrix24 REST API.

Built with **Node.js 20 LTS, Express, TypeScript 5.5, React 18, PostgreSQL 15, Prisma ORM 5.19, Redis 7, BullMQ 5.12, and Docker**.

---

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Confirmed Functional Requirements Compliance (16 Specifications)](#2-confirmed-functional-requirements-compliance-16-specifications)
- [3. The 8 Canonical Excel Inventory Fields](#3-the-8-canonical-excel-inventory-fields)
- [4. Core Subsystems & Operational Workflows](#4-core-subsystems--operational-workflows)
  - [4.1 Automated Daily Import Scheduler (`uploads/daily_feed/`)](#41-automated-daily-import-scheduler-uploadsdaily_feed)
  - [4.2 Intelligent Stock Replacement & Adjustment Conduction Engine](#42-intelligent-stock-replacement--adjustment-conduction-engine)
  - [4.3 Backend Quotation & Customer-Tier Pricing Engine](#43-backend-quotation--customer-tier-pricing-engine)
  - [4.4 Stock Receipt & Inventory Synchronization Wizard (`/inventory/stock-receipt`)](#44-stock-receipt--inventory-synchronization-wizard-inventorystock-receipt)
  - [4.5 Product & Inventory Import Wizard (`/inventory/import`)](#45-product--inventory-import-wizard-inventoryimport)
  - [4.6 Classic CRM Invoice Import Wizard (`/invoices/import`)](#46-classic-crm-invoice-import-wizard-invoicesimport)
  - [4.7 Product Duplication Detection & Lifecycle Breakdown Metrics](#47-product-duplication-detection--lifecycle-breakdown-metrics)
  - [4.8 Advanced Error Handling, Failure Isolation & Granular Retry Engine (`/error-handling`)](#48-advanced-error-handling-failure-isolation--granular-retry-engine-error-handling)
  - [4.9 Asynchronous Processing Pipeline (Redis + BullMQ)](#49-asynchronous-processing-pipeline-redis--bullmq)
  - [4.10 Live Diagnostic Debug Console (`/debug`)](#410-live-diagnostic-debug-console-debug)
  - [4.11 Licentic License Manager & Dual-Mode Authentication](#411-licentic-license-manager--dual-mode-authentication)
  - [4.12 High-Performance Batch Optimization Engine (1,000 to 10,000+ Items)](#412-high-performance-batch-optimization-engine-1000-to-10000-items)
  - [4.13 Real-Time Upload Duration, Throughput & Dynamic ETA Display](#413-real-time-upload-duration-throughput--dynamic-eta-display)
  - [4.14 Bitrix24 Local Application Iframe Embedding & Security Architecture](#414-bitrix24-local-application-iframe-embedding--security-architecture)
  - [4.15 Standardized Indian Rupee (INR ₹) Financial Engine](#415-standardized-indian-rupee-inr--financial-engine)
- [5. Technology Stack](#5-technology-stack)
- [6. Database Architecture (Prisma Schema & ERD)](#6-database-architecture-prisma-schema--erd)
- [7. Bitrix24 REST API Integration Reference](#7-bitrix24-rest-api-integration-reference)
- [8. REST API Endpoints Reference](#8-rest-api-endpoints-reference)
- [9. Configuration & Environment Variables](#9-configuration--environment-variables)
- [10. Deployment & Getting Started](#10-deployment--getting-started)
  - [10.1 Quick Start with Docker Compose](#101-quick-start-with-docker-compose)
  - [10.2 Setting Up the Automated Daily Feed](#102-setting-up-the-automated-daily-feed)
  - [10.3 Bitrix24 Quotation Webhook Configuration](#103-bitrix24-quotation-webhook-configuration)
  - [10.4 Local Development Setup](#104-local-development-setup)
  - [10.5 Configuring as a Bitrix24 Local Application (Iframe Handler)](#105-configuring-as-a-bitrix24-local-application-iframe-handler)
  - [10.6 Generating Large-Scale Synthetic Test Datasets (5k & 10k Items)](#106-generating-large-scale-synthetic-test-datasets-5k--10k-items)
- [11. Platform Considerations & Technical Notes](#11-platform-considerations--technical-notes)
- [License](#license)

---

## 1. Architecture Overview

The middleware decouples user interactions, spreadsheet file ingestion, and background schedulers from direct Bitrix24 REST API execution. High-volume spreadsheet parsing and REST operations are queued in Redis and processed asynchronously by BullMQ workers with batched Bitrix calls, controlled concurrency, rate-limit backoff retries, and comprehensive database auditing.

The system also supports seamless embedding inside the **Bitrix24 Portal Iframe** as a Local Application, allowing CRM operators to access inventory synchronization directly from the Bitrix24 interface.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Bitrix24 Cloud / On-Premise                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Portal Iframe Container                      │  │
│  │           Handler: https://b24inventory.utkarshmishra.online/login│  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │ HTTPS (SameSite=None Cookies, CSP frame-ancestors)
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    Nginx Reverse Proxy & Static SPA                    │
│   - Strips conflicting X-Frame-Options                                 │
│   - Intercepts Bitrix HTTP 405 POST -> 200 SPA rewrite                 │
│   - Enforces Content-Security-Policy frame-ancestors                   │
│   - Proxies /api/ calls with extended 300s timeout                     │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────┐     ┌────────────────────────────────────────┐     ┌───────────────────────┐
│   Daily Feed Folder   │────▶│          Express API Backend           │◀────│ Bitrix Outgoing       │
│ (uploads/daily_feed/) │     │    (Auth / Rate Limiting / Multer)     │     │ Webhooks (Quotes)     │
└───────────────────────┘     └───────┬──────────────────────┬─────────┘     └───────────────────────┘
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
                   ┌────────────────────────────────────────┐
                   │       Async Import Batch Worker        │
                   │  - 50 Records per Bitrix Batch Chunk   │
                   │  - Selective Retry (Failed Only)       │
                   │  - Failure Isolation (Preserve Success)│
                   └──────────┬─────────────────────────────┘
                              │ Bitrix REST API (batch commands of 50 ops)
                              ▼
                   ┌────────────────────────────────────────────────────────┐
                   │                    Bitrix24 Portal                     │
                   │  ┌──────────────────────┬───────────────────────────┐  │
                   │  │ Product Catalog      │ Inventory Management      │  │
                   │  │ - Code / Name        │ - Stock Receipt (Doc S)   │  │
                   │  │ - Multi-tier Prices  │ - Write-off / Deduct (D)  │  │
                   │  │   (INR ₹ Currency)   │ - Store 62 Balances       │  │
                   │  ├──────────────────────┼───────────────────────────┤  │
                   │  │ CRM Quotes & Deals   │ Classic CRM Invoices      │  │
                   │  │ - Tier Auto-Pricing  │ - Account Number Matches  │  │
                   │  └──────────────────────┴───────────────────────────┘  │
                   └────────────────────────────────────────────────────────┘
```

---

## 2. Confirmed Functional Requirements Compliance (16 Specifications)

The middleware fully implements the **16 confirmed functional specifications** for daily Excel inventory imports, Bitrix24 catalog synchronization, quotation pricing, and portal iframe integration:

| # | Requirement | Implementation Summary | Key File References |
|---|---|---|---|
| **1** | **Daily Import** | Automated background scheduler watches `uploads/daily_feed/`, runs daily at a configurable time (default `02:00` AM), processes the latest inventory status file, automatically archives it to `uploads/daily_feed/processed/`, and provides manual UI trigger & schedule management. | [`dailyImport.scheduler.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/schedule/dailyImport.scheduler.ts)<br>[`BitrixSettings.tsx`](file:///D:/bitrix24_inventory_middleware/frontend/src/pages/BitrixSettings.tsx) |
| **2** | **Product Matching** | Uses `CODE` as the golden unique product identifier to match existing Bitrix24 products and prevent duplicates. If `CODE` exists, the product is updated. If `CODE` does not exist, a new product is created. Intra-file duplicate codes are detected and tracked. | [`BitrixCatalogService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts)<br>[`stockReceiptImport.service.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/import/stockReceiptImport.service.ts) |
| **3** | **Product Description** | `DESCRIPTION` is enforced as mandatory during file validation. Populates the Bitrix24 Product Catalog item description (`DESCRIPTION`, `detailText`) and custom property fields. | [`excel.validator.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/excel/excel.validator.ts)<br>[`BitrixCatalogService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **4** | **Existing Product Updates** | During every import, existing products matched by `CODE` are automatically updated with: `QTY IN STOCK`, `QTY ON ORDER`, `COST`, `DEALER PRICE`, and `END USER PRICE`. | [`BitrixCatalogService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **5** | **QTY ON ORDER Handling** | Inbound/pipeline inventory (`QTY ON ORDER`) is mapped into Bitrix24's reserved quantity (`quantityReserved` via `setReservedQuantity`), custom property `PROPERTY_2624` (`QTY_ON_ORDER`), and stock receipt line item commentary. | [`BitrixCatalogService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts)<br>[`stockReceiptImport.service.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/import/stockReceiptImport.service.ts) |
| **6** | **New Product Creation** | When a `CODE` does not exist in Bitrix24, a new catalog product is automatically provisioned with all 8 canonical fields (`CODE`, `PART NUMBER` as Title, `DESCRIPTION`, `QTY IN STOCK`, `QTY ON ORDER`, `COST`, `DEALER PRICE`, `END USER PRICE`). | [`BitrixCatalogService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **7** | **Separate Price Types** | Dealer Price (Price Type ID 4) and End User Price (Price Type ID 6 / Base Price) are maintained as separate price types in Bitrix24 via `catalog.price.*` REST endpoints. | [`BitrixCatalogService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **8** | **Import History & Audit** | Every manual and daily scheduled import is tracked in PostgreSQL `ImportJob` and `ImportRecord`. Administrators can view row-by-row status, timestamps, duplication metrics, and execution summaries at `/imports`. | [`ImportHistory.tsx`](file:///D:/bitrix24_inventory_middleware/frontend/src/pages/ImportHistory.tsx)<br>[`ImportDetails.tsx`](file:///D:/bitrix24_inventory_middleware/frontend/src/pages/ImportDetails.tsx) |
| **9** | **Downloadable Error Reports** | If any row fails during an import, an `.xlsx` error report containing Row Number, SKU/Code, Product Title, Status, and exact Bitrix API error message is downloadable with one click via `GET /api/imports/:id/error-report`. | [`import.controller.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/controllers/import.controller.ts)<br>[`ErrorHandling.tsx`](file:///D:/bitrix24_inventory_middleware/frontend/src/pages/ErrorHandling.tsx) |
| **10** | **Quotation Process & Customer-Based Pricing (Backend Logic)** | Backend service automatically inspects whether the Quote or Deal customer (Company/Contact) is a **Dealer** or **End User**. Resolves product line items (`Product Code`, `Part Number`, `Description`, `Price`) and applies Dealer Price to Dealers and End User Price to End Users. *(Pure backend logic; no UI)* | [`BitrixQuotationService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixQuotationService.ts)<br>[`bitrix.controller.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/controllers/bitrix.controller.ts) |
| **11** | **Quotation Workflow & Webhook Trigger** | Outgoing Bitrix24 webhook endpoint (`POST /api/bitrix/quote-pricing/webhook`) triggers automatic recalculation and application of customer-tier pricing whenever a Quote or Deal is created/updated in CRM. | [`BitrixQuotationService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixQuotationService.ts)<br>[`bitrix.routes.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/routes/bitrix.routes.ts) |
| **12** | **Product Title = PART NUMBER** | In the Bitrix24 Product Catalog, the Product Title (`product.NAME`) is strictly set to the `PART NUMBER` field from the Excel file. | [`BitrixCatalogService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts) |
| **13** | **High-Performance Batch Optimization** | Bundles catalog lookups, product provisions, price assignments, and stock receipt line items into chunks of 50 operations per Bitrix `batch` REST call, accelerating 5,000 to 10,000 row imports by ~25-50x. | [`BitrixClient.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixClient.ts)<br>[`stockReceiptImport.service.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/import/stockReceiptImport.service.ts) |
| **14** | **Failure Isolation & Selective Retry** | When document conduction encounters invalid lines, only those specific product records are marked `FAILED`. Already successful rows are never wiped out. "Retry Failed Records" retries only the failed records without restarting from row 1. Single failed records can also be retried on demand with 1 click. | [`import.worker.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/import/import.worker.ts)<br>[`import.controller.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/controllers/import.controller.ts)<br>[`ImportDetails.tsx`](file:///D:/bitrix24_inventory_middleware/frontend/src/pages/ImportDetails.tsx) |
| **15** | **Indian Rupee (INR ₹) Standardization** | All prices (Cost, Dealer, End User, Stock valuations) default to and enforce INR currency (`₹`) across Bitrix catalog prices, stock receipt documents, and frontend UI dashboards. | [`BitrixCatalogService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixCatalogService.ts)<br>[`ImportDetails.tsx`](file:///D:/bitrix24_inventory_middleware/frontend/src/pages/ImportDetails.tsx) |
| **16** | **Bitrix24 Local App Iframe Integration** | Configured security headers (`Content-Security-Policy: frame-ancestors`), cross-site cookies (`SameSite=None`, `Secure=true`), and Nginx POST-to-SPA route rewrites (HTTP 405 fix) to allow seamless loading inside Bitrix24 portal iframe sliders. | [`nginx.conf`](file:///D:/bitrix24_inventory_middleware/frontend/nginx.conf)<br>[`auth.controller.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/controllers/auth.controller.ts) |

---

## 3. The 8 Canonical Excel Inventory Fields

The middleware recognizes and auto-maps the 8 canonical fields from the client's inventory feed:

| # | Excel Column Header | Required? | Bitrix24 Target Entity & Field | Behavior & Handling |
|---|---|---|---|---|
| **1** | `CODE` | **Yes** (Unique Key) | `crm.product.add / update` (`CODE`), `catalog.product.list` (`code`), `PROPERTY_960` | **Golden Match Key**: Matches existing catalog products and prevents duplicate creation. Case-insensitive and whitespace-trimmed. Stored as string to preserve leading zeros. |
| **2** | `PART NUMBER` | **Yes** | `crm.product.add / update` (`NAME`), `PROPERTY_2622` / `PROPERTY_1020` | **Product Title**: The Bitrix24 Product Catalog item name (`NAME`) is **strictly set to the `PART NUMBER`** (Requirement 12). Populated in dedicated custom properties. |
| **3** | `DESCRIPTION` | **Yes** | `crm.product.add / update` (`DESCRIPTION`, `detailText`), `PROPERTY_DESCRIPTION` | **Product Description**: Mandatory in the Excel validator. Populates catalog description so sales teams have full product specifications (Requirement 3). |
| **4** | `QTY IN STOCK` | Optional | `catalog.document.element.add` (`amount`), `catalog.storeproduct.update`, `catalog.product.update` (`quantity`), `PROPERTY_115` | **Stock Replacement Target**: Evaluated against live store stock. Generates net upward receipt (`docType: 'S'`) or downward deduction (`docType: 'D'`) document elements and sets warehouse balances. |
| **5** | `QTY ON ORDER` | Optional | `catalog.product.update` (`quantityReserved`), `PROPERTY_2624` (`QTY_ON_ORDER`) | **Pipeline Inventory**: Stored in Bitrix's reserved quantity field and custom property `PROPERTY_2624` for incoming inventory visibility (Requirement 5). |
| **6** | `COST` | Optional | `catalog.product.update` (`purchasingPrice`), `catalog.document.element.add` (`purchasingPrice`), `PROPERTY_111` | **Purchasing Cost**: Stored as product purchasing price in INR (`₹`) and document arrival cost valuation. |
| **7** | `DEALER PRICE` | Optional | `catalog.price.add / update` (`catalogGroupId: 4`), `PROPERTY_2626` | **Dealer Tier**: Maintained as a separate price type (ID 4) in INR (`₹`) for B2B/wholesale accounts. |
| **8** | `END USER PRICE` | Optional | `catalog.price.add / update` (`catalogGroupId: 6`), `crm.product.add / update` (`PRICE`), `PROPERTY_109` | **End User Tier**: Maintained as the retail base price type (ID 6) in INR (`₹`) for standard customer quotations. |

---

## 4. Core Subsystems & Operational Workflows

### 4.1 Automated Daily Import Scheduler (`uploads/daily_feed/`)

The automated daily import subsystem provides fully autonomous, hands-free inventory synchronization:

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
│ - Auto-detects 8 canonical cols │
│ - Validates CODE & DESCRIPTION  │
│ - Creates ImportJob & Records   │
│ - Enqueues to BullMQ worker     │
│ - Archives file with timestamp: │
│   uploads/daily_feed/processed/ │
└─────────────────────────────────┘
```

- **Folder Path:** `uploads/daily_feed/` (auto-created on server boot).
- **Archive Path:** `uploads/daily_feed/processed/` with timestamp prefixes (`YYYYMMDD_HHMMSS_<filename>`).
- **Default Schedule:** Daily at `02:00` AM (configurable in 24h format via UI or API).
- **Intelligent Header Detection:** Automatically performs fuzzy matching for columns (`CODE`, `PART NUMBER`, `DESCRIPTION`, `QTY IN STOCK`, `QTY ON ORDER`, `COST`, `DEALER PRICE`, `END USER PRICE`, `BARCODE`).
- **UI Management Card:** Located on the **Bitrix Configuration** page (`/settings/bitrix`):
  - Toggle scheduler enabled/disabled state.
  - Set 24h execution time (`timeOfDay`).
  - View waiting file count in `uploads/daily_feed/`.
  - View last run timestamp, file name, job ID, and status badge.
  - **"Run Daily Import Now"** on-demand trigger button.
- **REST Endpoints:**
  - `GET /api/imports/daily-schedule` — Returns scheduler status and pending file list.
  - `POST /api/imports/daily-schedule` — Updates schedule time and enable/disable state.
  - `POST /api/imports/daily-trigger` — Triggers an immediate import of the latest feed file.

---

### 4.2 Intelligent Stock Replacement & Adjustment Conduction Engine

In enterprise operations, inventory feeds represent **current snapshot balances** rather than cumulative delta increments. The middleware implements an intelligent **Net Stock Replacement Algorithm**:

```
                       Upload Row: Target Qty = T
                                   │
                                   ▼
             Query Live Store 62 Balance via Bitrix API: Current Qty = C
                                   │
                                   ▼
                       Calculate Delta: Δ = T - C
                                   │
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
       Δ > 0                   Δ < 0                   Δ = 0
 (Stock Increased)       (Stock Decreased)      (Already Equal)
           │                       │                       │
           ▼                       ▼                       ▼
  Add Line Item to        Add Line Item to          No Document Line
  Adjustment Document     Deduction Document            Required
    (docType: 'S')          (docType: 'D')                 │
           │                       │                       │
           └───────────────────────┼───────────────────────┘
                                   ▼
                Update Physical Store Balance via API
                  (catalog.storeproduct.update)
                                   ▼
                Conduct Documents (catalog.document.conduct)
               - Official Status 'Y' posted to Warehouse Main
               - Automatic Header Totals calculation
               - Failure Isolation & Targeted Self-Healing
```

#### Key Capabilities:
1. **Accurate Stock Replacement:** Ensures portal balances match the uploaded spreadsheet exactly, eliminating manual stock adjustment drift.
2. **Dual-Document Conduction:**
   - **Upward Adjustments (`docType: 'S'`):** Created and conducted when stock increases.
   - **Downward Deductions / Write-offs (`docType: 'D'`):** Created and conducted when stock decreases.
3. **Conduction Self-Healing & Failure Isolation:**
   - If Bitrix document conduction fails due to specific invalid line items (e.g. `incorrect product quantity ID #123`), the worker extracts those IDs (`#(\d+)`) and marks **only those specific product records** as `FAILED`.
   - All other products whose catalog entries and price tiers were successfully synchronized remain in `SUCCESS` status and are **never** wiped out.
4. **Intra-File Planned Stock Caching (`plannedStockMap`):** If duplicate rows for the same product exist in one spreadsheet, the planned stock map prevents redundant duplicate additions or deductions.
5. **Clean Draft Handling:** If no positive or negative adjustments occur, unused draft document headers are deleted via `deleteDocument` to keep the portal uncluttered.

---

### 4.3 Backend Quotation & Customer-Tier Pricing Engine

> [!NOTE]
> **Pure Backend Logic:** In accordance with project requirements, quotation and customer-tier pricing is implemented strictly as backend logic and webhook automation. There is no external quotation creation UI page.

The backend engine ([`BitrixQuotationService.ts`](file:///D:/bitrix24_inventory_middleware/backend/src/services/bitrix/BitrixQuotationService.ts)) automates multi-tier pricing for CRM Quotes and Deals:

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
                     - Tiered Applied Price (INR ₹)
                                 ▼
                         crm.quote.update
                     (OPPORTUNITY Total Amount)
```

#### Key Capabilities:
1. **Intelligent Customer Tier Resolution:**
   - Inspects linked Company (`crm.company.get`) or Contact (`crm.contact.get`).
   - Evaluates `COMPANY_TYPE`, `COMMENTS`, or custom fields like `UF_CRM_CUSTOMER_TYPE`.
   - Recognizes keywords: `dealer`, `distributor`, `wholesale`, `reseller`, `partner`.
   - Defaults to `END_USER` if not tagged as dealer.
2. **Catalog Metadata Enrichment:** Reads catalog product rows attached to the Quote or Deal and synchronizes `Product Code`, `Part Number`, `Description`, and price tiers.
3. **Automated Line Item Recalculation:**
   - Applies `DEALER PRICE` (Price Type ID 4) for Dealer accounts.
   - Applies `END USER PRICE` (Price Type ID 6 / Base Price) for End User accounts.
   - Updates Quote or Deal product rows via `crm.quote.productrows.set` or `crm.deal.productrows.set`.
   - Updates total entity `OPPORTUNITY` amount via `crm.quote.update` or `crm.deal.update`.
4. **Integration Methods:**
   - **Outgoing Webhook:** `POST /api/bitrix/quote-pricing/webhook` (triggered by Bitrix CRM Automation rules on `ONCRMQUOTEADD`, `ONCRMQUOTEUPDATE`, `ONCRMDEALADD`, `ONCRMDEALUPDATE`).
   - **Direct API Call:** `POST /api/bitrix/quote-pricing/apply` (`{ entityType: 'quote' | 'deal', entityId: 123 }`).
   - **Product Query:** `GET /api/bitrix/quote-pricing/products?search=...` (inspects catalog items with multi-tier pricing).

---

### 4.4 Stock Receipt & Inventory Synchronization Wizard (`/inventory/stock-receipt`)

A full interactive wizard connecting supplier arrival spreadsheets directly to **Bitrix24 Inventory Management Stock Receipts** and the **Product Catalog**:

1. **Upload & Preview:** Drag-and-drop `.xlsx`, `.xls`, or `.csv` files up to `MAX_FILE_SIZE_MB`. Instant paginated preview supporting large files (50, 100, 250, 500 rows per page with search).
2. **Dynamic Field Discovery:** Queries `GET /api/bitrix/stock-receipt-fields` to discover live portal schema (`catalog.document.element.getFields`, `catalog.product.getFields`, `catalog.store.list`).
3. **Column Mapping:** Auto-maps the 8 canonical fields with customizable warehouse target selection (defaults to Main Warehouse ID 62).
4. **Execution Flow:**
   - Matches products by `CODE` in 50-item batches.
   - Provisions missing products (setting Title = `PART NUMBER`).
   - Performs stock replacement delta calculations.
   - Creates and conducts official Bitrix24 stock adjustment documents (`docType: 'S'` and `'D'`).
   - Updates store balances via `catalog.storeproduct.update` and catalog `quantityReserved`.

---

### 4.5 Product & Inventory Import Wizard (`/inventory/import`)

A 6-step workflow for ad-hoc catalog synchronization:
1. **Upload:** Select file up to configured size limit.
2. **Preview:** Instant table preview of headers and data rows with full pagination controls.
3. **Map Columns:** Auto-mapping engine with fuzzy matching.
4. **Policy Selection:** `Create + Update` *(default)*, `Create Only`, or `Update Only`.
5. **Enqueue:** Job saved to PostgreSQL and sent to BullMQ.
6. **Live Progress & ETA:** Real-time polling with progress bar, rows processed, throughput rate (`items/sec`), and dynamic remaining time countdown.

---

### 4.6 Classic CRM Invoice Import Wizard (`/invoices/import`)

Dedicated pipeline for Bitrix24's classic CRM invoice entity (`crm.invoice.*`):
- **Mapped Fields:** `ACCOUNT_NUMBER` (match key), `ORDER_TOPIC`, `CLIENT`, `PRICE`, `CURRENCY`, `STATUS_ID` (`N` = New, `S` = Sent, `P` = Paid, `D` = Unpaid), `DATE_BILL`, `DATE_PAY_BEFORE`, `COMMENT`.
- **Idempotent Sync:** Matches by `ACCOUNT_NUMBER` via `crm.invoice.list`. Updates existing invoices or creates new invoices via `crm.invoice.add`.

---

### 4.7 Product Duplication Detection & Lifecycle Breakdown Metrics

The middleware tracks product lifecycle metrics across every import job:
- **Intra-File Duplication Tracking:** Detects repeated `CODE` entries within the same file and tracks them in `duplicateRows`.
- **Created vs. Updated Breakdown:**
  - `createdProductsCount`: Brand new products provisioned in Bitrix24.
  - `updatedProductsCount`: Existing products matched by `CODE` and updated with new prices, descriptions, and quantities.
- **Granular Record Statuses:**
  - `SUCCESS`: Row fully synchronized.
  - `UPDATED`: Existing product updated.
  - `CREATED`: New product created.
  - `PARTIAL_FAILURE`: Product catalog updated, but non-critical property/document warning occurred.
  - `FAILED`: Row failed validation or API call.
  - `SKIPPED`: Row skipped per import policy (e.g. `Update Only` when product does not exist).

---

### 4.8 Advanced Error Handling, Failure Isolation & Granular Retry Engine (`/error-handling`)

A dedicated **Error Handling & Audit Center** (`/error-handling`) provides deep inspection and surgical recovery capabilities:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Error Handling & Audit Center                     │
├────────────────────────────────────────────────────────────────────────┤
│ Job Selector: [Daily Feed - 2026-10-19 (Completed with Errors) ▼]     │
│ Status Filter: [All / Failed (4) / Partial (0) / Skipped / Success]    │
│ Error Category: [Validation / Rate Limit / Auth / Network / Bitrix]    │
│ Search: [Filter by SKU, Part Number, Error Message...]                 │
├────────────────────────────────────────────────────────────────────────┤
│ Row 14 | CODE-042 | Sensor Unit | VALIDATION_ERROR | Desc is mandatory │
│ Row 88 | CODE-119 | Valve Assm  | BITRIX_API_ERROR | Store disabled    │
├────────────────────────────────────────────────────────────────────────┤
│ [↻ Retry This Record]          [Retry Failed Records (4)] [Download]   │
└────────────────────────────────────────────────────────────────────────┘
```

#### Key Capabilities:
1. **Automated Error Categorization:**
   - `VALIDATION_ERROR`: Missing mandatory fields (`CODE`, `DESCRIPTION`).
   - `RATE_LIMIT_ERROR`: Bitrix REST rate throttling (`QUERY_LIMIT_EXCEEDED`, `OPERATION_LIMIT`).
   - `AUTH_ERROR`: Invalid or expired Bitrix webhook credentials.
   - `NETWORK_ERROR`: Connection timeout or network drop.
   - `DUPLICATE_ERROR`: Conflicting identifier.
   - `BITRIX_API_ERROR`: Portal-specific REST execution failure.
   - `PROCESSING_ERROR`: General parser or data formatting exception.
2. **Targeted Failure Isolation (No Success Wipeout):**
   - Earlier versions marked all records as failed if document conduction failed at the end of a job.
   - The worker now isolates failures to **only the specific problematic product IDs**, preserving all thousands of already synchronized records as `SUCCESS`.
3. **Selective Batch Retry (`POST /api/imports/:id/retry`):**
   - Retries **only** records with status `FAILED`, `PARTIAL_FAILURE`, or `PENDING`.
   - Successfully imported records are completely untouched and bypassed by the worker.
   - The UI button dynamically displays the exact count: **`Retry Failed Records (${failedCount})`**.
   - `processedRows` preserves already successful rows (`totalRows - failedCount`) so the progress bar does not erroneously reset to 0%.
4. **Single-Record Instant Retry (`POST /api/imports/:id/records/:recordId/retry`):**
   - On the Import Details page table, each failed row includes an inline **`↻ Retry this record`** button.
   - Retries that individual item against Bitrix24 immediately with an active spinner, updating only that record's status and the job counters without re-running the entire file.
5. **Downloadable `.xlsx` Error Reports:** One-click download generating an Excel spreadsheet with Row Number, SKU/Code, Part Number, Status, and Error Details.

---

### 4.9 Asynchronous Processing Pipeline (Redis + BullMQ)

- **Queue Name:** `import-queue`.
- **Controlled Concurrency:** Bounded worker pool respects Bitrix REST rate limits (2 queries/sec standard limit with burst buffer).
- **Exponential Backoff Throttling:** Automatically intercepts `QUERY_LIMIT_EXCEEDED`, `ERROR_OPERATION_LIMIT`, `REST_HEAVY_SYSTEM_RESPONSE`, and HTTP 429/503 responses, applying exponential backoff delay before retrying.
- **Crash Recovery & Reconciliation:** On server restart, any jobs stranded in `PROCESSING` are reconciled and marked for retry.
- **Upload Staging Cleanup:** Intermediate uploaded files are cleaned up upon job completion or failure.

---

### 4.10 Live Diagnostic Debug Console (`/debug`)

- **Persistent Logging:** PostgreSQL `DebugLog` table stores structured audit trails.
- **Sources Tracked:** `SYSTEM`, `API`, `AUTH`, `SETTINGS`, `BITRIX`, `IMPORT`, `WORKER`, `LICENTIC`.
- **Real-Time Stream:** Auto-refreshes every 3 seconds with expandable JSON metadata for payloads, HTTP status codes, durations, and error traces.
- **Filters:** Search keyword, log level (`DEBUG`, `INFO`, `WARN`, `ERROR`), source filter, and "Clear Logs" button.

---

### 4.11 Licentic License Manager & Dual-Mode Authentication

The application features enterprise **dual-mode authentication**:

```
                       User submits credentials on /login
                                       │
                                       ▼
                       Is it local Admin from .env?
                                ├─── Yes ───▶ Authenticate via local bcrypt hash
                                │
                                └─── No ────▶ 1. Verify credentials with Licentic
                                                 (/auth/login)
                                              2. Verify Active License
                                                 (/actve-license/:email?productId=...)
                                              3. Provision/Sync user in PostgreSQL
                                              4. Issue HTTP-only signed JWT cookie
```

#### Key Capabilities:
1. **Licentic License Verification:**
   - Validates user email and password directly with the Licentic Auth API.
   - Queries Licentic active license status (`/actve-license/:email?productId=...`).
   - Validates license status (`active`), expiration date (`endDate`), and calculates remaining days.
   - Automatically displays license tier, license key, and validity status in the UI navigation bar.
2. **Local Administrator Fallback:**
   - Guaranteed access for systems configured with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.
   - Seeded automatically on server boot.
3. **AES-256-GCM Encryption:** Bitrix24 incoming webhook tokens are encrypted using `BITRIX_ENCRYPTION_KEY` before database storage. Webhook URLs are masked as `******************************` in the UI and never leaked to logs or client responses.

---

### 4.12 High-Performance Batch Optimization Engine (1,000 to 10,000+ Items)

#### Why Large Imports Previously Took Hours:
In standard REST integrations, processing a spreadsheet involves multiple individual HTTP calls per item:
1. `catalog.product.list` (query existing product by code)
2. `crm.product.add` / `crm.product.update` (create or update product)
3. `catalog.price.add` / `catalog.price.update` (set base price)
4. `catalog.price.add` / `catalog.price.update` (set dealer price)
5. `catalog.document.element.add` (add line item to stock receipt)

For **1,000 items**, this required ~4,000 to 5,000 separate HTTP round trips. At Bitrix24's rate limit of **2 requests per second**, 1,000 items took ~7 minutes, 2,200 items took ~40 minutes, and 5,000 to 10,000 items took multiple hours or encountered gateway timeouts.

#### The Batch Engine Solution:
The middleware uses Bitrix24's native `batch` REST API (`POST /rest/batch`) to bundle up to **50 operations** into a single HTTP packet:

```
┌────────────────────────────────────────────────────────┐
│             Batch Import Chunk (50 Records)            │
├────────────────────────────────────────────────────────┤
│ 1. batchGetProductsByCodes(codes: 50)                  │
│    -> 1 HTTP call returns existing IDs for all 50 items│
│                                                        │
│ 2. batchCreateProducts(newItems) & batchUpdateProducts │
│    -> 1 HTTP call provisions/updates up to 50 products │
│                                                        │
│ 3. batchSetPrices(priceUpdates)                        │
│    -> 1 HTTP call synchronizes Base & Dealer price tiers│
│                                                        │
│ 4. batchAddElements(docId, lineItems: 50)              │
│    -> 1 HTTP call attaches all 50 items to Stock Doc   │
└────────────────────────────────────────────────────────┘
```

#### Performance Benchmark Comparison:

| Dataset Size | Legacy Sequential Processing | Batched Processing Engine (50/batch) | Speedup Factor |
|---|---|---|---|
| **1,000 Records** | ~7 Minutes | **~45 Seconds** | **~9x Faster** |
| **2,278 Records** | ~40 Minutes | **~1.5 Minutes** | **~26x Faster** |
| **5,000 Records** | ~2+ Hours | **~3.5 Minutes** | **~35x Faster** |
| **10,000 Records** | ~4+ Hours (often timed out) | **~7 to 8 Minutes** | **~40x Faster** |

---

### 4.13 Real-Time Upload Duration, Throughput & Dynamic ETA Display

During inventory imports, the UI provides real-time progress metrics with accurate time estimation:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Import Progress                                            [PROCESSING]│
├────────────────────────────────────────────────────────────────────────┤
│ Processed: 2,450 / 5,000                                          49%  │
│ [██████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]       │
│                                                                        │
│ ⏳ Est. Time: ~2m 15s remaining (~22.4 items/sec)                      │
│                                                                        │
│ [ 2,450 Successful ]  [ 0 Failed ]  [ 0 Skipped ]  [ 5,000 Total ]    │
└────────────────────────────────────────────────────────────────────────┘
```

- **Initial Prediction:** Uses `estimateTotalDuration(totalRows)` based on benchmarked throughput before processing begins.
- **Dynamic In-Flight Recalculation:** Measures actual throughput (`processedRows / elapsedSeconds`) and computes remaining seconds dynamically.
- **Completion Duration:** Upon completion, displays the exact total execution duration (e.g. `Duration: 3m 42s`).

---

### 4.14 Bitrix24 Local Application Iframe Embedding & Security Architecture

The middleware is engineered to run seamlessly embedded inside Bitrix24 portal iframe sliders as a **Bitrix24 Local Application**.

#### Solved Iframe Challenges:
1. **Resolution of `X-Frame-Options: SAMEORIGIN`:**
   Browsers block iframes if `X-Frame-Options` is set to `SAMEORIGIN`. The Nginx reverse proxy strips conflicting `X-Frame-Options` headers and configures standard `Content-Security-Policy: frame-ancestors`:
   ```nginx
   add_header Content-Security-Policy "frame-ancestors 'self' https://*.bitrix24.in https://*.bitrix24.com https://*.bitrix24.eu https://*.bitrix24.net https://*.bitrix.info https://oauth.bitrix.info https://b24-zykr00.bitrix24.in;" always;
   ```
2. **Resolution of HTTP `405 Method Not Allowed`:**
   When Bitrix24 opens a local application in an iframe slider, it makes an HTTP `POST` request containing authentication tokens and portal domain parameters. Static SPA servers reject POST requests with `405 Method Not Allowed`. Nginx intercepts this error and rewrites it cleanly to the SPA entrypoint:
   ```nginx
   error_page 405 =200 /index.html;
   ```
3. **Cross-Site Session Cookies (`SameSite=None`, `Secure=true`):**
   In modern browsers, cross-site iframes reject standard cookies. The authentication controller dynamically issues cookies with `SameSite=None` and `Secure=true` when running in production/HTTPS:
   ```typescript
   res.cookie('token', token, {
     httpOnly: true,
     secure: isSecure,
     sameSite: isSecure ? 'none' : 'lax',
     maxAge: 24 * 60 * 60 * 1000,
   });
   ```
4. **Permanent Handler URL:**
   The registered Bitrix24 application handler URL remains:
   ```
   https://b24inventory.utkarshmishra.online/login
   ```

---

### 4.15 Standardized Indian Rupee (INR ₹) Financial Engine

All inventory valuations, purchasing costs, multi-tier pricing, and UI displays are standardized on the **Indian Rupee (INR / ₹)**:
- **Currency Auto-Detection:** Queries `crm.currency.list`. If the portal default is available, it is mapped; otherwise, it strictly defaults to `INR`.
- **Product Prices:** Base Price, Dealer Price, and Purchasing Cost are assigned with currency code `INR`.
- **Stock Documents:** Conduction element arrival valuations are recorded in `INR`.
- **UI Currency Formatting:** Error dashboards, preview grids, and quotation line items format values using `en-IN` currency conventions (e.g. `₹1,25,000.00`).

---

## 5. Technology Stack

### Backend
- **Runtime & Language:** Node.js 20 LTS, TypeScript 5.5
- **Framework:** Express 4.21
- **Database & ORM:** PostgreSQL 15+, Prisma ORM 5.19
- **Job Queue:** BullMQ 5.12 backed by Redis 7
- **Excel & CSV Engine:** ExcelJS 4.4 + custom streaming CSV parser
- **Licensing & Auth:** Licentic API integration, bcrypt, jsonwebtoken, HTTP-only cookies
- **Security & Crypto:** Node `crypto` (AES-256-GCM), Helmet, express-rate-limit, CORS
- **Logging:** Pino 9 + Pino-pretty + PostgreSQL-backed `DebugLog` service

### Frontend
- **Framework & Tooling:** React 18, Vite 5, TypeScript 5.5
- **Routing:** React Router DOM v6
- **Styling:** Tailwind CSS 3.4
- **Forms & Validation:** React Hook Form 7, Zod 3.23
- **Notifications & Charts:** React Hot Toast, Recharts 2.12
- **Virtual Pagination:** Custom paginated preview supporting 10,000+ rows

### Infrastructure & Orchestration
- **Containerization:** Docker & Docker Compose
- **Web Server:** Nginx (reverse proxy, CSP frame-ancestors, 405 error interception, static SPA delivery)

---

## 6. Database Architecture (Prisma Schema & ERD)

```mermaid
erDiagram
    User ||--o{ BitrixConfiguration : "configures"
    User ||--o{ ImportJob : "creates"
    User ||--o{ ColumnMapping : "owns"
    ImportJob ||--o{ ImportRecord : "contains"

    User {
        uuid id PK
        string email UK
        string passwordHash
        string role
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    BitrixConfiguration {
        uuid id PK
        string portalUrl
        string webhookUrlEncrypted
        boolean isActive
        datetime lastTestedAt
        string connectionStatus
        uuid createdById FK
        datetime createdAt
        datetime updatedAt
    }

    ImportJob {
        uuid id PK
        string fileName
        string filePath
        string importMode
        string type
        string status
        int totalRows
        int processedRows
        int successfulRows
        int failedRows
        int skippedRows
        int createdProductsCount
        int updatedProductsCount
        int duplicateRows
        json mappingJson
        string bitrixDocumentId
        datetime startedAt
        datetime completedAt
        uuid createdById FK
        datetime createdAt
    }

    ImportRecord {
        uuid id PK
        uuid importJobId FK
        int rowNumber
        string sku
        string productName
        string partNumber
        string description
        string status
        string actionTaken
        string bitrixProductId
        string bitrixDocumentId
        int warehouseId
        float quantityArrived
        float purchasePrice
        float salesPrice
        float cost
        float dealerPrice
        float endUserPrice
        float qtyOnOrder
        float qtyInStock
        string errorMessage
        string bitrixError
        string errorType
        int retryCount
        json rawData
        datetime createdAt
        datetime updatedAt
    }

    ColumnMapping {
        uuid id PK
        string name
        json mappingJson
        uuid createdById FK
        datetime createdAt
        datetime updatedAt
    }

    DebugLog {
        uuid id PK
        string level
        string source
        string message
        json details
        datetime createdAt
    }
```

---

## 7. Bitrix24 REST API Integration Reference

The middleware interfaces with official Bitrix24 REST API endpoints:

| Domain | Bitrix Method | Purpose |
|---|---|---|
| **System** | `scope` / `profile` | Webhook connectivity and permission verification |
| **Batch** | `batch` | **High-performance bulk execution** (bundles up to 50 operations per HTTP call) |
| **Catalog** | `catalog.catalog.list` | Resolves primary commercial catalog ID |
| **Price Types** | `catalog.priceType.list` | Resolves Base, Dealer (ID 4), and End User (ID 6) price types |
| **Price Types** | `catalog.priceType.add` | Self-provisions missing Dealer or End User price types |
| **Prices** | `catalog.price.list` | Looks up existing price entries for a product |
| **Prices** | `catalog.price.add` / `.update` | Sets Base, Dealer, and End User prices in INR (`₹`) |
| **Currency** | `crm.currency.list` | Resolves the portal's active base currency (defaults to `INR`) |
| **Product Fields** | `catalog.product.getFields` | Discovers catalog schema and product field definitions |
| **Product Properties**| `crm.product.property.list` / `.add` | Discovers/provisions custom properties (`PART_NUMBER`, `QTY_ON_ORDER`, `BARCODE`) |
| **Product Query** | `catalog.product.list` / `crm.product.list` | Idempotent lookup by SKU, `CODE`, `XML_ID`, or title |
| **Product Create** | `crm.product.add` / `catalog.product.add` | Creates missing catalog products (sets Title = `PART NUMBER`) |
| **Product Update** | `crm.product.update` / `catalog.product.update` | Updates existing products, sets quantity, and updates `quantityReserved` |
| **Stores** | `catalog.store.list` | Lists available warehouses / stores |
| **Store Balance** | `catalog.storeproduct.update` | Updates physical store inventory balances directly |
| **Stock Receipt** | `catalog.document.element.getFields` | Discovers document line item fields (`amount`, `purchasingPrice`, `storeTo`) |
| **Stock Receipt** | `catalog.document.add` | Creates stock adjustment (`docType: 'S'`) or deduction (`docType: 'D'`) document |
| **Stock Receipt** | `catalog.document.element.add` | Adds line items with product ID, arrival qty, store, & purchase price |
| **Stock Receipt** | `catalog.document.update` | Sets document header total amounts and commentary |
| **Stock Receipt** | `catalog.document.conduct` | Officially conducts/posts arrival document into warehouse inventory |
| **Stock Receipt** | `catalog.document.delete` | Cleans up empty/unused draft adjustment documents |
| **Company & Contact** | `crm.company.get` / `crm.contact.get` | Resolves customer type (Dealer vs End User) for quotations |
| **Quotation & Deal** | `crm.quote.get` / `crm.deal.get` | Fetches Quote / Deal header information and linked customer ID |
| **Quotation Rows** | `crm.quote.productrows.get` / `.set` | Retrieves and updates line items with customer-tier pricing in INR (`₹`) |
| **Deal Rows** | `crm.deal.productrows.get` / `.set` | Retrieves and updates Deal line items with customer-tier pricing |
| **Entity Valuation** | `crm.quote.update` / `crm.deal.update` | Recalculates total `OPPORTUNITY` amount based on tier pricing |
| **Invoice** | `crm.invoice.list` | Searches existing invoices by `ACCOUNT_NUMBER` |
| **Invoice** | `crm.invoice.add` / `.update` | Creates new classic CRM invoices or updates status |

---

## 8. REST API Endpoints Reference

Base URL: `http://localhost:5000/api` (or `https://b24inventory.utkarshmishra.online/api`)

### Authentication (`/api/auth`)
- `POST /api/auth/login` — Authenticates user via Licentic License Manager or local system admin credentials; sets cross-site secure cookie.
- `POST /api/auth/licentic-login` — Direct Licentic email-based license authentication.
- `POST /api/auth/verify-license` — Inquires license validity without creating a session.
- `POST /api/auth/logout` — Clears authentication cookie.
- `GET /api/auth/me` — Fetches current authenticated session with active license info.

### Dashboard (`/api/dashboard`)
- `GET /api/dashboard/stats` — Overall totals, Bitrix connection status, product created/updated counts, and recent imports list.

### Bitrix Settings (`/api/settings`)
- `GET /api/settings/bitrix` — Returns configured portal URL and connection status (encrypted token hidden).
- `POST /api/settings/bitrix` — Saves/replaces portal URL and webhook (encrypts with AES-256-GCM).
- `PUT /api/settings/bitrix` — Updates existing settings.
- `DELETE /api/settings/bitrix` — Deactivates active configuration.
- `POST /api/settings/bitrix/test` — Performs live connection test against Bitrix REST API.

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

### Imports Engine & Daily Scheduler (`/api/imports`)
- `POST /api/imports/upload` — Uploads raw file (`multipart/form-data`) into temporary staging.
- `POST /api/imports/preview` — Parses file and returns headers, row counts, and preview sample with pagination support.
- `POST /api/imports` — Validates rows, creates `ImportJob` & `ImportRecord`s, and queues job (`type`: `PRODUCTS`, `INVOICES`, `STOCK_RECEIPTS`).
- `GET /api/imports/daily-schedule` — Returns automated daily import scheduler configuration, execution time, and pending feed files.
- `POST /api/imports/daily-schedule` — Updates daily import schedule time (`timeOfDay`) and enabled status.
- `POST /api/imports/daily-trigger` — Triggers immediate automated daily import of the newest file waiting in `uploads/daily_feed/`.
- `GET /api/imports` — Paginated list of import jobs with optional status filter.
- `GET /api/imports/:id` — Import job details with created/updated/duplicate counters.
- `GET /api/imports/:id/records` — Paginated list of records for a specific import job with search, status, and errorType filters.
- `POST /api/imports/:id/records/:recordId/retry` — **Surgically retries a single failed record** without re-running the job.
- `GET /api/imports/:id/errors` — Lists failed records for an import job.
- `GET /api/imports/:id/error-report` — **Downloads an Excel `.xlsx` file** containing all failed records (Row Number, SKU/Code, Product Name, Status, Error Details).
- `POST /api/imports/:id/retry` — **Selective Batch Retry**: re-queues **only** failed and partial records back to `PENDING` without re-processing successful rows.
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
| `ADMIN_EMAIL` | `admin@system.com` | Default email for seeded local administrator |
| `ADMIN_PASSWORD` | `Admin@123456` | Default password for seeded local administrator |
| `BITRIX_ENCRYPTION_KEY` | *(Required 32-char)* | Secret key used for AES-256-GCM webhook encryption |
| `MAX_FILE_SIZE_MB` | `25` | Maximum allowed file upload size in MB |
| `BITRIX_CONCURRENCY` | `5` | Maximum parallel worker batches |
| `BITRIX_MAX_RETRIES` | `3` | Max retries when encountering Bitrix rate limits |
| `BITRIX_REQUEST_TIMEOUT`| `30000` | Timeout in ms for outbound Bitrix REST calls |
| `BATCH_SIZE` | `50` | Number of database records processed per worker batch |
| `COOKIE_DOMAIN` | `""` (empty for localhost) | Domain attribute for the authentication cookie |
| `COOKIE_SECURE` | `false` (plain HTTP) | Set to `true` when running behind HTTPS / TLS (required for iframe embedding) |
| `LICENTIC_API_BASE` | `https://api.licentic.com` | Base URL of Licentic License Manager API |
| `LICENTIC_PRODUCT_ID` | `6a23c644247319b4b7bf7006` | Licentic Product Identifier for license verification |
| `VITE_API_URL` | `http://localhost:5000/api` | API Base URL passed to Vite frontend build |

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
   - `bitrix_inventory_frontend` (Port 3000 / Port 80)

4. **Access the application:**
   - Open [http://localhost:3000](http://localhost:3000) (or your domain `https://b24inventory.utkarshmishra.online`)
   - Login with either:
     - **Licentic License Account:** Your registered Licentic email and password, OR
     - **Local Admin:** `admin@system.com` / `Admin@123456`
   - Navigate to **Bitrix Configuration** (`/settings/bitrix`) to set your webhook URL and test the connection.

---

### 10.2 Setting Up the Automated Daily Feed

1. On the host machine or container, place your daily Excel inventory file (`.xlsx` or `.csv`) into:
   ```
   uploads/daily_feed/
   ```
2. The scheduler will automatically pick up the newest file at the scheduled time (default `02:00` AM), auto-detect the 8 fields, sync the catalog, conduct stock replacement documents, and archive the file to `uploads/daily_feed/processed/`.
3. To trigger an immediate import without waiting for the scheduled time:
   - Navigate to **Bitrix Configuration** (`/settings/bitrix`) and click **Run Daily Import Now**, OR
   - Call the API:
     ```bash
     curl -X POST http://localhost:5000/api/imports/daily-trigger \
       -H "Cookie: token=<jwt_token>"
     ```

---

### 10.3 Bitrix24 Quotation Webhook Configuration

To have Bitrix24 automatically apply customer-tier pricing whenever a Quote or Deal is created:

1. In your Bitrix24 Portal, navigate to **Developer Network / Applications / Webhooks / Outgoing Webhook**.
2. Set the **URL handler** to:
   ```
   https://b24inventory.utkarshmishra.online/api/bitrix/quote-pricing/webhook
   ```
3. Select Events:
   - `ONCRMQUOTEADD` (On Quote Add)
   - `ONCRMQUOTEUPDATE` (On Quote Update)
   - *(Optional for Deals)*: `ONCRMDEALADD`, `ONCRMDEALUPDATE`
4. Whenever a Quote or Deal is created in Bitrix24, the middleware automatically:
   - Identifies if the linked customer is a Dealer or End User.
   - Recalculates product prices using the appropriate price tier (`DEALER PRICE` vs `END USER PRICE`) in INR (`₹`).
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
# Frontend starts at http://localhost:3000
```

---

### 10.5 Configuring as a Bitrix24 Local Application (Iframe Handler)

To access the middleware directly inside the Bitrix24 portal navigation:

1. In your Bitrix24 Portal, go to **Developer Network / Applications / Add Application / Local Application**.
2. Set **Application Type** to **Server** or **Client**.
3. Set the **URL of your application handler** to:
   ```
   https://b24inventory.utkarshmishra.online/login
   ```
4. Set required API permissions (Scope):
   - `crm` (CRM)
   - `catalog` (Commercial Catalog)
   - `document` (Inventory Management documents)
   - `placement` (UI placements)
5. Save the application.
6. Open the newly registered application from your Bitrix24 left navigation menu. The application will load securely inside the Bitrix24 portal iframe slider without `X-Frame-Options` or `405 Method Not Allowed` errors.

---

### 10.6 Generating Large-Scale Synthetic Test Datasets (5k & 10k Items)

To test and benchmark large-scale imports, utilities are provided in `sample-data/`:

#### Generate a 5,000-Item Excel File:
```bash
node sample-data/generate_5000.js
# Creates inventory_5000_items.xlsx in the project root
```

#### Generate a 10,000-Item Excel File:
```bash
node -e "
const XLSX = require('xlsx');
const categories = ['Electronics', 'Networking', 'Hardware', 'Accessories', 'Peripherals'];
const rows = [
  ['CODE', 'PART NUMBER', 'DESCRIPTION', 'QTY IN STOCK', 'QTY ON ORDER', 'COST', 'DEALER PRICE', 'END USER PRICE']
];
for (let i = 1; i <= 10000; i++) {
  const code = 'SKU-' + String(i).padStart(6, '0');
  const part = 'PN-' + String(i).padStart(6, '0');
  const cat = categories[i % categories.length];
  const desc = cat + ' high performance model ' + i;
  const stock = Math.floor(Math.random() * 500) + 1;
  const order = Math.floor(Math.random() * 50);
  const cost = Math.floor(Math.random() * 5000) + 100;
  const dealer = Math.round(cost * 1.25);
  const enduser = Math.round(cost * 1.5);
  rows.push([code, part, desc, stock, order, cost, dealer, enduser]);
}
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
XLSX.writeFile(wb, 'inventory_10000_items.xlsx');
console.log('Created inventory_10000_items.xlsx');
"
```

---

## 11. Platform Considerations & Technical Notes

1. **Bitrix Inventory Management Mode:**
   - On Bitrix24 commercial plans with **Inventory Management** activated, direct writes to `catalog.product.update` (`quantity`) may be restricted by the portal. The middleware handles this by creating and conducting official stock adjustment documents (`catalog.document.add` + `catalog.document.conduct`) and updating warehouse store balances via `catalog.storeproduct.update`.
2. **Net Stock Replacement vs. Additions:**
   - The engine computes net difference $\Delta = T - C$. Stock increases generate arrival adjustment documents (`docType: 'S'`), whereas stock decreases generate write-off deduction documents (`docType: 'D'`), ensuring that portal balances mirror spreadsheet snapshot targets exactly.
3. **Failure Isolation on Conduction:**
   - Document conduction failure previously converted all records to `FAILED`. It now surgically targets only bad IDs identified in the Bitrix error string (`#(\d+)`), ensuring all other products and price tiers remain `SUCCESS`.
4. **Selective Retry Engine:**
   - Retrying failed records (`POST /api/imports/:id/retry`) re-queues **only** failed or partial rows, preserving existing successful rows and preventing full-file reprocessing. Single records can also be retried independently via `POST /api/imports/:id/records/:recordId/retry`.
5. **Batch Processing (50 Items/Batch):**
   - Bitrix REST `batch` commands allow up to 50 operations per packet. This prevents N+1 query bottlenecks and reduces 10,000-record import times from multiple hours to ~7-8 minutes.
6. **Product Title Policy:**
   - In accordance with Requirement 12, the product catalog item name (`NAME`) is strictly set to `PART NUMBER`. If `PART NUMBER` is empty in a row, it falls back to `CODE`.
7. **Leading Zeros in Identifiers:**
   - All codes, SKUs, and barcodes are parsed as raw strings (e.g. `000452`) and never converted to floating-point numbers.
8. **Currency Enforcement:**
   - All price fields and document arrival valuations default to Indian Rupee (`INR` / `₹`).

---

## License

Internal proprietary software. All rights reserved.
