import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientIp, isRateLimited } from '@/lib/rate-limit';
import { Resend } from 'resend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    const trimmedEmail = email.trim();
    const normalizedEmail = trimmedEmail.toLowerCase();

    if (isRateLimited(`forgot-password:${getClientIp(request)}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    console.log('[forgot-password] Request for:', normalizedEmail);

    // Opportunistic cleanup of expired one-time codes.
    await prisma.passwordResetCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const user =
      (await prisma.user.findUnique({ where: { email: trimmedEmail } })) ??
      (await prisma.user.findUnique({ where: { email: normalizedEmail } }));

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);
    let greeting: string;

    if (user && user.status === 'active') {
      console.log('[forgot-password] User found:', user.username, '(' + user.role + ')');
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken: code, resetTokenExpiry: expiry },
      });
      greeting = user.fullName;
    } else {
      console.log('[forgot-password] No active user; storing one-time code for:', normalizedEmail);
      // One-time code for an email with no account. It can be delivered,
      // but the reset step will refuse it ("No account found").
      await prisma.passwordResetCode.deleteMany({ where: { email: normalizedEmail } });
      await prisma.passwordResetCode.create({
        data: { email: normalizedEmail, code, expiresAt: expiry },
      });
      greeting = 'there';
    }

    console.log('[forgot-password] Code generated, sending email via Resend...');

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'J & J Merchandise Store <noreply@jjmerchandisestore.shop>',
      to: normalizedEmail,
      subject: 'Your Password Reset Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #334155;">Password Reset Code</h2>
          <p style="color: #64748b;">Hi ${greeting},</p>
          <p style="color: #64748b;">You requested a password reset. Use the code below:</p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; letter-spacing: 6px; font-weight: bold; color: #0891b2; background: #f0fdfa; padding: 12px 24px; border-radius: 12px; border: 1px solid #ccfbf1;">${code}</span>
          </div>
          <p style="color: #94a3b8; font-size: 14px;">This code expires in 15 minutes. If you didn't request this, you can ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 12px;">J & J Merchandise Store</p>
        </div>
      `,
    });

    if (error) {
      console.error('[forgot-password] Resend error:', error);
      return NextResponse.json(
        { error: 'Failed to send email. Please try again.' },
        { status: 500 }
      );
    }

    console.log('[forgot-password] Email sent:', data?.id);

    return NextResponse.json({
      message: 'If that email exists, a code has been sent.',
    });
  } catch (error) {
    console.error('[forgot-password] Unexpected error:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
