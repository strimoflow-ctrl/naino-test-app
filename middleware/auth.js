import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.js';
import { getMongoDb } from '../db.js';

/**
 * Strict Bearer Token Verification Middleware.
 * Returns 401 with code 'TOKEN_EXPIRED' so the mobile client executes silent refresh.
 */
export function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. No Bearer token provided.',
      code: 'TOKEN_MISSING'
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET);
    req.user = decoded; // { userId, email, name, ... }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Access token expired.',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Invalid token.',
      code: 'TOKEN_INVALID'
    });
  }
}

/**
 * Optional Token Middleware: Extracts user if token is present, but allows guests.
 */
export function optionalToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      req.user = jwt.verify(token, ENV.JWT_SECRET);
    } catch (_) {
      // Ignore token failure in optional mode
    }
  }
  next();
}

/**
 * Point 1: Anti-Scraping / App Handshake Guard.
 * Blocks unauthorized web scrapers or raw bots lacking internal app key.
 */
export function verifyAppSecret(req, res, next) {
  const clientAppSecret = req.headers['x-app-secret'];
  if (ENV.APP_SECRET_KEY) {
    if (!clientAppSecret || clientAppSecret !== ENV.APP_SECRET_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: App handshake verification failed.',
        code: 'INVALID_APP_SECRET'
      });
    }
  }
  next();
}

/**
 * Point 3: Hardware Device Fingerprint Binding.
 * Ensures the requesting client has a genuine registered deviceId matching the account in MongoDB.
 */
export async function verifyDeviceBinding(req, res, next) {
  if (!req.user || !req.user.userId) return next();

  const clientDeviceId = req.headers['x-device-id'];
  if (!clientDeviceId) {
    return res.status(403).json({
      success: false,
      error: 'Access denied: Genuine device identification required.',
      code: 'DEVICE_ID_MISSING'
    });
  }

  try {
    const db = getMongoDb();
    if (!db) return next();

    const user = await db.collection('users').findOne(
      { userId: req.user.userId },
      { projection: { deviceId: 1, isLocked: 1, isBanned: 1 } }
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User account not found.',
        code: 'USER_NOT_FOUND'
      });
    }

    if (user.isLocked || user.isBanned) {
      return res.status(403).json({
        success: false,
        error: 'Account access has been suspended due to security violations.',
        code: 'ACCOUNT_SUSPENDED'
      });
    }

    // If account has no registered deviceId yet, auto-bind to this device seamlessly
    if (!user.deviceId && clientDeviceId) {
      await db.collection('users').updateOne(
        { userId: req.user.userId },
        { $set: { deviceId: clientDeviceId } }
      );
    } else if (user.deviceId && user.deviceId !== clientDeviceId) {
      return res.status(403).json({
        success: false,
        error: 'Security Alert: This account is bound to another registered device.',
        code: 'DEVICE_MISMATCH'
      });
    }

    next();
  } catch (err) {
    console.error('[AuthMiddleware:verifyDeviceBinding] Error:', err);
    next();
  }
}

/**
 * Point 4: Single Active Device Real-time Session Check.
 * Verifies that the user session is active and not revoked in MongoDB.
 */
export async function verifyActiveSession(req, res, next) {
  if (!req.user || !req.user.userId) return next();

  try {
    const db = getMongoDb();
    if (!db) return next();

    const user = await db.collection('users').findOne(
      { userId: req.user.userId },
      { projection: { refreshToken: 1 } }
    );

    if (!user || !user.refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Session has been revoked or logged in on another device.',
        code: 'SESSION_REVOKED'
      });
    }

    next();
  } catch (err) {
    console.error('[AuthMiddleware:verifyActiveSession] Error:', err);
    next();
  }
}

