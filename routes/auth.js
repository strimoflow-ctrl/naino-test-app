import express from 'express';
import { authIpLimiter } from '../middleware/rateLimiter.js';
import * as authController from '../controllers/authController.js';
import * as passwordResetController from '../controllers/passwordResetController.js';

const router = express.Router();

// ==========================================
// 🔐 AUTHENTICATION ENDPOINTS
// ==========================================

// 1. SIGNUP: Name, Email & Password with IP Tracking
router.post('/signup', authIpLimiter, authController.signup);

// 2. LOGIN: Email & Password with precise error reporting & IP Tracking
router.post('/login', authIpLimiter, authController.login);

// 3. GOOGLE: One-Tap Google Authentication
router.post('/google', authIpLimiter, authController.googleAuth);

// 4. REFRESH TOKEN: Silent background session refresh
router.post('/refresh-token', authController.refreshToken);

// 5. LOGOUT: Invalidate active refresh tokens
router.post('/logout', authController.logout);


// ==========================================
// 🔑 PASSWORD RECOVERY & OTP ENDPOINTS
// ==========================================

// 6. FORGOT PASSWORD: Send 6-digit OTP (Tiered limit: 3 attempts, then 9m, 18m...)
router.post('/forgot-password', authController.generateTokens ? passwordResetController.forgotPassword : passwordResetController.forgotPassword);

// 7. VERIFY RESET OTP: Verify 6-digit code
router.post('/verify-reset-otp', passwordResetController.verifyResetOtp);

// 8. RESET PASSWORD: Set new password and revoke old sessions
router.post('/reset-password', passwordResetController.resetPassword);

export default router;
