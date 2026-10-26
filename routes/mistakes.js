import express from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../db.js';

const router = express.Router();
const MISTAKES_FILE = path.join(DATA_DIR, 'user_mistakes.json');

let userMistakes = [];
if (fs.existsSync(MISTAKES_FILE)) {
  try {
    userMistakes = JSON.parse(fs.readFileSync(MISTAKES_FILE, 'utf-8'));
  } catch (_) {
    userMistakes = [];
  }
}

function saveMistakesToDisk() {
  try {
    fs.writeFileSync(MISTAKES_FILE, JSON.stringify(userMistakes, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving mistakes to disk:', err);
  }
}

// 1. GET all mistakes
router.get('/', (req, res) => {
  const { subject } = req.query;
  let results = userMistakes;
  if (subject && subject !== 'All') {
    results = results.filter(m => (m.subject || '').toLowerCase() === subject.toLowerCase());
  }
  res.json({
    totalMistakes: results.length,
    mistakes: results
  });
});

// 2. POST add/update mistakes (deduplicating by ID and question text)
router.post('/', (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  let addedCount = 0;

  for (const item of items) {
    if (!item) continue;
    const itemId = String(item.id || '');
    const itemQ = (item.question || '').trim().toLowerCase();

    const existingIndex = userMistakes.findIndex(m => {
      const mId = String(m.id || '');
      const mQ = (m.question || '').trim().toLowerCase();
      return (itemId && mId === itemId) || (itemQ && mQ && itemQ === mQ);
    });

    const entry = {
      ...item,
      addedAt: item.addedAt || new Date().toISOString()
    };
    if (existingIndex >= 0) {
      userMistakes[existingIndex] = entry;
    } else {
      userMistakes.unshift(entry);
    }
    addedCount++;
  }

  saveMistakesToDisk();
  res.json({ success: true, addedCount, totalMistakes: userMistakes.length });
});

// 2.5 SYNC test submission: Remove questions answered correctly, add/update wrong ones
router.post('/sync-test', (req, res) => {
  const { mistakes = [], resolvedIds = [] } = req.body;

  // 1. Remove resolved questions (questions answered correctly in this attempt)
  if (Array.isArray(resolvedIds) && resolvedIds.length > 0) {
    const resolvedSet = new Set(resolvedIds.map(String));
    userMistakes = userMistakes.filter(m => !resolvedSet.has(String(m.id)));
  }

  // 2. Add or update wrong questions (deduplicated by id and question text)
  let addedCount = 0;
  for (const item of mistakes) {
    if (!item) continue;
    const itemId = String(item.id || '');
    const itemQ = (item.question || '').trim().toLowerCase();

    const existingIndex = userMistakes.findIndex(m => {
      const mId = String(m.id || '');
      const mQ = (m.question || '').trim().toLowerCase();
      return (itemId && mId === itemId) || (itemQ && mQ && itemQ === mQ);
    });

    const entry = {
      ...item,
      addedAt: item.addedAt || new Date().toISOString()
    };

    if (existingIndex >= 0) {
      userMistakes[existingIndex] = entry; // Update attempt, zero duplication
    } else {
      userMistakes.unshift(entry);
    }
    addedCount++;
  }

  saveMistakesToDisk();
  res.json({
    success: true,
    totalMistakes: userMistakes.length,
    resolvedCount: resolvedIds.length,
    addedCount
  });
});

// 3. DELETE single mistake
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const initialLen = userMistakes.length;
  userMistakes = userMistakes.filter(m => String(m.id) !== String(id));
  saveMistakesToDisk();
  res.json({ success: true, removed: initialLen - userMistakes.length, totalMistakes: userMistakes.length });
});

// 4. DELETE all mistakes
router.delete('/', (req, res) => {
  userMistakes = [];
  saveMistakesToDisk();
  res.json({ success: true, totalMistakes: 0 });
});

export default router;
