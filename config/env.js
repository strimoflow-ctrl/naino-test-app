import 'dotenv/config';

export const ENV = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'production',

  // MongoDB Atlas (Loaded securely from Environment Variables on Render / .env)
  MONGODB_URI: process.env.MONGODB_URI ? process.env.MONGODB_URI.trim() : '',
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME ? process.env.MONGODB_DB_NAME.trim() : 'naino_neet_db',

  // Dual-Token JWT Configuration (Strictly from Environment)
  JWT_SECRET: process.env.JWT_SECRET ? process.env.JWT_SECRET.trim() : '',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ? process.env.JWT_REFRESH_SECRET.trim() : '',
  ACCESS_TOKEN_EXPIRY: '1h',
  REFRESH_TOKEN_EXPIRY: '60d',

  // Anti-Scraping Mobile Handshake Secret (Strictly from Environment)
  APP_SECRET_KEY: process.env.APP_SECRET_KEY ? process.env.APP_SECRET_KEY.trim() : '',

  // Super Admin Control Credentials (Strictly from Environment)
  ADMIN_USERNAME: process.env.ADMIN_USERNAME ? process.env.ADMIN_USERNAME.trim() : 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.trim() : '',
  ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET ? process.env.ADMIN_JWT_SECRET.trim() : '',

  // Email API Keys & Credentials
  RESEND_API_KEY: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.trim() : null,
  BREVO_API_KEY: process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.trim() : null,
  SMTP_USER: process.env.SMTP_USER ? process.env.SMTP_USER.trim() : null,
  SMTP_PASS: process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : null,
};

// Security Check in Production: Alert if critical secrets are missing
if (ENV.NODE_ENV === 'production') {
  if (!ENV.MONGODB_URI) console.warn('[Security Alert] MONGODB_URI is not set in environment!');
  if (!ENV.JWT_SECRET) console.warn('[Security Alert] JWT_SECRET is not set in environment!');
  if (!ENV.APP_SECRET_KEY) console.warn('[Security Alert] APP_SECRET_KEY is not set in environment!');
}

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
