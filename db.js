import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import { MongoClient } from 'mongodb';

// Ensure DNS SRV lookups succeed across all ISPs and Windows environments
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB Atlas Client and State
let mongoClient = null;
let mongoDb = null;
let mongoReady = false;

export const DATA_DIR = path.join(__dirname, 'data');
export const NOTES_DIR = path.join(__dirname, 'data', 'study_notes');
export const DOWNLOADS_DIR = path.join(__dirname, '..', 'data', 'downloads');
export const USER_DATA_DIR = path.join(__dirname, 'data', 'user');

if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

// In-Memory Fast Cache populated directly from MongoDB Atlas
export const masterBySubject = {
  Physics: [],
  Chemistry: [],
  Botany: [],
  Zoology: [],
  Biology: []
};

export const masterByCategory = {
  daily_pool: [],
  dpp: [],
  chapterwise: [],
  chapterwise_pyqs: [],
  neet_papers: [],
  diagrams: [],
  repeated_pyqs: [],
  numericals: [],
  tough: [],
  mock_summary: [],
  mock_1: null,
  mock_2: null,
  mock_3: null
};

/**
 * Loads all questions directly from MongoDB Atlas into high-speed memory cache.
 * Any update in MongoDB Atlas is synced into this cache.
 */
export async function loadQuestionsFromMongo() {
  if (!mongoDb) {
    console.warn('[Database] Cannot load questions: MongoDB Atlas not connected.');
    return false;
  }

  console.log('[Database] Loading fresh questions directly from MongoDB Atlas...');
  const startTime = Date.now();

  try {
    // 1. Fetch all questions from 'questions' collection
    const allQuestions = await mongoDb.collection('questions').find({}).toArray();
    console.log(`[Database] Fetched ${allQuestions.length} total questions from MongoDB Atlas.`);

    // Reset subject buckets
    masterBySubject.Physics = [];
    masterBySubject.Chemistry = [];
    masterBySubject.Botany = [];
    masterBySubject.Zoology = [];
    masterBySubject.Biology = [];

    // Reset category buckets
    const catMap = {
      numericals: [],
      yearwise_pyq: [],
      chapterwise: [],
      repeated_pyq: [],
      dpp: [],
      tough: [],
      chapterwise_pyq: [],
      diagram_question: [],
      mixed_set: []
    };

    for (const q of allQuestions) {
      // Organize by subject
      const sub = q.subject || 'Biology';
      if (masterBySubject[sub]) {
        masterBySubject[sub].push(q);
      } else {
        masterBySubject.Biology.push(q);
      }

      // Organize by category
      const cat = q.category || 'mixed_set';
      if (catMap[cat]) {
        catMap[cat].push(q);
      }
    }

    masterByCategory.numericals = catMap.numericals;
    masterByCategory.neet_papers = catMap.yearwise_pyq;
    masterByCategory.chapterwise = catMap.chapterwise;
    masterByCategory.repeated_pyqs = catMap.repeated_pyq;
    masterByCategory.tough = catMap.tough;
    masterByCategory.chapterwise_pyqs = catMap.chapterwise_pyq;
    masterByCategory.diagrams = catMap.diagram_question;

    // 2. Fetch daily test pool
    const dailyPool = await mongoDb.collection('daily_test_pool').find({}).toArray();
    masterByCategory.daily_pool = dailyPool.length > 0 ? dailyPool : catMap.dpp;
    masterByCategory.dpp = masterByCategory.daily_pool;

    // 3. Fetch mock tests
    const mocks = await mongoDb.collection('mock_tests').find({}).toArray();
    masterByCategory.mock_summary = mocks.map(m => ({
      id: m.id || m._id,
      title: m.title,
      subtitle: m.subtitle || '',
      durationMinutes: m.durationMinutes || 200,
      totalQuestions: m.totalQuestions || (m.questions ? m.questions.length : 180),
      marks: m.marks || (m.questions ? m.questions.length * 4 : 720)
    }));

    for (const m of mocks) {
      const mockKey = m.id || m._id;
      masterByCategory[mockKey] = m;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Database] MongoDB Atlas cache ready in ${elapsed}s! Total: ${allQuestions.length} Qs in RAM.`);
    return true;
  } catch (err) {
    console.error('[Database] Failed to load questions from MongoDB Atlas:', err.message);
    return false;
  }
}

/**
 * Fast In-Memory Mutation Helpers (< 1ms execution time)
 * Keeps server RAM perfectly in sync with MongoDB without full re-fetching.
 */
export function addQuestionToMemory(q) {
  const sub = q.subject || 'Biology';
  if (masterBySubject[sub]) masterBySubject[sub].push(q);
  else masterBySubject.Biology.push(q);

  const cat = q.category || 'chapterwise';
  if (cat === 'yearwise_pyq') masterByCategory.neet_papers.push(q);
  else if (cat === 'diagram_question') masterByCategory.diagrams.push(q);
  else if (cat === 'repeated_pyq') masterByCategory.repeated_pyqs.push(q);
  else if (cat === 'chapterwise_pyq') masterByCategory.chapterwise_pyqs.push(q);
  else if (masterByCategory[cat] && Array.isArray(masterByCategory[cat])) masterByCategory[cat].push(q);
}

export function updateQuestionInMemory(qid, updates) {
  const updateItem = (item) => {
    if (item.id === qid || item._id === qid) {
      Object.assign(item, updates);
      return true;
    }
    return false;
  };

  for (const list of Object.values(masterBySubject)) {
    if (Array.isArray(list)) {
      for (const item of list) {
        if (updateItem(item)) break;
      }
    }
  }

  for (const list of Object.values(masterByCategory)) {
    if (Array.isArray(list)) {
      for (const item of list) {
        if (updateItem(item)) break;
      }
    }
  }
}

export function removeQuestionFromMemory(qid) {
  const filterOut = (list) => {
    const idx = list.findIndex(item => item.id === qid || item._id === qid);
    if (idx !== -1) list.splice(idx, 1);
  };

  for (const list of Object.values(masterBySubject)) {
    if (Array.isArray(list)) filterOut(list);
  }

  for (const list of Object.values(masterByCategory)) {
    if (Array.isArray(list)) filterOut(list);
  }
}

export async function reloadQuestionsFromMongo() {
  return await loadQuestionsFromMongo();
}

export async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[Database] No MONGODB_URI configured in environment.');
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
    console.log(`[Database] Successfully connected to MongoDB Atlas (${dbName})!`);

    // Immediately load all data into memory
    await loadQuestionsFromMongo();

    return mongoDb;
  } catch (err) {
    console.error(`[Database] MongoDB Atlas connection error (${err.message}).`);
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

  // Reliable fallback directly to Cloudflare R2 questions CDN
  return `https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/questions/${cleanName}.webp`;
}

export function sanitizeLatex(str) {
  if (!str || typeof str !== 'string') return str;
  let text = str.trim();

  // Strip wrapping $$...$$ or $...$
  text = text.replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\$([\s\S]*)\$$/, '$1');
  text = text.replace(/\$/g, '');

  // 1. Literal escaped newlines: \\n -> real newline
  text = text.replace(/\\n/g, '\n');

  // 2. Decode escaped unicode characters: \u03bc -> μ, \u2080 -> ₀, etc.
  text = text.replace(/\\+u([0-9a-fA-F]{4})/g, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch (_) {
      return _;
    }
  });

  // 3. Decode hex character codes: \xb2 -> ², \xd7 -> ×, etc.
  text = text.replace(/\\+x([0-9a-fA-F]{2})/g, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch (_) {
      return _;
    }
  });

  // 4. HTML entities
  text = text
    .replace(/&times;/gi, '×')
    .replace(/&plusmn;/gi, '±')
    .replace(/&micro;/gi, 'μ')
    .replace(/&deg;/gi, '°')
    .replace(/&alpha;/gi, 'α')
    .replace(/&beta;/gi, 'β')
    .replace(/&gamma;/gi, 'γ')
    .replace(/&pi;/gi, 'π')
    .replace(/&Delta;/gi, 'Δ')
    .replace(/&lambda;/gi, 'λ')
    .replace(/&sigma;/gi, 'σ')
    .replace(/&omega;/gi, 'ω')
    .replace(/&Omega;/gi, 'Ω')
    .replace(/&infin;/gi, '∞')
    .replace(/&le;/gi, '≤')
    .replace(/&ge;/gi, '≥')
    .replace(/&ne;/gi, '≠')
    .replace(/&rarr;/gi, '→')
    .replace(/&nbsp;/gi, ' ');

  // 5. LaTeX \text{...}, \mathrm{...}, \mathbf{...}, \textit{...}
  text = text.replace(/\\*(?:text|mathrm|mathbf|textit)\{([^}]+)\}/g, '$1');

  // 6. LaTeX fractions: \frac{a}{b} -> (a / b)
  text = text.replace(/\\+frac\{([^}]+)\}\{([^}]+)\}/g, '($1 / $2)');

  // 7. Common LaTeX math symbols before stripping backslashes
  const latexSymbols = [
    [/\\+times\b/g, '×'],
    [/\\+cdot\b/g, '·'],
    [/\\+pm\b/g, '±'],
    [/\\+mp\b/g, '∓'],
    [/\\+mu_0\b/g, 'μ₀'],
    [/\\+mu_\{0\}/g, 'μ₀'],
    [/\\+mu\b/g, 'μ'],
    [/\\+pi\b/g, 'π'],
    [/\\+theta\b/g, 'θ'],
    [/\\+alpha\b/g, 'α'],
    [/\\+beta\b/g, 'β'],
    [/\\+gamma\b/g, 'γ'],
    [/\\+lambda\b/g, 'λ'],
    [/\\+sigma\b/g, 'σ'],
    [/\\+omega\b/g, 'ω'],
    [/\\+Omega\b/g, 'Ω'],
    [/\\+Delta\b/g, 'Δ'],
    [/\\+rightarrow\b/g, '→'],
    [/\\+to\b/g, '→'],
    [/\\+leftarrow\b/g, '←'],
    [/\\+leftrightarrow\b/g, '↔'],
    [/\\+degree\b/g, '°'],
    [/\\+circ\b/g, '°'],
    [/\\+approx\b/g, '≈'],
    [/\\+neq\b/g, '≠'],
    [/\\+leq\b/g, '≤'],
    [/\\+geq\b/g, '≥'],
    [/\\+infty\b/g, '∞'],
    [/\\+sqrt\{([^}]+)\}/g, '√($1)'],
    [/\\+sqrt\b/g, '√'],
  ];
  for (const [rgx, rep] of latexSymbols) {
    text = text.replace(rgx, rep);
  }

  // 8. LaTeX sub/super scripts
  const subMap = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎','a':'ₐ','e':'ₑ','i':'ᵢ','o':'ₒ','u':'ᵤ','r':'ᵣ','x':'ₓ'};
  text = text.replace(/_\{([^}]+)\}/g, (_, inner) => inner.split('').map(c => subMap[c] || c).join(''));
  text = text.replace(/_([0-9\+\-\(\)a-zA-Z])/g, (_, c) => subMap[c] || c);

  const supMap = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾','n':'ⁿ','x':'ˣ','y':'ʸ'};
  text = text.replace(/\^\{([^}]+)\}/g, (_, inner) => inner.split('').map(c => supMap[c] || c).join(''));
  text = text.replace(/\^([0-9\+\-\(\)a-zA-Z])/g, (_, c) => supMap[c] || c);

  // 9. Remove any remaining isolated backslashes
  text = text.replace(/\\/g, '');

  return text.trim();
}

export function formatQuestion(q, req) {
  const rawOptions = Array.isArray(q.options) && q.options.length > 0 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'];
  const sanitizedQuestion = sanitizeLatex(q.questionText || q.question || '');

  return {
    id: q.id || q._id,
    subject: q.subject || 'NEET',
    chapter: q.chapter || 'General',
    category: q.category || 'practice',
    year: q.year || null,
    question: sanitizedQuestion,
    questionImage: resolveImageUrl(q.questionImg, 'questions', req),
    options: rawOptions.map(opt => sanitizeLatex(String(opt))),
    answer: typeof q.correctIndex === 'number' ? q.correctIndex : (q.answerIndex || 0),
    explanation: sanitizeLatex(q.explanation || ''),
    explanationImage: resolveImageUrl(q.explanationImg, 'solutions', req)
  };
}
