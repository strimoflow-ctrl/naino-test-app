import express from 'express';
import { masterByCategory, formatQuestion } from '../db.js';
import { verifyAppSecret, verifyToken, verifyDeviceBinding, verifyActiveSession } from '../middleware/auth.js';
import { questionsLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// 🛡️ FULL 5-LAYER ANTI-SCRAPING SECURITY STACK
router.use(verifyAppSecret);
router.use(questionsLimiter);
router.use(verifyToken);
router.use(verifyDeviceBinding);
router.use(verifyActiveSession);

// 1. PYQ Papers (2015 to 2024)
router.get('/papers', (req, res) => {
  const pyqs = masterByCategory.neet_papers || [];
  const yearCounts = {};
  for (const q of pyqs) {
    const y = q.year || 'Unknown';
    yearCounts[y] = (yearCounts[y] || 0) + 1;
  }

  const papers = Object.keys(yearCounts)
    .sort((a, b) => b.localeCompare(a))
    .map(y => ({
      year: y,
      title: `NEET ${y} Official Exam Paper`,
      questionCount: yearCounts[y]
    }));

  res.json({ papers });
});

// 2. Questions for a specific PYQ Year
router.get('/paper/:year', (req, res) => {
  const year = req.params.year;
  const pyqs = masterByCategory.neet_papers || [];
  const filtered = pyqs.filter(q => String(q.year) === String(year));

  res.json({
    year,
    title: `NEET ${year} Official Exam Paper`,
    totalQuestions: filtered.length,
    questions: filtered.map(q => formatQuestion(q, req))
  });
});

export default router;
