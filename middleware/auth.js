import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.js';

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
 * Anti-Scraping / App Handshake Guard.
 * Blocks unauthorized web scrapers or raw bots lacking internal app key.
 */
export function verifyAppSecret(req, res, next) {
  const clientAppSecret = req.headers['x-app-secret'];
  if (ENV.APP_SECRET_KEY && clientAppSecret && clientAppSecret !== ENV.APP_SECRET_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: App handshake verification failed.',
      code: 'INVALID_APP_SECRET'
    });
  }
  next();
}
