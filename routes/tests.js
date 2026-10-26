import express from 'express';
import { masterBySubject, masterByCategory, formatQuestion } from '../db.js';

const router = express.Router();

// 1. Daily Live Test (7:00 PM IST)
router.get('/daily-test', (req, res) => {
  const now = new Date();
  const istDate = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];

  let seed = 0;
  for (let i = 0; i < istDate.length; i++) {
    seed = (seed * 31 + istDate.charCodeAt(i)) & 0xffffffff;
  }

  const pickQuestions = (list, count, offset) => {
    if (!list || list.length === 0) return [];
    const results = [];
    const step = Math.max(1, Math.floor(list.length / count));
    for (let i = 0; i < count; i++) {
      const idx = (Math.abs(seed + offset + (i * step))) % list.length;
      results.push(formatQuestion(list[idx], req));
    }
    return results;
  };

  const phyQs = pickQuestions(masterBySubject.Physics, 5, 101);
  const chemQs = pickQuestions(masterBySubject.Chemistry, 5, 202);
  const botQs = pickQuestions(masterBySubject.Botany, 5, 303);
  const zooQs = pickQuestions(masterBySubject.Zoology, 5, 404);

  const testQuestions = [...phyQs, ...chemQs, ...botQs, ...zooQs];

  res.json({
    testId: `daily_${istDate}`,
    title: 'Daily 7:00 PM Live NEET Test',
    date: istDate,
    durationMinutes: 20,
    totalQuestions: testQuestions.length,
    questions: testQuestions
  });
});

// 2. Chapters for a Subject
router.get('/chapters', (req, res) => {
  const { subject } = req.query;
  if (!subject) {
    return res.status(400).json({ error: 'Subject query parameter required' });
  }

  const subName = subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();
  const qs = masterBySubject[subName] || [];

  const chapterCounts = {};
  for (const q of qs) {
    const ch = q.chapter || 'General Concepts';
    chapterCounts[ch] = (chapterCounts[ch] || 0) + 1;
  }

  const chapters = Object.keys(chapterCounts).map(name => ({
    name,
    questionCount: chapterCounts[name]
  }));

  res.json({
    subject: subName,
    totalChapters: chapters.length,
    totalQuestions: qs.length,
    chapters
  });
});

// 3. Questions for a specific chapter
router.get('/chapters/:subject/:chapterName/questions', (req, res) => {
  const { subject, chapterName } = req.params;
  const subName = subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();
  const qs = masterBySubject[subName] || [];

  const targetName = decodeURIComponent(chapterName).toLowerCase();
  const filtered = qs.filter(q => (q.chapter || '').toLowerCase() === targetName);
  const limit = parseInt(req.query.limit) || 25;

  res.json({
    subject: subName,
    chapter: chapterName,
    total: filtered.length,
    questions: filtered.slice(0, limit).map(q => formatQuestion(q, req))
  });
});

// 4. DPP Questions
router.get('/dpp', (req, res) => {
  const dpps = masterByCategory.dpp || [];
  const limit = parseInt(req.query.limit) || 20;
  const subject = req.query.subject;

  let filtered = dpps;
  if (subject) {
    filtered = dpps.filter(q => (q.subject || '').toLowerCase() === subject.toLowerCase());
  }

  res.json({
    category: 'Daily Practice Problems (DPP)',
    totalAvailable: filtered.length,
    questions: filtered.slice(0, limit).map(q => formatQuestion(q, req))
  });
});

// 5. Diagram Based Questions (1,159 Qs)
router.get('/diagrams', (req, res) => {
  const diagrams = masterByCategory.diagrams || [];
  const limit = parseInt(req.query.limit) || 50;

  res.json({
    category: 'Diagram Based Questions',
    totalAvailable: diagrams.length,
    totalQuestions: Math.min(diagrams.length, limit),
    questions: diagrams.slice(0, limit).map(q => formatQuestion(q, req))
  });
});

export default router;
