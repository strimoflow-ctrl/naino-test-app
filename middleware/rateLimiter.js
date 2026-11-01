import rateLimit from 'express-rate-limit';
import { getMongoDb } from '../db.js';
import { getClientIp } from '../config/env.js';

/**
 * Standard IP Rate Limiter for general auth endpoints (30 requests per 15 min per IP)
 */
export const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: 'Too many authentication attempts from this network. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
});

/**
 * Tiered Exponential OTP Rate Limiter (Enforced 100% in MongoDB Atlas by Email):
 * - Max 3 OTP requests per cycle.
 * - After 3 requests:
 *     Cycle 1 lockout: 9 minutes.
 *     Cycle 2 lockout: 18 minutes (9 * 2).
 *     Cycle 3 lockout: 27 minutes (9 * 3), etc.
 * - Tracks client IP address on each attempt.
 */
export async function checkOtpRateLimit(email, clientIp) {
  const cleanEmail = email.trim().toLowerCase();
  const db = getMongoDb();
  if (!db) return { allowed: true };

  const rateCol = db.collection('otp_rate_limits');
  const now = new Date();
  const record = await rateCol.findOne({ _id: cleanEmail });

  // 1. Check if user is currently locked out
  if (record && record.lockedUntil && record.lockedUntil > now) {
    const remainingMs = record.lockedUntil.getTime() - now.getTime();
    const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    return {
      allowed: false,
      error: `You have reached the maximum OTP limit (3 attempts). Please wait ${remainingMinutes} minute(s) before requesting another code.`,
      lockedUntil: record.lockedUntil,
      retryAfterMinutes: remainingMinutes,
      retryAfterSeconds: remainingSeconds
    };
  }

  // 2. Initialize or increment attempt count
  let currentAttempts = 1;
  let lockoutCount = record ? (record.lockoutCount || 0) : 0;

  if (record) {
    // If previous lockout expired, reset attempts to 1 and keep track of lockout cycle
    if (record.lockedUntil && record.lockedUntil <= now) {
      currentAttempts = 1;
    } else {
      currentAttempts = (record.attemptsCount || 0) + 1;
    }
  }

  // 3. Check if this is the 3rd attempt in current cycle
  let lockedUntil = null;
  if (currentAttempts >= 3) {
    // Increment lockout penalty: 9 mins, 18 mins, 27 mins, etc.
    const penaltyMultiplier = lockoutCount + 1;
    const lockoutMinutes = 9 * penaltyMultiplier;
    lockedUntil = new Date(now.getTime() + lockoutMinutes * 60 * 1000);
    lockoutCount += 1;
  }

  // 4. Update MongoDB record with IP tracking
  await rateCol.updateOne(
    { _id: cleanEmail },
    {
      $set: {
        attemptsCount: currentAttempts,
        lockoutCount,
        lockedUntil,
        lastAttemptIp: clientIp,
        updatedAt: now
      },
      $push: {
        attemptHistory: {
          $each: [{ ip: clientIp, timestamp: now, attemptNumber: currentAttempts }],
          $slice: -10 // Keep last 10 attempts
        }
      }
    },
    { upsert: true }
  );

  return {
    allowed: true,
    attemptsLeft: Math.max(0, 3 - currentAttempts),
    lockoutScheduled: lockedUntil != null,
    lockoutMinutes: lockedUntil != null ? 9 * lockoutCount : 0
  };
}

