import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'naino_neet_default_jwt_secret_2026';
const APP_SECRET_KEY = process.env.APP_SECRET_KEY || 'naino_secret_mobile_handshake_2026';

/**
 * Strict Bearer Token Verification Middleware.
 * Returns 401 with code 'TOKEN_EXPIRED' so the mobile client knows to execute silent refresh.
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
    const decoded = jwt.verify(token, JWT_SECRET);
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
 * Optional Token Middleware: Extracts user if token is present and valid,
 * but allows guest users to proceed if missing.
 */
export function optionalToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      // Ignore token failure in optional mode
    }
  }
  next();
}

/**
 * Anti-Scraping / App Handshake Guard.
 * Blocks unauthorized web scrapers or raw curl requests that lack the internal app key.
 */
export function verifyAppSecret(req, res, next) {
  const clientAppSecret = req.headers['x-app-secret'];
  if (APP_SECRET_KEY && clientAppSecret && clientAppSecret !== APP_SECRET_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: App handshake verification failed.',
      code: 'INVALID_APP_SECRET'
    });
  }
  next();
}

