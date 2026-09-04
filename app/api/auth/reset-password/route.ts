import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(request: Request) {
  try {
    const { email, code, newPassword } = await request.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: 'Email, code, and new password are required.' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: {
        email,
        resetToken: code,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      // Code issued to an email with no account: consume it (single-use)
      // and explain that there is nothing to reset.
      const stray = await prisma.passwordResetCode.findFirst({
        where: {
          email: email.trim().toLowerCase(),
          code,
          expiresAt: { gt: new Date() },
        },
      });
      if (stray) {
        await prisma.passwordResetCode.delete({ where: { id: stray.id } });
        return NextResponse.json(
          { error: 'No account found for this email. Please register first.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    return NextResponse.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
