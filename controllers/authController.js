import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getMongoDb } from '../db.js';
import { ENV, getClientIp } from '../config/env.js';

/**
 * Generates Dual JWT Tokens (Access Token: 1 Hour, Refresh Token: 60 Days)
 */
export function generateTokens(payload) {
  const accessToken = jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: ENV.ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign(payload, ENV.JWT_REFRESH_SECRET, { expiresIn: ENV.REFRESH_TOKEN_EXPIRY });
  return { accessToken, refreshToken };
}

/**
 * 1. SIGNUP: Create new user account with IP address tracking
 * POST /api/auth/signup
 */
export async function signup(req, res) {
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
    const clientIp = getClientIp(req);
    const deviceInfo = req.body.deviceInfo || {};
    const deviceModel = deviceInfo.deviceModel || req.body.deviceModel || 'Unknown Device';
    const deviceBrand = deviceInfo.deviceBrand || req.body.deviceBrand || 'Unknown';
    const deviceId = deviceInfo.deviceId || req.body.deviceId || null;
    const osVersion = deviceInfo.osVersion || req.body.osVersion || null;
    const appVersion = deviceInfo.appVersion || req.body.appVersion || '2.0.1';

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
        error: 'Please provide a valid email address.'
      });
    }

    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database is currently offline. Please try again shortly.'
      });
    }

    const usersCol = db.collection('users');
    const existing = await usersCol.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'USER_ALREADY_EXISTS',
        error: 'An account with this email already exists. Please sign in.'
      });
    }

    // Salt and hash password (10 rounds)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userId = `naino_user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const newUser = {
      userId,
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      authProvider: 'local',
      createdAt: now,
      lastLoginAt: now,
      streak: 1,
      // IP Tracking
      signupIp: clientIp,
      lastLoginIp: clientIp,
      deviceModel,
      deviceBrand,
      deviceId,
      osVersion,
      appVersion,
      ipHistory: [
        { ip: clientIp, action: 'signup', timestamp: now }
      ],
      deviceHistory: [
        {
          deviceModel,
          deviceBrand,
          deviceId,
          osVersion,
          appVersion,
          ip: clientIp,
          action: 'signup',
          timestamp: now
        }
      ]
    };

    const tokens = generateTokens({
      userId,
      email: cleanEmail,
      name: cleanName
    });

    newUser.refreshToken = tokens.refreshToken;
    await usersCol.insertOne(newUser);

    console.log(`[Auth:Signup] New user created: ${cleanEmail} (IP: ${clientIp})`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: {
        userId,
        name: cleanName,
        email: cleanEmail,
        streak: 1
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
}

/**
 * 2. LOGIN: Email & Password verification with precise error messages & IP tracking
 * POST /api/auth/login
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Both email and password are required.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const clientIp = getClientIp(req);
    const deviceInfo = req.body.deviceInfo || {};
    const deviceModel = deviceInfo.deviceModel || req.body.deviceModel || 'Unknown Device';
    const deviceBrand = deviceInfo.deviceBrand || req.body.deviceBrand || 'Unknown';
    const deviceId = deviceInfo.deviceId || req.body.deviceId || null;
    const osVersion = deviceInfo.osVersion || req.body.osVersion || null;
    const appVersion = deviceInfo.appVersion || req.body.appVersion || '2.0.1';
    const db = getMongoDb();

    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database is currently offline. Please try again shortly.'
      });
    }

    const usersCol = db.collection('users');
    const user = await usersCol.findOne({ email: cleanEmail });

    // Specific Error: If user does not exist in MongoDB
    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        error: 'No account found with this email. Please switch to Create Account to sign up.'
      });
    }

    // If user originally signed up via Google without password
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        error: 'This account was created with Google. Please use "Continue with Google".'
      });
    }

    // Specific Error: If password does not match bcrypt hash
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

    const now = new Date();

    // Update refresh token, login timestamp and IP address in MongoDB
    await usersCol.updateOne(
      { userId: user.userId },
      {
        $set: {
          refreshToken: tokens.refreshToken,
          lastLoginAt: now,
          lastLoginIp: clientIp,
          deviceModel,
          deviceBrand,
          deviceId,
          osVersion,
          appVersion,
          isOnline: true
        },
        $push: {
          ipHistory: {
            $each: [{ ip: clientIp, action: 'login', timestamp: now }],
            $slice: -20 // Retain last 20 logins
          },
          deviceHistory: {
            $each: [{
              deviceModel,
              deviceBrand,
              deviceId,
              osVersion,
              appVersion,
              ip: clientIp,
              action: 'login',
              timestamp: now
            }],
            $slice: -20
          }
        }
      }
    );

    console.log(`[Auth:Login] User logged in: ${cleanEmail} (IP: ${clientIp})`);

    res.json({
      success: true,
      message: 'Logged in successfully!',
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        streak: user.streak || 1
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    console.error('[Auth:Login] Error:', err);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred during login.'
    });
  }
}

/**
 * 3. GOOGLE AUTH: One-tap authentication with Google Sign-In & IP tracking
 * POST /api/auth/google
 */
export async function googleAuth(req, res) {
  try {
    const { email, name, googleId, photoUrl } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required for Google authentication.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name || 'Future Doctor').trim();
    const clientIp = getClientIp(req);
    const deviceInfo = req.body.deviceInfo || {};
    const deviceModel = deviceInfo.deviceModel || req.body.deviceModel || 'Unknown Device';
    const deviceBrand = deviceInfo.deviceBrand || req.body.deviceBrand || 'Unknown';
    const deviceId = deviceInfo.deviceId || req.body.deviceId || null;
    const osVersion = deviceInfo.osVersion || req.body.osVersion || null;
    const appVersion = deviceInfo.appVersion || req.body.appVersion || '2.0.1';
    const db = getMongoDb();

    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database currently offline.'
      });
    }

    const usersCol = db.collection('users');
    let user = await usersCol.findOne({ email: cleanEmail });
    const now = new Date();

    let userId;
    if (!user) {
      // First time Google Signup
      userId = `naino_user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      user = {
        userId,
        name: cleanName,
        email: cleanEmail,
        googleId: googleId || null,
        photoUrl: photoUrl || null,
        authProvider: 'google',
        createdAt: now,
        lastLoginAt: now,
        streak: 1,
        signupIp: clientIp,
        lastLoginIp: clientIp,
        deviceModel,
        deviceBrand,
        deviceId,
        osVersion,
        appVersion,
        ipHistory: [{ ip: clientIp, action: 'google_signup', timestamp: now }],
        deviceHistory: [
          {
            deviceModel,
            deviceBrand,
            deviceId,
            osVersion,
            appVersion,
            ip: clientIp,
            action: 'google_signup',
            timestamp: now
          }
        ]
      };
      await usersCol.insertOne(user);
    } else {
      userId = user.userId;
      await usersCol.updateOne(
        { userId },
        {
          $set: {
            lastLoginAt: now,
            lastLoginIp: clientIp,
            deviceModel,
            deviceBrand,
            deviceId,
            osVersion,
            appVersion,
            isOnline: true,
            ...(photoUrl ? { photoUrl } : {}),
            ...(googleId ? { googleId } : {})
          },
          $push: {
            ipHistory: {
              $each: [{ ip: clientIp, action: 'google_login', timestamp: now }],
              $slice: -20
            },
            deviceHistory: {
              $each: [{
                deviceModel,
                deviceBrand,
                deviceId,
                osVersion,
                appVersion,
                ip: clientIp,
                action: 'google_login',
                timestamp: now
              }],
              $slice: -20
            }
          }
              $slice: -20
            }
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
        streak: user.streak || 1
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
}

/**
 * 4. REFRESH TOKEN: Silent background token refresh
 * POST /api/auth/refresh-token
 */
export async function refreshToken(req, res) {
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
      decoded = jwt.verify(refreshToken, ENV.JWT_REFRESH_SECRET);
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

    const user = await db.collection('users').findOne({
      userId: decoded.userId,
      refreshToken
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session. Please sign in again.',
        code: 'SESSION_REVOKED'
      });
    }

    const newAccessToken = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        name: user.name
      },
      ENV.JWT_SECRET,
      { expiresIn: ENV.ACCESS_TOKEN_EXPIRY }
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
}

/**
 * 5. LOGOUT: Invalidate refresh token in MongoDB
 * POST /api/auth/logout
 */
export async function logout(req, res) {
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
}

