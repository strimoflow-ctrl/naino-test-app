import express from 'express';
import { masterBySubject, masterByCategory, formatQuestion, getMongoDb, isMongoConnected } from '../db.js';

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
  const part = parseInt(req.query.part) || 1;
  const offset = req.query.offset !== undefined ? parseInt(req.query.offset) : (part - 1) * limit;
  const end = Math.min(offset + limit, filtered.length);

  res.json({
    subject: subName,
    chapter: chapterName,
    part,
    total: filtered.length,
    offset,
    questions: filtered.slice(offset, end).map(q => formatQuestion(q, req))
  });
});

// 3.5 Dynamic Chapter Parts (e.g. Part 1, Part 2, Part 3 for large chapters)
router.get('/chapters/:subject/:chapterName/parts', async (req, res) => {
  const { subject, chapterName } = req.params;
  const subName = subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();
  const qs = masterBySubject[subName] || [];
  const targetName = decodeURIComponent(chapterName).toLowerCase();
  const filtered = qs.filter(q => (q.chapter || '').toLowerCase() === targetName);

  const PART_SIZE = 25;
  const totalParts = Math.max(1, Math.ceil(filtered.length / PART_SIZE));

  // Check MongoDB custom parts if configured by Admin
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const customParts = await db.collection('chapter_parts').find({
        subject: subName,
        chapter: targetName
      }).sort({ part: 1 }).toArray();

      if (customParts && customParts.length > 0) {
        return res.json({
          subject: subName,
          chapter: chapterName,
          totalQuestions: filtered.length,
          totalParts: customParts.length,
          source: 'MONGODB_ATLAS',
          parts: customParts
        });
      }
    }
  } catch (err) {
    console.warn('[Tests Route] MongoDB chapter_parts error:', err.message);
  }

  const parts = [];
  for (let i = 0; i < totalParts; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, filtered.length);
    parts.push({
      part: i + 1,
      partId: `part_${i + 1}`,
      title: `Part ${i + 1}`,
      subtitle: `Questions ${start + 1} - ${end}`,
      questionCount: end - start,
      durationMinutes: Math.max(15, Math.round((end - start) * 0.9)),
      range: `Q${start + 1} - Q${end}`
    });
  }

  res.json({
    subject: subName,
    chapter: chapterName,
    totalQuestions: filtered.length,
    totalParts: parts.length,
    source: 'LOCAL_MASTER',
    parts
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

// 5. Diagram Based Questions & Bundles (1,159 Qs split into 50-Qs Sets)
router.get('/diagrams/sets', async (req, res) => {
  try {
    // 1. Check MongoDB Atlas if custom sets are configured by Admin
    if (isMongoConnected()) {
      const db = getMongoDb();
      const customSets = await db.collection('diagram_sets').find({ is_active: { $ne: false } }).sort({ order: 1 }).toArray();
      if (customSets && customSets.length > 0) {
        return res.json({
          totalSets: customSets.length,
          totalQuestions: customSets.reduce((sum, s) => sum + (s.totalQuestions || 50), 0),
          source: 'MONGODB_ATLAS',
          sets: customSets
        });
      }
    }
  } catch (err) {
    console.warn('[Tests Route] MongoDB diagram_sets error:', err.message);
  }

  // 2. High-speed Fallback: Generate sets from masterByCategory.diagrams
  const diagrams = masterByCategory.diagrams || [];
  const SET_SIZE = 50;
  const totalSets = Math.max(1, Math.ceil(diagrams.length / SET_SIZE));

  const setSubtitles = [
    "Cell Structure & Cytology Diagrams",
    "Human Digestive & Respiratory Anatomy",
    "Plant Anatomy & Vascular Tissues",
    "Cardiovascular & Circulatory Systems",
    "Excretory & Neural Control Structures",
    "Reproduction in Flowering Plants",
    "Human Reproductive System Diagrams",
    "Genetics & Molecular Machinery",
    "Morphology of Flowering Plants",
    "Structural Organisation in Animals",
    "Biomolecules & Enzyme Catalysis",
    "Photosynthesis & Chloroplast Anatomy",
    "Respiration & Cellular Energetics",
    "Plant Growth & Hormonal Regulation",
    "Locomotion & Musculoskeletal Diagrams",
    "Chemical Coordination & Endocrine Glands",
    "Ecosystem Dynamics & Energy Flow",
    "Biodiversity & Ecological Pyramids",
    "Biotechnology Tools & Vectors",
    "Biotechnology Applications in Medicine",
    "Microbes in Human Welfare Diagrams",
    "Human Health & Pathogen Structures",
    "Plant & Animal Kingdom Cladograms",
    "NCERT Mixed Visual Grand Mastery"
  ];

  const sets = [];
  for (let i = 0; i < totalSets; i++) {
    const start = i * SET_SIZE;
    const end = Math.min(start + SET_SIZE, diagrams.length);
    const count = end - start;
    const setNum = (i + 1).toString().padStart(2, '0');
    sets.push({
      setId: `diagram_set_${setNum}`,
      setIndex: i,
      title: `Diagram Practice Set ${setNum}`,
      subtitle: setSubtitles[i % setSubtitles.length],
      totalQuestions: count,
      durationMinutes: 45,
      order: i + 1,
      range: `Q${start + 1} - Q${end}`,
      badge: "50 MCQs"
    });
  }

  res.json({
    totalSets: sets.length,
    totalQuestions: diagrams.length,
    source: 'LOCAL_MASTER',
    sets
  });
});

// Single Diagram Set Questions
router.get('/diagrams/sets/:setId', async (req, res) => {
  const { setId } = req.params;
  const diagrams = masterByCategory.diagrams || [];
  const SET_SIZE = 50;

  // Check MongoDB first
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const customSet = await db.collection('diagram_sets').findOne({ setId });
      if (customSet && customSet.questionIds && customSet.questionIds.length > 0) {
        const qMap = new Map(diagrams.map(q => [q.id, q]));
        const questions = customSet.questionIds
          .map(id => qMap.get(id))
          .filter(Boolean)
          .map(q => formatQuestion(q, req));
        return res.json({
          setId: customSet.setId,
          title: customSet.title,
          subtitle: customSet.subtitle,
          totalQuestions: questions.length,
          durationMinutes: customSet.durationMinutes || 45,
          questions
        });
      }
    }
  } catch (err) {
    console.warn('[Tests Route] MongoDB single diagram set error:', err.message);
  }

  // Parse set number e.g. "diagram_set_01" -> 1
  let setIndex = 0;
  const match = setId.match(/(\d+)/);
  if (match) {
    setIndex = Math.max(0, parseInt(match[1], 10) - 1);
  }

  const start = setIndex * SET_SIZE;
  const end = Math.min(start + SET_SIZE, diagrams.length);
  const sliced = diagrams.slice(start, end);

  res.json({
    setId,
    setIndex,
    title: `Diagram Practice Set ${(setIndex + 1).toString().padStart(2, '0')}`,
    totalQuestions: sliced.length,
    durationMinutes: 45,
    questions: sliced.map(q => formatQuestion(q, req))
  });
});

// Backward compatible diagrams route with pagination & set support
router.get('/diagrams', (req, res) => {
  const diagrams = masterByCategory.diagrams || [];
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const set = parseInt(req.query.set);

  let start = offset;
  if (!isNaN(set) && set > 0) {
    start = (set - 1) * limit;
  }
  const end = Math.min(start + limit, diagrams.length);

  res.json({
    category: 'Diagram Based Questions',
    totalAvailable: diagrams.length,
    offset: start,
    totalQuestions: Math.max(0, end - start),
    questions: diagrams.slice(start, end).map(q => formatQuestion(q, req))
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
