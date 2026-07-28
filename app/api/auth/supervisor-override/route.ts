import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { compare } from 'bcryptjs';

// POST /api/auth/supervisor-override
export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    if (user.status !== 'active') {
      return NextResponse.json({ error: 'User is inactive' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'User is not a supervisor/admin' }, { status: 403 });
    }

    const isValid = await compare(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      adminUser: {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
      },
    });
  } catch (error) {
    console.error('Supervisor override authentication error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
