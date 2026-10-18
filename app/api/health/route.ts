import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Database health check timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!)) as Promise<T>;
}

async function checkDb(): Promise<void> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1 AS ok`, DB_TIMEOUT_MS);
  } catch (first) {
    // Neon cold start: proxy accepts TCP but compute needs 10-30s to boot.
    // One retry gives a suspended endpoint a chance to wake.
    await new Promise((r) => setTimeout(r, 2000));
    await withTimeout(prisma.$queryRaw`SELECT 1 AS ok`, DB_TIMEOUT_MS);
  }
}

export async function GET() {
  try {
    await checkDb();

    return NextResponse.json(
      { status: 'ok', online: true, database: 'connected', timestamp: Date.now() },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  } catch (error) {
    console.error('Database connectivity check failed:', error);

    return NextResponse.json(
      { status: 'degraded', online: false, database: 'disconnected', timestamp: Date.now() },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  }
}
