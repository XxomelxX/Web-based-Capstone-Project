import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    console.log('[test-email] Sending test email via Resend to:', email);

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'J & J Merchandise Store <noreply@jjmerchandisestore.shop>',
      to: email,
      subject: 'Test Email — Password Reset System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #334155;">Email Delivery Test</h2>
          <p style="color: #64748b;">This is a test email from the Sari-Sari POS password reset system.</p>
          <p style="color: #64748b;">If you received this, Resend email delivery is working correctly.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 12px;">J & J Merchandise Store</p>
        </div>
      `,
    });

    if (error) {
      console.error('[test-email] Resend error:', error);
      return NextResponse.json({
        success: false,
        error: error.message,
      }, { status: 500 });
    }

    console.log('[test-email] Email sent:', data?.id);

    return NextResponse.json({
      success: true,
      id: data?.id,
    });
  } catch (error) {
    console.error('[test-email] Unexpected error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
