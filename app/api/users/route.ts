import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import bcrypt from 'bcryptjs';

export async function GET() {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, username: true, email: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(users);
}

// POST /api/users — Admin only. This is the ONLY way Cashier accounts get created (no public signup).
export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { fullName, username, email, password, role } = await request.json();

  if (!fullName || !username || !email || !password || !role) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { fullName, username, email, passwordHash, role, status: 'active' },
    select: { id: true, fullName: true, username: true, email: true, role: true, status: true },
  });

  return NextResponse.json(user, { status: 201 });
}
