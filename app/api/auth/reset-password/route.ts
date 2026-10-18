import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import bcrypt from 'bcryptjs';
import { clearRateLimit, getClientIp, isRateLimited } from '@/lib/server/rate-limit';
import { hashResetCode } from '@/lib/server/reset-code';

export async function POST(request: Request) {
  try {
    const { email, code, newPassword } = await request.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: 'Email, code, and new password are required.' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    if (isRateLimited(`reset-password:${getClientIp(request)}`, 10, 10 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const normEmail = email.trim().toLowerCase();
    const codeHash = hashResetCode(String(code).trim());

    // Per-email attempt cap (≤5, then invalidate): X-Forwarded-For is
    // client-spoofable, so the IP bucket alone can't stop code guessing.
    if (isRateLimited(`reset-attempt:${normEmail}`, 5, 15 * 60 * 1000)) {
      await prisma.user.updateMany({
        where: { email: { equals: normEmail, mode: 'insensitive' } },
        data: { resetToken: null, resetTokenExpiry: null },
      });
      await prisma.passwordResetCode.deleteMany({ where: { email: normEmail } });
      return NextResponse.json(
        { error: 'Too many wrong codes — a fresh code has been required. Please request a new one.' },
        { status: 429 }
      );
    }

    const user = await prisma.user.findFirst({
      where: {
        email: { equals: normEmail, mode: 'insensitive' },
        resetToken: codeHash,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      // Code issued to an email with no account: consume it (single-use)
      // and explain that there is nothing to reset.
      const stray = await prisma.passwordResetCode.findFirst({
        where: {
          email: normEmail,
          code: codeHash,
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
    // Success clears the per-email attempt bucket so the next legitimate
    // reset starts fresh.
    clearRateLimit(`reset-attempt:${normEmail}`);

    return NextResponse.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
