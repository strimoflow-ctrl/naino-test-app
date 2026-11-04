import nodemailer from 'nodemailer';
import { ENV } from '../config/env.js';

/**
 * Enterprise Email Dispatcher:
 * - 1st Priority: Resend HTTPS API (Port 443 - zero block on cloud servers)
 * - 2nd Priority: Brevo HTTPS API (Port 443 - 300 free emails/day)
 * - 3rd Priority: Nodemailer SMTP with non-blocking 3-second timeout
 */
export async function sendPasswordResetOtpEmail(toEmail, otp, recipientName) {
  const cleanEmail = toEmail.trim().toLowerCase();
  const name = recipientName || 'Future Doctor';

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
      <div style="display: flex; align-items: center; margin-bottom: 20px;">
        <div style="width: 36px; height: 36px; background: #e8f5e9; border-radius: 10px; text-align: center; line-height: 36px; font-size: 20px; color: #0f3d26; font-weight: bold; margin-right: 12px;">+</div>
        <h2 style="color: #0f3d26; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px;">NAINO ACADEMY</h2>
      </div>
      <p style="color: #334155; font-size: 15px; line-height: 1.5;">Hello <strong>${name}</strong>,</p>
      <p style="color: #475569; font-size: 14px; line-height: 1.5;">We received a request to reset the password for your Naino Academy account. Use the 6-digit verification code below:</p>
      <div style="text-align: center; margin: 28px 0;">
        <span style="display: inline-block; font-size: 34px; font-weight: 800; letter-spacing: 7px; color: #0f3d26; background: #f0fdf4; padding: 14px 28px; border-radius: 12px; border: 1.5px dashed #10b981;">
          ${otp}
        </span>
      </div>
      <p style="color: #64748b; font-size: 13px; line-height: 1.4;">This code is valid for <strong>10 minutes</strong>. If you did not make this request, your account is safe—you can safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">Naino Academy — Your Learning Companion</p>
    </div>
  `;

  // 1. Resend HTTPS API (Port 443)
  if (ENV.RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ENV.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Naino Academy <onboarding@resend.dev>',
          to: [cleanEmail],
          subject: `${otp} is your Naino Academy Password Reset Code`,
          html: htmlContent
        })
      });
      const data = await response.json();
      console.log(`[EmailService:Resend] Email dispatched to ${cleanEmail}:`, data);
      return { success: true, provider: 'resend', data };
    } catch (e) {
      console.error('[EmailService:Resend] Error sending email via HTTPS:', e.message);
    }
  }

  // 2. Brevo HTTPS API (Port 443)
  if (ENV.BREVO_API_KEY) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': ENV.BREVO_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Naino Academy', email: ENV.SMTP_USER || 'nainoneet@gmail.com' },
          to: [{ email: cleanEmail }],
          subject: `${otp} is your Naino Academy Password Reset Code`,
          htmlContent: htmlContent
        })
      });
      const data = await response.json();
      console.log(`[EmailService:Brevo] Email dispatched to ${cleanEmail}:`, data);
      return { success: true, provider: 'brevo', data };
    } catch (e) {
      console.error('[EmailService:Brevo] Error sending email via HTTPS:', e.message);
    }
  }

  // 3. Nodemailer SMTP Fallback
  if (ENV.SMTP_USER && ENV.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: ENV.SMTP_USER, pass: ENV.SMTP_PASS },
        connectionTimeout: 3000,
        greetingTimeout: 3000,
        socketTimeout: 3000
      });
      await transporter.sendMail({
        from: `"Naino Academy" <${ENV.SMTP_USER}>`,
        to: cleanEmail,
        subject: `${otp} is your Naino Academy Password Reset Code`,
        html: htmlContent
      });
      console.log(`[EmailService:SMTP] Email delivered to ${cleanEmail}`);
      return { success: true, provider: 'smtp' };
    } catch (mailErr) {
      console.warn('[EmailService:SMTP] Direct SMTP delivery failed (Port 465 blocked on cloud):', mailErr.message);
    }
  }

  // Fallback: Log prominently in server console
  console.log(`\n======================================================`);
  console.log(`[CONSOLE OTP NOTIFICATION] Password Reset for: ${cleanEmail}`);
  console.log(`>>> YOUR 6-DIGIT OTP IS: ${otp} <<<`);
  console.log(`Valid for 10 minutes.`);
  console.log(`======================================================\n`);
  return { success: false, provider: 'console_fallback' };
}

