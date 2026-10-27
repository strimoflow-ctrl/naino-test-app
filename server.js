import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { DOWNLOADS_DIR, masterBySubject, connectMongo, isMongoConnected } from './db.js';
import testsRouter from './routes/tests.js';
import pyqsRouter from './routes/pyqs.js';
import libraryRouter from './routes/library.js';
import mistakesRouter from './routes/mistakes.js';
import userRouter from './routes/user.js';
import configRouter from './routes/config.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Cloud-First Media Redirects (Cloudflare R2 Direct CDN Offload)
const manifestPaths = [
  path.join(__dirname, 'cloud_manifest.json'),
  path.join(__dirname, 'data', 'cloud_manifest.json'),
  path.join(DOWNLOADS_DIR, '..', 'cloud_manifest.json')
];
const getManifestPath = () => manifestPaths.find(p => fs.existsSync(p)) || manifestPaths[0];

let cloudManifest = {};
const loadManifest = () => {
  const mPath = getManifestPath();
  if (fs.existsSync(mPath)) {
    try {
      cloudManifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    } catch (_) {}
  }
};
loadManifest();

app.get('/media/pdfs/:filename', (req, res, next) => {
  const { filename } = req.params;
  if (!cloudManifest[filename]) loadManifest();
  if (cloudManifest[filename] && cloudManifest[filename].r2_url) {
    return res.redirect(302, cloudManifest[filename].r2_url);
  }
  next();
});

if (fs.existsSync(DOWNLOADS_DIR)) {
  app.use('/media/pdfs', express.static(path.join(DOWNLOADS_DIR, 'pdfs')));
  app.use('/media/questions', express.static(path.join(DOWNLOADS_DIR, 'question_images')));
  app.use('/media/solutions', express.static(path.join(DOWNLOADS_DIR, 'solution_images')));
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

// 3. Mount Modular Routes
app.use('/api', configRouter);           // /api/app-config, /api/home-layout, /api/dynamic-chapters, /api/study-materials
app.use('/api', testsRouter);            // /api/daily-test, /api/chapters, /api/dpp, /api/diagrams
app.use('/api/pyq', pyqsRouter);         // /api/pyq/papers, /api/pyq/paper/:year
app.use('/api', libraryRouter);          // /api/notes, /api/library/books
app.use('/api/mistakes', mistakesRouter);// /api/mistakes (GET, POST, DELETE)
app.use('/api/user', userRouter);        // /api/user/streak, /api/user/profile, /api/user/bookmarks

// Compatibility fallback for /api/bookmarks
app.use('/api', userRouter);

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
