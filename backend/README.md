# Bitrix24 Inventory Middleware — Backend

High-performance Node.js / Express API server with TypeScript 5.5, Prisma ORM 5.19, PostgreSQL 15, Redis 7, BullMQ 5.12, and the official Bitrix24 REST API.

## Core Capabilities
- **High-Performance Batch Engine:** Processes up to 50 items per Bitrix `batch` REST request, allowing 5,000–10,000 items to sync in ~3–8 minutes.
- **Selective Retry & Failure Isolation:** Preserves successful records and re-queues only failed/partial records. Conduction failures isolate only bad elements without wiping out completed products.
- **Single-Record Instant Retry:** Dedicated endpoint (`POST /api/imports/:id/records/:recordId/retry`) to retry single items on demand.
- **Bitrix24 Iframe Compatibility:** Cross-site session cookies (`SameSite=None`, `Secure=true`) for seamless embedding inside Bitrix24 portal sliders.
- **Indian Rupee (INR ₹) Default:** Auto-detects or defaults to `INR` across prices, purchasing costs, and stock valuations.
- **Daily Automated Scheduler:** Watches `uploads/daily_feed/` and runs automated synchronization with file archiving.

## Quick Start

```bash
cp .env.example .env   # configure environment
npm install
npx prisma migrate dev
npm run build
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server with hot-reload (`ts-node-dev`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run production server from compiled `dist/` |
| `npm run worker` | Run standalone BullMQ import worker process |
| `npx prisma migrate dev` | Run database migrations (dev) |
| `npx prisma migrate deploy` | Apply pending migrations (production) |
| `npx prisma studio` | Open Prisma Studio browser GUI |
| `npx prisma db seed` | Seed local admin account (`admin@system.com`) |

## Key Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Description |
|---|---|
| `PORT` | Backend port (default `5000`) |
| `NODE_ENV` | `development` or `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string for BullMQ |
| `JWT_SECRET` | Secret key for signing JWT cookies |
| `BITRIX_ENCRYPTION_KEY` | 32-character key for AES-256-GCM webhook token encryption |
| `COOKIE_SECURE` | Set to `true` behind HTTPS/TLS for cross-site iframe embedding |
| `BATCH_SIZE` | Records per batch worker chunk (default `50`) |
| `BITRIX_CONCURRENCY` | Worker concurrency pool (default `5`) |
| `LICENTIC_API_BASE` | Licentic License Manager API base URL |
| `LICENTIC_PRODUCT_ID` | Licentic product identifier (`6a23c644247319b4b7bf7006`) |
