import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    dpp: path.join(DATA_DIR, 'by_category', 'dpp', 'dpp_all.json'),
    chapterwise: path.join(DATA_DIR, 'by_category', 'chapterwise', 'chapterwise_all.json'),
    chapterwise_pyqs: path.join(DATA_DIR, 'by_category', 'chapterwise', 'chapterwise_pyqs.json'),
    neet_papers: path.join(DATA_DIR, 'by_category', 'pyq_papers', 'neet_papers_2015_2024.json'),
    diagrams: path.join(DATA_DIR, 'by_category', 'diagrams', 'diagram_questions.json'),
    repeated_pyqs: path.join(DATA_DIR, 'by_category', 'repeated_pyqs', 'repeated_pyqs.json'),
  };

  for (const [k, fPath] of Object.entries(catFiles)) {
    if (fs.existsSync(fPath)) {
      masterByCategory[k] = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
    }
  }
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

export function formatQuestion(q, req) {
  return {
    id: q.id,
    subject: q.subject || 'NEET',
    chapter: q.chapter || 'General',
    category: q.category || 'practice',
    year: q.year || null,
    question: q.questionText || '',
    questionImage: resolveImageUrl(q.questionImg, 'questions', req),
    options: Array.isArray(q.options) && q.options.length > 0 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'],
    answer: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
    explanation: q.explanation || '',
    explanationImage: resolveImageUrl(q.explanationImg, 'solutions', req)
  };
}
