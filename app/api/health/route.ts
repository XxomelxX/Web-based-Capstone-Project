import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // 2.5s timeout for DB reachability test
    const dbTest = prisma.$queryRaw`SELECT 1`;
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DB Timeout')), 2500)
    );

    await Promise.race([dbTest, timeout]);
    return NextResponse.json(
      { status: 'ok', online: true, timestamp: Date.now() },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { status: 'offline', online: false },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  }
}
