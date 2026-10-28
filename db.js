import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB Atlas Client and State
let mongoClient = null;
let mongoDb = null;
let mongoReady = false;

export async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[Database] No MONGODB_URI in environment. Operating with high-speed in-memory JSON.');
    return null;
  }
  try {
    console.log('[Database] Connecting to MongoDB Atlas...');
    mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000
    });
    await mongoClient.connect();
    const dbName = process.env.MONGODB_DB_NAME || 'naino_neet_db';
    mongoDb = mongoClient.db(dbName);
    mongoReady = true;
    console.log(`[Database] Successfully connected to MongoDB Atlas database: ${dbName}!`);
    return mongoDb;
  } catch (err) {
    console.warn(`[Database] MongoDB Atlas connection error (${err.message}). Seamlessly using in-memory JSON fallback.`);
    mongoReady = false;
    return null;
  }
}

export function getMongoDb() {
  return mongoDb;
}

export function isMongoConnected() {
  return mongoReady;
}

export const DATA_DIR = path.join(__dirname, 'data', 'master_database');
export const NOTES_DIR = path.join(__dirname, 'data', 'study_notes');
export const DOWNLOADS_DIR = path.join(__dirname, '..', 'data', 'downloads');
export const USER_DATA_DIR = path.join(__dirname, 'data', 'user');

if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

export const masterBySubject = {
  Physics: [],
  Chemistry: [],
  Botany: [],
  Zoology: [],
  Biology: []
};

export const masterByCategory = {};

console.log('Loading Master Database into Memory...');

try {
  const subFiles = ['physics', 'chemistry', 'botany', 'zoology', 'biology'];
  for (const s of subFiles) {
    const fPath = path.join(DATA_DIR, 'by_subject', `${s}_master.json`);
    if (fs.existsSync(fPath)) {
      const data = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
      const subName = s.charAt(0).toUpperCase() + s.slice(1);
      masterBySubject[subName] = data;
      console.log(`  Loaded ${subName}: ${data.length} Qs`);
    }
  }

  const catFiles = {
    daily_pool: path.join(DATA_DIR, 'by_category', 'daily_20_questions', 'daily_20_questions_pool.json'),
    chapterwise: path.join(DATA_DIR, 'by_category', 'chapterwise', 'chapterwise_all.json'),
    chapterwise_pyqs: path.join(DATA_DIR, 'by_category', 'chapterwise', 'chapterwise_pyqs.json'),
    neet_papers: path.join(DATA_DIR, 'by_category', 'pyq_papers', 'neet_papers_2015_2024.json'),
    diagrams: path.join(DATA_DIR, 'by_category', 'diagrams', 'diagram_questions.json'),
    repeated_pyqs: path.join(DATA_DIR, 'by_category', 'repeated_pyqs', 'repeated_pyqs.json'),
    numericals: path.join(DATA_DIR, 'by_category', 'challenger_mode', 'numericals.json'),
    tough: path.join(DATA_DIR, 'by_category', 'challenger_mode', 'tough_questions.json'),
    mock_summary: path.join(DATA_DIR, 'by_category', 'mock_tests', 'all_mock_tests.json'),
    mock_1: path.join(DATA_DIR, 'by_category', 'mock_tests', 'mock_1.json'),
    mock_2: path.join(DATA_DIR, 'by_category', 'mock_tests', 'mock_2.json'),
    mock_3: path.join(DATA_DIR, 'by_category', 'mock_tests', 'mock_3.json'),
  };

  for (const [k, fPath] of Object.entries(catFiles)) {
    if (fs.existsSync(fPath)) {
      masterByCategory[k] = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
    }
  }
  // Alias dpp to daily_pool for backward compatibility
  masterByCategory.dpp = masterByCategory.daily_pool || [];
  console.log('Master Database Ready!');
} catch (err) {
  console.error('Error loading database:', err);
}

const imgManifestPaths = [
  path.join(__dirname, 'image_manifest.json'),
  path.join(__dirname, 'data', 'image_manifest.json'),
  path.join(__dirname, '..', 'data', 'image_manifest.json')
];
let imageManifest = {};
export const loadImageManifest = () => {
  for (const p of imgManifestPaths) {
    if (fs.existsSync(p)) {
      try {
        imageManifest = JSON.parse(fs.readFileSync(p, 'utf8'));
        break;
      } catch (_) {}
    }
  }
};
loadImageManifest();

export function resolveImageUrl(img, type = 'questions', req) {
  if (!img) return null;
  if (img.startsWith('http://') || img.startsWith('https://')) return img;
  let filename = img.trim();
  if (!filename.includes('.')) filename += '.png';

  // Check 3rd party cloud CDN manifest
  if (imageManifest[filename] && imageManifest[filename].url) {
    return imageManifest[filename].url;
  }
  const cleanName = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  if (imageManifest[cleanName] && imageManifest[cleanName].url) {
    return imageManifest[cleanName].url;
  }

  const baseUrl = process.env.R2_PUBLIC_URL || `${req.protocol}://${req.get('host')}/media/${type}`;
  return `${baseUrl}/${filename}`;
}

export function sanitizeLatex(str) {
  if (!str || typeof str !== 'string') return str;
  let text = str.trim();
  text = text.replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\$([\s\S]*)\$$/, '$1');
  text = text.replace(/\$/g, '');
  text = text.replace(/\\*(?:text|mathrm|mathbf|textit)\{([^}]+)\}/g, '$1');
  const subMap = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎','a':'ₐ','e':'ₑ','i':'ᵢ','o':'ₒ','u':'ᵤ','r':'ᵣ','x':'ₓ'};
  text = text.replace(/_\{([^}]+)\}/g, (_, inner) => inner.split('').map(c => subMap[c] || c).join(''));
  text = text.replace(/_([0-9\+\-\(\)a-zA-Z])/g, (_, c) => subMap[c] || c);
  const supMap = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾','n':'ⁿ','x':'ˣ','y':'ʸ'};
  text = text.replace(/\^\{([^}]+)\}/g, (_, inner) => inner.split('').map(c => supMap[c] || c).join(''));
  text = text.replace(/\^([0-9\+\-\(\)a-zA-Z])/g, (_, c) => supMap[c] || c);
  text = text.replace(/\\/g, '');
  return text.trim();
}

export function formatQuestion(q, req) {
  const rawOptions = Array.isArray(q.options) && q.options.length > 0 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'];
  return {
    id: q.id,
    subject: q.subject || 'NEET',
    chapter: q.chapter || 'General',
    category: q.category || 'practice',
    year: q.year || null,
    question: sanitizeLatex(q.questionText || ''),
    questionImage: resolveImageUrl(q.questionImg, 'questions', req),
    options: rawOptions.map(opt => sanitizeLatex(String(opt))),
    answer: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
    explanation: sanitizeLatex(q.explanation || ''),
    explanationImage: resolveImageUrl(q.explanationImg, 'solutions', req)
  };
}
