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

  const pool = masterByCategory.daily_pool || [];
  const poolBySub = {
    Physics: pool.filter(q => q.subject === 'Physics'),
    Chemistry: pool.filter(q => q.subject === 'Chemistry'),
    Botany: pool.filter(q => q.subject === 'Botany' || q.subject === 'Biology'),
    Zoology: pool.filter(q => q.subject === 'Zoology' || q.subject === 'Biology')
  };

  const phyQs = pickQuestions(poolBySub.Physics.length ? poolBySub.Physics : masterBySubject.Physics, 5, 101);
  const chemQs = pickQuestions(poolBySub.Chemistry.length ? poolBySub.Chemistry : masterBySubject.Chemistry, 5, 202);
  const botQs = pickQuestions(poolBySub.Botany.length ? poolBySub.Botany : masterBySubject.Botany, 5, 303);
  const zooQs = pickQuestions(poolBySub.Zoology.length ? poolBySub.Zoology : masterBySubject.Zoology, 5, 404);

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

// 6. Grand Mock Tests Summary List (Mock 1, Mock 2, Mock 3)
router.get('/mocks', (req, res) => {
  const summary = masterByCategory.mock_summary || [];
  res.json({
    totalMocks: summary.length,
    mocks: summary
  });
});

// 7. Single Full Mock Test Questions (180 Qs)
router.get('/mocks/:id', (req, res) => {
  const { id } = req.params;
  const mockData = masterByCategory[id];
  if (!mockData) {
    return res.status(404).json({ error: 'Mock test not found' });
  }

  const formattedQuestions = (mockData.questions || []).map(q => formatQuestion(q, req));
  res.json({
    id: mockData.id,
    title: mockData.title,
    subtitle: mockData.subtitle,
    durationMinutes: mockData.durationMinutes || 200,
    totalQuestions: formattedQuestions.length,
    marks: formattedQuestions.length * 4,
    questions: formattedQuestions
  });
});

// 8. Challenger Mode: Numericals (400 Qs)
router.get('/challenger/numericals', (req, res) => {
  const list = masterByCategory.numericals || [];
  const subject = req.query.subject;
  const limit = parseInt(req.query.limit) || 30;

  let filtered = list;
  if (subject && subject.toLowerCase() !== 'all') {
    filtered = list.filter(q => (q.subject || '').toLowerCase() === subject.toLowerCase());
  }

  res.json({
    category: 'Physics & Chemistry Numericals',
    totalAvailable: filtered.length,
    questions: filtered.slice(0, limit).map(q => formatQuestion(q, req))
  });
});

// 9. Challenger Mode: Tough Questions (400 Qs)
router.get('/challenger/tough', (req, res) => {
  const list = masterByCategory.tough || [];
  const subject = req.query.subject;
  const limit = parseInt(req.query.limit) || 30;

  let filtered = list;
  if (subject && subject.toLowerCase() !== 'all') {
    filtered = list.filter(q => (q.subject || '').toLowerCase() === subject.toLowerCase());
  }

  res.json({
    category: 'High-Yield Tough Questions',
    totalAvailable: filtered.length,
    questions: filtered.slice(0, limit).map(q => formatQuestion(q, req))
  });
});

// 10. Most Repeated PYQs (531 Qs)
router.get('/repeated-pyqs', (req, res) => {
  const list = masterByCategory.repeated_pyqs || [];
  const subject = req.query.subject;
  const limit = parseInt(req.query.limit) || 40;

  let filtered = list;
  if (subject && subject.toLowerCase() !== 'all') {
    filtered = list.filter(q => (q.subject || '').toLowerCase() === subject.toLowerCase());
  }

  res.json({
    category: 'Most Repeated NEET PYQs',
    totalAvailable: filtered.length,
    questions: filtered.slice(0, limit).map(q => formatQuestion(q, req))
  });
});

export default router;
