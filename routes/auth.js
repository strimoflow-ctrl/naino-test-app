import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { getMongoDb, isMongoConnected } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import nodemailer from 'nodemailer';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'naino_neet_default_jwt_secret_2026';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'naino_neet_default_jwt_refresh_2026';

// Access Token expires in 1 Hour; Refresh Token expires in 60 Days
const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY = '60d';

// Brute-force & credential stuffing defense: Max 30 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: 'Too many authentication attempts from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Helper to generate dual JWT tokens (Access + Refresh)
 */
function generateTokens(payload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  return { accessToken, refreshToken };
}

/**
 * 1. SIGNUP: Create new user with Email, Password & Name in MongoDB
 * POST /api/auth/signup
 */
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and password are required.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address.'
      });
    }

    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database is currently unavailable. Please try again in a few moments.'
      });
    }

    const usersCol = db.collection('users');

    // Check if user already exists
    const existingUser = await usersCol.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists. Please log in instead.'
      });
    }

    // Hash password with 10 salt rounds
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = `naino_user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newUser = {
      userId,
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      authProvider: 'email',
      targetExam: 'NEET 2026',
      targetScore: 680,
      streak: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const tokens = generateTokens({
      userId,
      email: cleanEmail,
      name: cleanName
    });

    newUser.refreshToken = tokens.refreshToken;

    await usersCol.insertOne(newUser);

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: {
        userId,
        name: cleanName,
        email: cleanEmail,
        targetExam: newUser.targetExam,
        targetScore: newUser.targetScore
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    console.error('[Auth:Signup] Error:', err);
    res.status(500).json({
      success: false,
      error: 'An unexpected server error occurred during signup.'
    });
  }
});

/**
 * 2. LOGIN: Email & Password verification against MongoDB
 * POST /api/auth/login
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Both email and password are required.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = getMongoDb();

    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database is currently unavailable.'
      });
    }

    const usersCol = db.collection('users');
    const user = await usersCol.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        error: 'No account found with this email. Please switch to Create Account to sign up.'
      });
    }

    // If user signed up via Google originally without password
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        error: 'This account was created with Google. Please use "Continue with Google".'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_PASSWORD',
        error: 'Incorrect password. Please try again or tap Forgot Password.'
      });
    }

    const tokens = generateTokens({
      userId: user.userId,
      email: user.email,
      name: user.name
    });

    // Update refresh token in MongoDB
    await usersCol.updateOne(
      { userId: user.userId },
      {
        $set: {
          refreshToken: tokens.refreshToken,
          lastLoginAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: 'Logged in successfully!',
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        targetExam: user.targetExam || 'NEET 2026',
        targetScore: user.targetScore || 680,
        streak: user.streak || 1
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    console.error('[Auth:Login] Error:', err);
    res.status(500).json({
      success: false,
      error: 'An unexpected server error occurred during login.'
    });
  }
});

/**
 * 3. GOOGLE SIGN-IN: Seamless registration/login via Google OAuth
 * POST /api/auth/google
 */
router.post('/google', async (req, res) => {
  try {
    const { email, name, googleId, photoUrl } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required from Google sign-in.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name && name.trim()) || 'Future Doctor';
    const db = getMongoDb();

    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database is currently unavailable.'
      });
    }

    const usersCol = db.collection('users');
    let user = await usersCol.findOne({ email: cleanEmail });

    let userId;
    if (!user) {
      // First time Google Sign-In -> create new profile in MongoDB
      userId = `naino_user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      user = {
        userId,
        name: cleanName,
        email: cleanEmail,
        googleId: googleId || null,
        photoUrl: photoUrl || null,
        authProvider: 'google',
        targetExam: 'NEET 2026',
        targetScore: 680,
        streak: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await usersCol.insertOne(user);
    } else {
      userId = user.userId;
      // Update Google ID or Photo if newly available
      await usersCol.updateOne(
        { userId },
        {
          $set: {
            googleId: googleId || user.googleId,
            photoUrl: photoUrl || user.photoUrl,
            lastLoginAt: new Date()
          }
        }
      );
    }

    const tokens = generateTokens({
      userId,
      email: cleanEmail,
      name: user.name || cleanName
    });

    await usersCol.updateOne(
      { userId },
      { $set: { refreshToken: tokens.refreshToken } }
    );

    res.json({
      success: true,
      message: 'Google login successful!',
      user: {
        userId,
        name: user.name || cleanName,
        email: cleanEmail,
        photoUrl: photoUrl || user.photoUrl || null,
        targetExam: user.targetExam || 'NEET 2026',
        targetScore: user.targetScore || 680
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    console.error('[Auth:Google] Error:', err);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred during Google sign-in.'
    });
  }
});

/**
 * 4. SILENT REFRESH TOKEN: Generates new Access Token without logging out user
 * POST /api/auth/refresh-token
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token is required.',
        code: 'REFRESH_TOKEN_MISSING'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token is expired or invalid. Please sign in again.',
        code: 'REFRESH_TOKEN_EXPIRED'
      });
    }

    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database connection offline.'
      });
    }

    const usersCol = db.collection('users');
    const user = await usersCol.findOne({ userId: decoded.userId });

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Session has been invalidated. Please log in again.',
        code: 'SESSION_REVOKED'
      });
    }

    // Generate fresh Access Token (1 hour validity)
    const newAccessToken = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    res.json({
      success: true,
      accessToken: newAccessToken
    });
  } catch (err) {
    console.error('[Auth:Refresh] Error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh token.'
    });
  }
});

/**
 * 5. LOGOUT: Invalidate active refresh token in MongoDB
 * POST /api/auth/logout
 */
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const db = getMongoDb();
      if (db) {
        await db.collection('users').updateOne(
          { refreshToken },
          { $unset: { refreshToken: '' } }
        );
      }
    }
    res.json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Error logging out.'
    });
  }
});

/**
 * 6. FORGOT PASSWORD: Send 6-Digit OTP to User's Email
 * POST /api/auth/forgot-password
 */
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database currently offline.' });
    }

    const user = await db.collection('users').findOne({ email: cleanEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No account found with this email address.'
      });
    }

    // Generate secure 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store in password_resets collection
    await db.collection('password_resets').updateOne(
      { email: cleanEmail },
      {
        $set: {
          email: cleanEmail,
          otp,
          expiresAt,
          verified: false,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    // Send email via nodemailer if SMTP credentials exist in env
    const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : null;
    const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : null;

    if (smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass
          }
        });

        await transporter.sendMail({
          from: `"Naino NEET" <${smtpUser}>`,
          to: cleanEmail,
          subject: `${otp} is your Naino NEET Password Reset Code`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; borderRadius: 12px; background: #ffffff;">
              <h2 style="color: #0b3523; margin-top: 0;">Naino NEET</h2>
              <p style="color: #334155; font-size: 15px;">Hello <strong>${user.name || 'Future Doctor'}</strong>,</p>
              <p style="color: #475569; font-size: 14px;">We received a request to reset your password for your Naino NEET account. Use the 6-digit code below to proceed:</p>
              <div style="text-align: center; margin: 28px 0;">
                <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0b3523; background: #e8f5e9; padding: 14px 28px; border-radius: 8px; border: 1px dashed #10b981;">
                  ${otp}
                </span>
              </div>
              <p style="color: #64748b; font-size: 13px;">This code is valid for <strong>10 minutes</strong>. If you did not request this, please ignore this email.</p>
              <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
              <p style="color: #94a3b8; font-size: 11px; text-align: center;">Naino NEET — Your Companion for NEET 2026</p>
            </div>
          `
        });
        console.log(`[Auth:ForgotPassword] Email sent with OTP to ${cleanEmail}`);
      } catch (mailErr) {
        console.error('[Auth:ForgotPassword] Email delivery failed:', mailErr.message);
      }
    } else {
      // Development mode fallback: Log OTP prominently in server console
      console.log(`\n======================================================`);
      console.log(`[DEV OTP NOTIFICATION] Password Reset for: ${cleanEmail}`);
      console.log(`>>> YOUR 6-DIGIT OTP IS: ${otp} <<<`);
      console.log(`Valid for 10 minutes.`);
      console.log(`(To send real emails, set SMTP_USER and SMTP_PASS in backend .env)`);
      console.log(`======================================================\n`);
    }

    res.json({
      success: true,
      message: 'A 6-digit verification code has been sent to your email.',
      // devOtp is included so local testing works seamlessly before SMTP credentials are added
      ...(smtpUser ? {} : { devOtp: otp })
    });
  } catch (err) {
    console.error('[Auth:ForgotPassword] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to process password reset request.' });
  }
});

/**
 * 7. VERIFY RESET OTP
 * POST /api/auth/verify-reset-otp
 */
router.post('/verify-reset-otp', authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP code are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database offline.' });
    }

    const record = await db.collection('password_resets').findOne({ email: cleanEmail });

    if (!record || record.otp !== otp.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid verification code. Please check and try again.' });
    }

    if (new Date() > new Date(record.expiresAt)) {
      return res.status(400).json({ success: false, error: 'Verification code has expired. Please request a new one.' });
    }

    // Mark as verified
    await db.collection('password_resets').updateOne(
      { email: cleanEmail },
      { $set: { verified: true } }
    );

    res.json({
      success: true,
      message: 'Code verified successfully. You can now set a new password.'
    });
  } catch (err) {
    console.error('[Auth:VerifyOTP] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify code.' });
  }
});

/**
 * 8. RESET PASSWORD: Save New Password in MongoDB
 * POST /api/auth/reset-password
 */
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database offline.' });
    }

    const record = await db.collection('password_resets').findOne({ email: cleanEmail });
    if (!record || record.otp !== otp.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid or missing OTP verification.' });
    }

    if (new Date() > new Date(record.expiresAt)) {
      return res.status(400).json({ success: false, error: 'Verification code has expired.' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user in MongoDB
    await db.collection('users').updateOne(
      { email: cleanEmail },
      {
        $set: {
          password: hashedPassword,
          updatedAt: new Date()
        }
      }
    );

    // Delete the reset record after successful reset
    await db.collection('password_resets').deleteOne({ email: cleanEmail });

    res.json({
      success: true,
      message: 'Password has been reset successfully! You can now log in with your new password.'
    });
  } catch (err) {
    console.error('[Auth:ResetPassword] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to reset password.' });
  }
});

export default router;

