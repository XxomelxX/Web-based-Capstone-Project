import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    console.log('[forgot-password] Request for:', email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'active') {
      console.log('[forgot-password] No active user found for:', email);
      return NextResponse.json({ message: 'If that email exists, a code has been sent.' });
    }

    console.log('[forgot-password] User found:', user.username, '(' + user.role + ')');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: code, resetTokenExpiry: expiry },
    });

    console.log('[forgot-password] Code generated, sending email via Resend...');

    const { data, error } = await resend.emails.send({
      from: 'J & J Merchandise Store <onboarding@resend.dev>',
      to: user.email,
      subject: 'Your Password Reset Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #334155;">Password Reset Code</h2>
          <p style="color: #64748b;">Hi ${user.fullName},</p>
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

    const response: Record<string, string> = {
      message: 'If that email exists, a code has been sent.',
    };

    if (process.env.NODE_ENV === 'development') {
      response.devCode = code;
      response.devNote = 'Development mode: use this code if email is not received.';
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[forgot-password] Unexpected error:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
