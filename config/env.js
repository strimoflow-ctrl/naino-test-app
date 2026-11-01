import 'dotenv/config';

export const ENV = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'production',

  // MongoDB Atlas
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://pankajkushwaha20093_db_user:N96BNSgzTD99kqLO@nainoneettest.wtw6lru.mongodb.net/?retryWrites=true&w=majority',
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || 'naino_neet_db',

  // Dual-Token JWT Configuration
  JWT_SECRET: process.env.JWT_SECRET || 'naino_neet_jwt_super_access_secret_key_2026_xyz99',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'naino_neet_jwt_refresh_secure_secret_key_2026_abc88',
  ACCESS_TOKEN_EXPIRY: '1h',
  REFRESH_TOKEN_EXPIRY: '60d',

  // Anti-Scraping Mobile Handshake Secret
  APP_SECRET_KEY: process.env.APP_SECRET_KEY || 'naino_secret_mobile_handshake_2026',

  // Email API Keys & Credentials
  RESEND_API_KEY: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.trim() : null,
  BREVO_API_KEY: process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.trim() : null,
  SMTP_USER: process.env.SMTP_USER ? process.env.SMTP_USER.trim() : null,
  SMTP_PASS: process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : null,
};

/**
 * Extracts the real client IP address behind reverse proxies (Cloudflare, Render)
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
