import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { DOWNLOADS_DIR, masterBySubject, connectMongo, isMongoConnected, reloadQuestionsFromMongo } from './db.js';
import testsRouter from './routes/tests.js';
import pyqsRouter from './routes/pyqs.js';
import libraryRouter from './routes/library.js';
import userRouter from './routes/user.js';
import configRouter from './routes/config.js';
import authRouter from './routes/auth.js';
import bannersRouter from './routes/banners.js';
import notificationsRouter from './routes/notifications.js';
import analyticsRouter from './routes/analytics.js';
import adminRouter from './routes/admin.js';
import { verifyAppSecret } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy (Cloudflare/Render) for accurate IP rate limiting
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Cloud-First Media Redirects (100% Cloudflare R2 Direct CDN Offload)
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_URL || 'https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev';

app.get('/media/pdfs/:filename', (req, res) => {
  const { filename } = req.params;
  return res.redirect(302, `${R2_PUBLIC_BASE}/pdfs/${filename}`);
});

app.get('/media/questions/:filename', (req, res) => {
  const clean = req.params.filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  return res.redirect(302, `${R2_PUBLIC_BASE}/questions/${clean}.webp`);
});

app.get('/media/solutions/:filename', (req, res) => {
  const clean = req.params.filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  return res.redirect(302, `${R2_PUBLIC_BASE}/questions/${clean}.webp`);
});

const publicBannersDir = path.join(__dirname, 'public', 'banners');
if (fs.existsSync(publicBannersDir)) {
  app.use('/media/banners', express.static(publicBannersDir));
}

// Serve Super Admin Web Dashboard
const adminDistPaths = [
  path.join(__dirname, 'public', 'admin'),
  path.join(__dirname, '..', 'admin', 'dist')
];
const adminDistPath = adminDistPaths.find(p => fs.existsSync(p));
if (adminDistPath) {
  app.use('/admin', express.static(adminDistPath));
  app.get('/admin', (req, res) => res.redirect('/admin/'));
  app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(adminDistPath, 'index.html'));
  });
}

// 2. Health & 24/7 Uptime Keep-Alive Check (Supports HEAD & GET for UptimeRobot / Cron pings)
app.head('/', (req, res) => res.status(200).end());
app.get('/', (req, res) => res.send('Naino NEET API is online and running 24/7!'));
app.head('/ping', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => res.status(200).send('pong'));

// Dedicated /status route for UptimeRobot / Better Uptime
app.head('/status', (req, res) => res.status(200).end());
app.get('/status', (req, res) => {
  const total = Object.values(masterBySubject).reduce((acc, curr) => acc + curr.length, 0);
  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  
  res.status(200).json({
    status: 'ONLINE',
    app: 'Naino NEET Backend API',
    uptimeSeconds,
    uptimeFormatted: `${hours}h ${minutes}m ${seconds}s`,
    database: isMongoConnected() ? 'MONGODB_ATLAS' : 'LOCAL_IN_MEMORY',
    totalQuestions: total,
    timestamp: new Date().toISOString()
  });
});

app.head('/api/health', (req, res) => res.status(200).end());
app.get('/api/health', (req, res) => {
  const total = Object.values(masterBySubject).reduce((acc, curr) => acc + curr.length, 0);
  res.json({
    status: 'ONLINE',
    app: 'Naino – NEET Tests & PYQs API (Modular Architecture)',
    database: isMongoConnected() ? 'MONGODB_ATLAS' : 'LOCAL_IN_MEMORY',
    totalQuestions: total,
    timestamp: new Date().toISOString()
  });
});

// 2.5 Dedicated Super Admin Dashboard APIs (Secured by Admin JWT & Brute Force Guard)
app.use('/api/admin', adminRouter);

// 3. Mount Modular Routes & Security Middleware
app.use(verifyAppSecret);
app.use('/api/auth', authRouter);              // /api/auth/signup, /api/auth/login, /api/auth/google, /api/auth/refresh-token
app.use('/api', bannersRouter);               // /api/banners (GET, POST, PUT, DELETE)
app.use('/api', configRouter);                 // /api/app-config, /api/home-layout, /api/dynamic-chapters, /api/study-materials
app.use('/api', testsRouter);                  // /api/daily-test, /api/chapters, /api/dpp, /api/diagrams
app.use('/api/pyq', pyqsRouter);               // /api/pyq/papers, /api/pyq/paper/:year
app.use('/api', libraryRouter);                // /api/notes, /api/library/books
app.use('/api/user', userRouter);              // /api/user/streak, /api/user/profile, /api/user/bookmarks
app.use('/api/notifications', notificationsRouter); // /api/notifications/register-token, /list, /broadcast
app.use('/api/analytics', analyticsRouter);         // /api/analytics/heartbeat, /api/analytics/events-batch

// Compatibility fallback for /api/bookmarks
app.use('/api', userRouter);

// Admin Live Database Cache Reload (Sync from MongoDB Atlas without server restart)
app.post('/api/admin/reload-database', async (req, res) => {
  try {
    const success = await reloadQuestionsFromMongo();
    const total = Object.values(masterBySubject).reduce((acc, curr) => acc + curr.length, 0);
    res.json({
      success,
      message: success ? 'Questions synced live from MongoDB Atlas!' : 'Failed to sync questions from MongoDB Atlas.',
      totalQuestions: total,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Start Server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n=================================================`);
  console.log(`NAINO NEET MODULAR BACKEND SERVER RUNNING ON PORT ${PORT}`);
  console.log(`Local Status: http://localhost:${PORT}/status`);
  console.log(`Local Health: http://localhost:${PORT}/api/health`);
  console.log(`=================================================\n`);
  
  // Connect to MongoDB Atlas if MONGODB_URI is provided in environment
  await connectMongo();
});
