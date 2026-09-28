# Bitrix24 Automated Inventory & Catalog Middleware
## System Architecture & Solution Design Document

---

### 1. Executive Summary

The **Bitrix24 Inventory Middleware** is an enterprise-grade automation platform designed to bridge daily supplier/ERP Excel inventory data with **Bitrix24 CRM, Product Catalog, and Inventory Management**.

The solution eliminates manual data entry, prevents product duplication, enforces pricing consistency across customer segments (Dealer vs. End User), and conducts stock receipt documents automatically into Bitrix24 warehouses.

```mermaid
flowchart LR
    A[Excel Inventory Sheet\nDaily Stock & Price Feed] --> B[Middleware Web Portal\nUpload & Validation]
    B --> C[Asynchronous Processing\nBullMQ Queue + Worker]
    C --> D[(PostgreSQL\nAudit & History)]
    C --> E[Bitrix24 Cloud REST API]
    E --> F[Bitrix24 Product Catalog\nName, Code, Desc, Prices, Properties]
    E --> G[Bitrix24 Inventory Control\nConducted Stock Receipt on Warehouse]
    E --> H[CRM Deals & Quotations\nTiered Customer Pricing]
```

---

### 2. High-Level System Architecture

The middleware is structured into modular layers adhering to enterprise separation of concerns, high throughput, and fault tolerance:

```mermaid
graph TB
    subgraph ClientLayer["User Access Layer (Browser)"]
        UI["React 18 + Vite SPA\n- Drag-and-Drop Excel Uploader\n- Real-Time Progress Tracker\n- Detailed Import Audit & History\n- Downloadable Error Reports (.xlsx)"]
    end

    subgraph MiddlewareLayer["Middleware Processing Engine (Dockerized)"]
        API["Node.js / Express REST API\n- Authentication & RBAC\n- File Parsing & Schema Validation\n- Intelligent Header Detection"]
        
        REDIS[("Redis In-Memory Broker\n- Job Queues & Rate Limiting\n- Concurrency Management")]
        
        WORKER["Background Import Worker\n- Batch Row Processing\n- Bitrix Product Match & Merge\n- Document Generator & Conductor"]
        
        DB[("PostgreSQL Database\n- Import Jobs & Records\n- Encrypted Webhook Credentials\n- Failure Reason Tracking")]
    end

    subgraph BitrixLayer["Bitrix24 Cloud Platform"]
        CATALOG["Commercial Product Catalog\n(Iblock ID: 24)"]
        PRICING["Price Type Engine\n- Dealer Price (ID: 4)\n- End User Price (ID: 6)\n- Purchasing Cost"]
        INVENTORY["Inventory Management\n- Stock Receipt Documents\n- Warehouse Main (Store 62)"]
        CRM["CRM Deals & Quotes\nCustomer-Based Auto-Pricing"]
    end

    UI <-->|HTTP / REST| API
    API -->|Enqueue Jobs| REDIS
    REDIS -->|Dequeue & Process| WORKER
    API <-->|Prisma ORM| DB
    WORKER <-->|Audit Logging| DB
    WORKER -->|REST API Calls\nBatched & Rate-Limited| BitrixLayer
    BitrixLayer --> CATALOG
    BitrixLayer --> PRICING
    BitrixLayer --> INVENTORY
    BitrixLayer --> CRM
```

---

### 3. Detailed End-to-End Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Operations / User
    participant Frontend as Middleware Frontend
    participant Backend as Backend API
    participant Worker as BullMQ Worker
    participant DB as PostgreSQL
    participant Bitrix as Bitrix24 Cloud

    Admin->>Frontend: Uploads daily Excel file (.xlsx)
    Frontend->>Backend: POST /api/imports/upload
    Backend-->>Frontend: File received & staged
    Frontend->>Backend: POST /api/imports/preview
    Backend-->>Frontend: Auto-detected column mappings & preview (50 rows)
    Admin->>Frontend: Confirms and clicks "Start Import"
    Frontend->>Backend: POST /api/imports (creates job)
    Backend->>DB: Stores Job (Status: PENDING) & raw records
    Backend->>Worker: Enqueues Import Job to Redis
    Backend-->>Frontend: Job ID returned (Status: PROCESSING)

    Worker->>Bitrix: 1. Discovers/Ensures Properties & Price Types
    Worker->>Bitrix: 2. Creates Stock Receipt Document Header (docType: S)
    
    loop For Each Row in Excel
        Worker->>Worker: Validate Mandatory Fields (CODE, DESCRIPTION)
        Worker->>Bitrix: Query Product by CODE (crm.product.list)
        alt Product Found
            Worker->>Bitrix: Update Name, Desc, Properties, Prices
        else Product Not Found
            Worker->>Bitrix: Create New Product with all 8 fields
        end
        Worker->>Bitrix: Add line item to Stock Receipt Document
        Worker->>DB: Update Record status (SUCCESS / UPDATED / CREATED)
    end

    Worker->>Bitrix: Conduct Stock Receipt Document (catalog.document.conduct)
    Note over Worker,Bitrix: Stock is officially booked to Warehouse Main
    Worker->>DB: Update Job status (COMPLETED) with counts & metrics
    Frontend->>Backend: Polls /api/imports/:id
    Backend-->>Frontend: Real-time progress updates & final summary
```

---

### 4. Excel Field Alignment & Bitrix24 Mapping Specification

The middleware maps the 8 standard Excel columns into Bitrix24's core architecture so that all 8 fields are prominently visible and accessible across **both the Product Catalog and Inventory Management**:

| # | Excel Column Header | Target Bitrix24 Entity | Bitrix24 Technical Field | Visibility in Inventory Management | Visibility in Product Catalog |
|---|---------------------|------------------------|--------------------------|------------------------------------|-------------------------------|
| **1** | **`CODE`** | Unique Identifier & Display Title | `product.CODE` & `product.NAME` & `PROPERTY_960` | Formatted directly into `Product` column (`[PART NUMBER] \| [CODE] - [DESCRIPTION]`) & visible in Product slider | Dedicated `item code` column & Product details card |
| **2** | **`PART NUMBER`** | Product Title & Catalog Property | `product.NAME` & `PROPERTY_2622` / `PROPERTY_1020` | Formatted directly into `Product` column & visible in Product slider | Dedicated `Part Number` column & Product Title |
| **3** | **`DESCRIPTION`** | Product Description & Display Title | `product.DESCRIPTION` & `detailText` | Formatted directly into `Product` column & visible in Product slider | Dedicated `Detailed description` column |
| **4** | **`QTY IN STOCK`** | Inventory Balance & Document Quantity | `catalog.document.element.amount` & Store 62 Balance | Explicitly displayed in the `Quantity arrived` column & Warehouse Stock Balance | Dedicated `Stock Quantity` column |
| **5** | **`QTY ON ORDER`** | Pipeline Inventory Property | `PROPERTY_2624` (`QTY_ON_ORDER`) | Visible inside the Product slider & Document itemized commentary | Dedicated `Qty on Order` column |
| **6** | **`COST`** | Purchase / Cost Price | `catalog.document.element.purchasingPrice` & `purchasingPrice` | Explicitly displayed in the `Purchase price` column & line item `Total` | Dedicated `Cost` column & purchasing price |
| **7** | **`DEALER PRICE`** | Wholesale Commercial Price Type | `Price Type ID: 4` (`DEALER_PRICE`) & `PROPERTY_2626` | Visible inside the Product slider & Document itemized commentary | Dedicated `Dealer Price` column & Commercial Price Type |
| **8** | **`END USER PRICE`** | Retail Price Type & Base Catalog Price | `Price Type ID: 6` (`END_USER_PRICE`) & `PRICE` | Explicitly displayed in the `Sales price` column, Product slider & commentary | Dedicated `Retail price` & `End User Price` columns |

---

### 5. Core Capabilities & Business Value

#### A. Intelligent Self-Provisioning Schema
* When connected to Bitrix24, the middleware automatically inspects the catalog context.
* If required custom properties (`Part Number`, `Qty on Order`) or price types (`Dealer Price`, `End User Price`) do not exist, the middleware **automatically provisions them via REST API**. No manual setup in Bitrix24 is required.

#### B. Accurate Product Matching & Zero Duplication
* `CODE` serves as the golden product key.
* When re-importing the daily file, existing products are **seamlessly updated** without altering existing Bitrix IDs, CRM deal linkages, or historical sales data.
* New products are automatically created with complete metadata.

#### C. Official Bitrix24 Stock Receipt Conduction
* Unlike shallow scripts that attempt to write raw numbers to database fields, this solution follows Bitrix24's official inventory accounting workflow:
  1. Generates an adjustment / stock receipt document (`catalog.document.add`).
  2. Attaches line items with cost and arrival quantities for each item (`catalog.document.element.add`).
  3. Formally conducts the document (`catalog.document.conduct`, Status: `Y`) to post inventory balances to **Warehouse Main**.

#### D. Streamlined Quotation & Multi-Tier Pricing
* In Bitrix24 CRM (Deals, Quotes, Invoices), sales representatives simply pick products from the catalog.
* Depending on whether the customer is tagged as a **Dealer** or an **End User**, the appropriate price type is applied automatically or chosen from the price dropdown.

#### E. Complete Audit Trail & Error Management
* **Comprehensive Metrics:** Every import run tracks total rows, new products created, existing products updated, successful rows, failed rows, duplicate rows, timestamps, and operating user.
* **Downloadable Error Reports (.xlsx):** If any row fails validation (e.g. missing mandatory description), a formatted Excel sheet is generated specifying the exact row number, CODE, part number, and human-readable error reason.
* **One-Click Retry:** Users can retry failed records directly from the interface.

---

### 6. Technology Stack & Operational Specifications

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend UI** | React 18, TypeScript, TailwindCSS, Vite | Responsive, intuitive single-page web app |
| **Backend API** | Node.js (v20+), Express, TypeScript | REST endpoints, authentication, Excel parsing |
| **Queue & Worker** | BullMQ, Redis 7 (Alpine) | Non-blocking background worker, rate-limit throttling |
| **Database** | PostgreSQL 15, Prisma ORM | Relational persistence, audit history, encrypted credentials |
| **Excel Parser** | ExcelJS, XLSX stream parsing | Memory-efficient streaming of large spreadsheets |
| **Bitrix24 Integration** | Bitrix24 Cloud REST API | Webhook / OAuth integration with SSL/TLS encryption |
| **Deployment** | Docker & Docker Compose | Multi-container reproducible stack |
