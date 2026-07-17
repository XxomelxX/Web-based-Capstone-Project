import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hash } from 'bcryptjs';
import { requireRole } from '@/lib/require-role';

export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { username, newPassword } = await request.json();
  if (!username || !newPassword) {
    return NextResponse.json({ error: 'Username and new password are required.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin account not found.' }, { status: 404 });
  }

  const passwordHash = await hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  return NextResponse.json({ success: true });
}
