// This script runs prisma generate with a fallback DATABASE_URL
// prisma generate only creates TypeScript types — it does NOT connect to the database
// A valid-format URL is needed just to pass Prisma's schema validation
const { execSync } = require('child_process');

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
  console.log('[prisma-generate] DATABASE_URL not set, using placeholder for type generation');
}

execSync('npx prisma generate', { stdio: 'inherit', env: process.env });
