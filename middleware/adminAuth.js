import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { ENV, getClientIp } from '../config/env.js';

/**
 * Brute-Force Shield for Admin Login: Max 5 attempts per 15 minutes per IP
 */
export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: 'Too many admin login attempts from this network. Locked for 15 minutes for security.',
    code: 'ADMIN_BRUTE_FORCE_LOCKED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
});

/**
 * General Admin Action Rate Limiter: Max 300 actions per 15 minutes per IP
 */
export const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: {
    success: false,
    error: 'Admin request rate exceeded. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
});

/**
 * Strict Admin Token Guard:
 * Rejects standard user tokens or forged signatures.
 * Requires role: 'super_admin' inside signed JWT.
 */
export function verifyAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Admin authorization denied. Valid Bearer token required.',
      code: 'ADMIN_TOKEN_MISSING'
    });
  }

  const token = authHeader.split(' ')[1];
  const secret = ENV.ADMIN_JWT_SECRET || ENV.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({
      success: false,
      error: 'Server security misconfiguration: Admin secret is not configured.'
    });
  }

  try {
    const decoded = jwt.verify(token, secret);
    
    // Strict role check
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Insufficient privileges. Only Super Admin can access this resource.',
        code: 'ACCESS_DENIED_NOT_ADMIN'
      });
    }

    req.admin = decoded; // { username, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Admin session has expired. Please log in again.',
        code: 'ADMIN_TOKEN_EXPIRED'
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Invalid or forged Admin token.',
      code: 'ADMIN_TOKEN_INVALID'
    });
  }
}

