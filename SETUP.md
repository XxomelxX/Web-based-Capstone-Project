# Sari-Sari POS — Full-Stack Setup Guide

This is a **full-stack Next.js app** — the frontend pages and backend API routes
(`app/api/**`) live in the same project. There is no separate server to run.

## What's already built
- Prisma schema covering all 13 modules (Users, Products, Categories, Transactions,
  TransactionItems, StockBatches, Customers, UtangEntries, UtangEntryItems,
  PaymentAllocations, Expenses, ItemLog, Settings)
- API routes: auth (NextAuth), products, categories, POS checkout (atomic),
  restock (atomic), low stock, orders/void (atomic), utang + payment (FIFO
  allocation), users (admin-only), settings, expenses, reports
- Role-based middleware (Admin vs Cashier route protection)
- Frontend pages — **all 13 modules built**: Login, Dashboard (live stats),
  POS (cart + checkout + receipt), Products, Categories, Low Stock (+ Restock
  modal), Orders (+ View/Void), Utang/Credit (+ Add Utang/Record Payment),
  Transaction Log, Item Log, Expenses, Reports, Users (admin-only), Settings
- Data-access layer in `lib/api/*.ts` — components never call the database directly
- Prisma pinned to v6.19.3 (Prisma 7 changed how DATABASE_URL is configured —
  stick with v6 unless you want to deal with `prisma.config.ts` + adapters)

## What you still need to do (can't be done in a sandboxed environment)
Prisma's engine binaries and Google Fonts couldn't be downloaded here because of
network restrictions — this has nothing to do with the code itself. On your own
machine, these steps will just work:

### 1. Get a PostgreSQL database (free)
Sign up at one of these and copy the connection string:
- https://neon.tech (recommended — serverless, generous free tier)
- https://supabase.com

### 2. Install dependencies
```bash
cd web-based
npm install
```

### 3. Configure environment variables
Copy `.env.example` to `.env` and fill in your real values:
```bash
cp .env.example .env
```
```env
DATABASE_URL="postgresql://your-real-connection-string-here"
NEXTAUTH_SECRET="run: openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"
```

### 4. Generate the Prisma client and create your tables
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5. Seed demo data (admin + cashier accounts, sample products)
```bash
npx prisma db seed
```
This creates:
- Admin: username `admin` / password `admin123`
- Cashier: username `cashier` / password `cashier123`
- 7 categories, 10 sample products

**Change these demo passwords before using this for anything real.**

### 6. Run it
```bash
npm run dev
```
Visit http://localhost:3000 — it redirects to `/login`.

### 7. Verify your data in a GUI (optional but handy)
```bash
npx prisma studio
```

## Local development database (embedded Postgres)

When the Neon pooler is unreachable from your network, `.env` points
`DATABASE_URL` at a **local embedded Postgres on port 5433**. It is not started
by `npm run dev` — start it yourself, or start both together:

```bash
npm run dev:all   # database first, then Next.js (recommended)
npm run dev:db    # database only (leave this terminal running)
```

- Data lives in `.local-pg-data/` (gitignored) so OS temp cleanup can't wipe it.
- If any API returns **503 "Database temporarily unavailable"** (the old console
  error was `Can't reach database server at localhost:5433`), the Postgres
  process died — stop `npm run dev` and run `npm run dev:all` again.
- The dashboard automatically falls back to the last saved report and shows the
  "cached data" banner while the database is down.

## If a page 404s
Every module listed above has both its API route AND its page built. If you
still see a 404 on one of these paths, it usually means you're running an
older extracted copy — re-extract this zip fresh over your project folder.

## Deploy to production (region-matched, verified)

The production pipeline is verified green as of 2026-10-18: `npm run build`
compiles with webpack, type-checks, prerenders every module shell as static, and
the `postbuild` step (`scripts/patch-sw.js`) ASSERTS the offline service-worker
contract (fallback document, /pos offline shell, `_rsc` coverage). A build fails
loudly if any of those offline rules regress — nothing extra is needed pre-deploy.

### Why region matters (biggest speed lever)
The production DB is Neon in AWS us-east-1. From outside that region each DB
round trip costs ~400-500 ms, which is why the API already batches queries and
caps payloads. Hosting the Next.js server in the SAME region as Neon drops
app-to-DB latency to low single-digit milliseconds.

### Vercel (recommended; realtime-off is designed-in)
1. Push the repo to GitHub.
2. vercel.com → import the repo. Framework preset: Next.js — Vercel runs
   `npm run build`, which includes `postbuild`, so the offline assertions run
   on every deploy.
3. Project Settings → Functions → Region: **iad1 (Washington DC)** — the
   Vercel region closest to Neon us-east-1.
4. Environment Variables (Production + Preview scopes):
   - `DATABASE_URL` — the same Neon **pooled** connection string already in use
     (keep the `-pooler.c-9.us-east-1.aws.neon.tech` host; pgbouncer-friendly).
     Never let Vercel "migrate" the DB or swap to an unconvinced/direct host.
   - `NEXTAUTH_SECRET` — reuse the current production secret (rotating it logs
     every device out).
   - `NEXTAUTH_URL` — final URL, e.g. `https://<project>.vercel.app`; set it
     and redeploy once the first URL exists.
   - `DISABLE_REALTIME=true` and `NEXT_PUBLIC_DISABLE_REALTIME=true` — REQUIRED
     on Vercel: serverless SSE fan-out cannot span lambda instances. Set these
     BEFORE the first deploy so the client hook never builds the EventSource
     path; clients refresh via their regular fetch cadence instead.
5. Apply pending migrations once, idempotent, from a machine with `.env` present:
   `npx prisma migrate deploy`
   - This points at the LIVE Neon DB. Do NOT run `prisma seed` — production
     already has real data.
   - `node_modules` is shared local tooling; `postinstall` runs `prisma generate`
     automatically on install (works without a DB).
6. Smoke checklist after the first deploy:
   - `GET /api/health` → `{"status":"ok","database":"connected"}`
   - admin login works (credentials auth; no OAuth dependencies)
   - one POS sale; a void request + admin approval; an offline sale →
     reconnect → queue sync (idempotency via `clientUuid`)
   - PWA: first visit registers the service worker; airplane-mode navigation
     serves cached shells; `/pos` keeps selling offline
7. Custom domain (optional): add it in Vercel, update `NEXTAUTH_URL`, redeploy.

### Alternative: single-process Node host
Railway / Fly.io / a small VPS in or near us-east-1 keeps SSE realtime WORKING
with no env flags (the broadcast `Map` is process-local by design). Same env
vars; run `npm run build && npm run start`.

### Queued (non-blocking)
- `middleware.ts` → `proxy.ts`: Next 16 emits a deprecation warning for the
  middleware file convention. Behavior is fully supported on 16.2.10; migrate
  at leisure.
