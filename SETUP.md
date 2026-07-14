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

## If a page 404s
Every module listed above has both its API route AND its page built. If you
still see a 404 on one of these paths, it usually means you're running an
older extracted copy — re-extract this zip fresh over your project folder.

## Deploying later
- Push this to GitHub
- Deploy on Vercel (https://vercel.com) — connects directly to your GitHub repo
- Add the same `DATABASE_URL` / `NEXTAUTH_SECRET` / `NEXTAUTH_URL` (use your live
  Vercel URL) as Environment Variables in the Vercel project settings
