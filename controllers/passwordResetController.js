import bcrypt from 'bcryptjs';
import { getMongoDb } from '../db.js';
import { getClientIp } from '../config/env.js';
import { sendPasswordResetOtpEmail } from '../services/emailService.js';
import { checkOtpRateLimit } from '../middleware/rateLimiter.js';

/**
 * 1. FORGOT PASSWORD: Send 6-digit OTP with Tiered Rate Limiting (3 attempts, then 9 min, 18 min...)
 * POST /api/auth/forgot-password
 */
export async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const clientIp = getClientIp(req);
    const db = getMongoDb();

    if (!db) {
      return res.status(503).json({ success: false, error: 'Database is currently offline.' });
    }

    // 1. Enforce Strict Backend Tiered Rate Limiting (3 attempts, then 9m, 18m, 27m...)
    const rateCheck = await checkOtpRateLimit(cleanEmail, clientIp);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        code: 'OTP_RATE_LIMIT_EXCEEDED',
        error: rateCheck.error,
        retryAfterMinutes: rateCheck.retryAfterMinutes,
        retryAfterSeconds: rateCheck.retryAfterSeconds
      });
    }

    // 2. Check if user exists in database
    const user = await db.collection('users').findOne({ email: cleanEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        error: 'No account found with this email address.'
      });
    }

    // 3. Generate secure 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes validity

    // 4. Store in password_resets collection
    await db.collection('password_resets').updateOne(
      { email: cleanEmail },
      {
        $set: {
          email: cleanEmail,
          otp,
          expiresAt,
          verified: false,
          requestedIp: clientIp,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    // 5. Non-blocking background dispatch via HTTPS Port 443 (Resend / Brevo / SMTP fallback)
    sendPasswordResetOtpEmail(cleanEmail, otp, user.name || 'Future Doctor').catch(e => {
      console.error('[PasswordReset:Email] Background dispatch failed:', e.message);
    });

    res.json({
      success: true,
      message: 'A 6-digit verification code has been sent to your email.',
      attemptsLeft: rateCheck.attemptsLeft,
      ...(rateCheck.lockoutScheduled ? { lockoutWarning: `Note: Next attempt will require waiting ${rateCheck.lockoutMinutes} minutes.` } : {})
    });
  } catch (err) {
    console.error('[PasswordReset:Forgot] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to process password reset request.' });
  }
}

/**
 * 2. VERIFY RESET OTP: Confirms the 6-digit code matches and has not expired
 * POST /api/auth/verify-reset-otp
 */
export async function verifyResetOtp(req, res) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP code are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();
    const db = getMongoDb();

    if (!db) {
      return res.status(503).json({ success: false, error: 'Database is currently offline.' });
    }

    const resetDoc = await db.collection('password_resets').findOne({ email: cleanEmail });
    if (!resetDoc) {
      return res.status(400).json({
        success: false,
        code: 'OTP_NOT_FOUND',
        error: 'No active verification code found. Please request a new code.'
      });
    }

    if (new Date() > new Date(resetDoc.expiresAt)) {
      return res.status(400).json({
        success: false,
        code: 'OTP_EXPIRED',
        error: 'This verification code has expired. Please request a new one.'
      });
    }

    if (resetDoc.otp !== cleanOtp) {
      return res.status(400).json({
        success: false,
        code: 'OTP_INVALID',
        error: 'Invalid verification code. Please check and try again.'
      });
    }

    // Mark as verified
    await db.collection('password_resets').updateOne(
      { email: cleanEmail },
      { $set: { verified: true, verifiedAt: new Date() } }
    );

    res.json({
      success: true,
      message: 'Verification code confirmed! You can now set your new password.'
    });
  } catch (err) {
    console.error('[PasswordReset:Verify] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify code.' });
  }
}

/**
 * 3. RESET PASSWORD: Sets new password in MongoDB and revokes active sessions
 * POST /api/auth/reset-password
 */
export async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Email, OTP, and new password are required.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();
    const clientIp = getClientIp(req);
    const db = getMongoDb();

    if (!db) {
      return res.status(503).json({ success: false, error: 'Database is currently offline.' });
    }

    const resetDoc = await db.collection('password_resets').findOne({
      email: cleanEmail,
      otp: cleanOtp,
      verified: true
    });

    if (!resetDoc) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or unverified reset session. Please request a new OTP code.'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    const now = new Date();

    // Update password and invalidate existing refresh tokens to force fresh login
    await db.collection('users').updateOne(
      { email: cleanEmail },
      {
        $set: {
          password: hashedPassword,
          passwordResetAt: now,
          passwordResetIp: clientIp
        },
        $unset: { refreshToken: '' }
      }
    );

    // Delete used password reset document
    await db.collection('password_resets').deleteOne({ email: cleanEmail });

    console.log(`[PasswordReset:Complete] Password reset completed for: ${cleanEmail} (IP: ${clientIp})`);

    res.json({
      success: true,
      message: 'Password reset successfully! Please sign in with your new password.'
    });
  } catch (err) {
    console.error('[PasswordReset:Reset] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to reset password.' });
  }
}
