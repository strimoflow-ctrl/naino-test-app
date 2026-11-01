import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { getMongoDb, isMongoConnected } from '../db.js';
import { verifyToken } from '../middleware/auth.js';

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
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password. Please check and try again.'
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
        error: 'Invalid email or password. Please check and try again.'
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

export default router;

