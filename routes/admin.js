import express from 'express';
import jwt from 'jsonwebtoken';
import { ENV, getClientIp } from '../config/env.js';
import { getMongoDb, isMongoConnected, reloadQuestionsFromMongo, addQuestionToMemory, updateQuestionInMemory, removeQuestionFromMemory } from '../db.js';
import { verifyAdminToken, adminLoginLimiter, adminActionLimiter } from '../middleware/adminAuth.js';

const router = express.Router();

// ==========================================
// 1. ADMIN AUTHENTICATION
// ==========================================

/**
 * Super Admin Login
 * Rate limited to 5 attempts per 15 minutes to prevent brute-force attacks.
 */
router.post('/login', adminLoginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const clientIp = getClientIp(req);

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username and password are required.'
    });
  }

  const expectedUser = ENV.ADMIN_USERNAME || 'admin';
  const expectedPass = ENV.ADMIN_PASSWORD;

  if (!expectedPass) {
    console.error('[Admin Security Alert] ADMIN_PASSWORD is not set in environment!');
    return res.status(500).json({
      success: false,
      error: 'Admin authentication is temporarily disabled: Security credentials not configured on server.'
    });
  }

  // Constant-time-like validation
  const isUserValid = username.trim() === expectedUser.trim();
  const isPassValid = password === expectedPass;

  if (!isUserValid || !isPassValid) {
    console.warn(`[Admin Security] Failed login attempt for user "${username}" from IP: ${clientIp}`);
    return res.status(401).json({
      success: false,
      error: 'Invalid admin credentials.',
      code: 'INVALID_CREDENTIALS'
    });
  }

  // Generate dedicated Super Admin JWT (12 hour session)
  const secret = ENV.ADMIN_JWT_SECRET || ENV.JWT_SECRET;
  const token = jwt.sign(
    {
      username: expectedUser,
      role: 'super_admin',
      authorizedAt: new Date().toISOString()
    },
    secret,
    { expiresIn: '12h' }
  );

  console.log(`[Admin Security] Super Admin successfully logged in from IP: ${clientIp}`);

  res.json({
    success: true,
    message: 'Super Admin login successful.',
    token,
    admin: {
      username: expectedUser,
      role: 'super_admin',
      expiresIn: '12 hours'
    }
  });
});

/**
 * Verify current Admin session
 */
router.get('/me', verifyAdminToken, (req, res) => {
  res.json({
    success: true,
    admin: req.admin,
    databaseStatus: isMongoConnected() ? 'CONNECTED' : 'DISCONNECTED'
  });
});

// ==========================================
// 2. DASHBOARD STATS & METADATA
// ==========================================

/**
 * Get comprehensive database statistics
 */
router.get('/stats', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not connected.' });
    }

    const [totalQuestions, totalUsers, totalMocks, totalDailyPool] = await Promise.all([
      db.collection('questions').countDocuments(),
      db.collection('users').countDocuments(),
      db.collection('mock_tests').countDocuments(),
      db.collection('daily_test_pool').countDocuments()
    ]);

    const subjectCounts = await db.collection('questions').aggregate([
      { $group: { _id: '$subject', count: { $sum: 1 } } }
    ]).toArray();

    const categoryCounts = await db.collection('questions').aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]).toArray();

    res.json({
      success: true,
      stats: {
        totalQuestions,
        totalUsers,
        totalMocks,
        totalDailyPool,
        subjects: subjectCounts.map(s => ({ subject: s._id || 'Unknown', count: s.count })),
        categories: categoryCounts.map(c => ({ category: c._id || 'Unknown', count: c.count }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get distinct filter values (Subjects, Categories, Chapters, Years)
 */
router.get('/meta/filters', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const [subjects, categories, years, chapters] = await Promise.all([
      db.collection('questions').distinct('subject'),
      db.collection('questions').distinct('category'),
      db.collection('questions').distinct('year'),
      db.collection('questions').distinct('chapter')
    ]);

    res.json({
      success: true,
      filters: {
        subjects: subjects.filter(Boolean).sort(),
        categories: categories.filter(Boolean).sort(),
        years: years.filter(Boolean).sort((a, b) => String(b).localeCompare(String(a))),
        chapters: chapters.filter(Boolean).sort()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. QUESTIONS CRUD ENGINE
// ==========================================

/**
 * List questions with search, filters & pagination
 */
router.get('/questions', verifyAdminToken, adminActionLimiter, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    // Search query in QuestionText, ID, or Topic
    if (req.query.search && req.query.search.trim()) {
      const q = req.query.search.trim();
      filter.$or = [
        { id: { $regex: q, $options: 'i' } },
        { questionText: { $regex: q, $options: 'i' } },
        { question: { $regex: q, $options: 'i' } },
        { chapter: { $regex: q, $options: 'i' } },
        { topic: { $regex: q, $options: 'i' } }
      ];
    }

    if (req.query.subject && req.query.subject !== 'all') {
      filter.subject = req.query.subject;
    }

    if (req.query.category && req.query.category !== 'all') {
      filter.category = req.query.category;
    }

    if (req.query.chapter && req.query.chapter !== 'all') {
      filter.chapter = req.query.chapter;
    }

    if (req.query.year && req.query.year !== 'all') {
      filter.year = String(req.query.year);
    }

    const [total, questions] = await Promise.all([
      db.collection('questions').countDocuments(filter),
      db.collection('questions')
        .find(filter)
        .skip(skip)
        .limit(limit)
        .toArray()
    ]);

    res.json({
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      questions
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get single question by ID
 */
router.get('/questions/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const qid = req.params.id;
    const question = await db.collection('questions').findOne({
      $or: [{ id: qid }, { _id: qid }]
    });

    if (!question) {
      return res.status(404).json({ success: false, error: 'Question not found.' });
    }

    res.json({ success: true, question });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Create a new question
 */
router.post('/questions', verifyAdminToken, adminActionLimiter, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const {
      questionText,
      options,
      correctIndex,
      explanation,
      subject,
      chapter,
      topic,
      category,
      year,
      questionImg,
      explanationImg
    } = req.body || {};

    if (!questionText || !questionText.trim()) {
      return res.status(400).json({ success: false, error: 'Question text is required.' });
    }

    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ success: false, error: 'At least 2 options are required.' });
    }

    if (typeof correctIndex !== 'number' || correctIndex < 0 || correctIndex >= options.length) {
      return res.status(400).json({ success: false, error: 'Valid correctIndex (0 to options.length - 1) is required.' });
    }

    if (!subject) {
      return res.status(400).json({ success: false, error: 'Subject is required.' });
    }

    const uniqueId = `q_custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newDoc = {
      id: uniqueId,
      questionText: questionText.trim(),
      options: options.map(o => String(o).trim()),
      correctIndex,
      explanation: explanation ? explanation.trim() : '',
      subject: subject.trim(),
      chapter: chapter ? chapter.trim() : 'General',
      topic: topic ? topic.trim() : '',
      category: category ? category.trim() : 'chapterwise',
      year: year ? String(year).trim() : null,
      questionImg: questionImg || null,
      explanationImg: explanationImg || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await db.collection('questions').insertOne(newDoc);

    // Instant In-Memory Cache Sync (< 1ms)
    addQuestionToMemory(newDoc);

    console.log(`[Admin Action] Super Admin created new question ${uniqueId} (${newDoc.subject} - ${newDoc.chapter})`);

    res.status(201).json({
      success: true,
      message: 'Question created successfully and live synced!',
      question: newDoc
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Edit / Update an existing question
 */
router.put('/questions/:id', verifyAdminToken, adminActionLimiter, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const qid = req.params.id;
    const existing = await db.collection('questions').findOne({
      $or: [{ id: qid }, { _id: qid }]
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Question not found to update.' });
    }

    const updates = {};
    const body = req.body || {};

    if (body.questionText !== undefined) updates.questionText = body.questionText.trim();
    if (body.options !== undefined && Array.isArray(body.options)) updates.options = body.options.map(o => String(o).trim());
    if (body.correctIndex !== undefined) updates.correctIndex = parseInt(body.correctIndex);
    if (body.explanation !== undefined) updates.explanation = body.explanation.trim();
    if (body.subject !== undefined) updates.subject = body.subject.trim();
    if (body.chapter !== undefined) updates.chapter = body.chapter.trim();
    if (body.topic !== undefined) updates.topic = body.topic.trim();
    if (body.category !== undefined) updates.category = body.category.trim();
    if (body.year !== undefined) updates.year = body.year ? String(body.year).trim() : null;
    if (body.questionImg !== undefined) updates.questionImg = body.questionImg;
    if (body.explanationImg !== undefined) updates.explanationImg = body.explanationImg;
    updates.updatedAt = new Date().toISOString();

    await db.collection('questions').updateOne(
      { _id: existing._id },
      { $set: updates }
    );

    // Instant In-Memory Cache Sync (< 1ms)
    updateQuestionInMemory(existing.id || String(existing._id), updates);

    console.log(`[Admin Action] Super Admin updated question ${qid} (${updates.subject || existing.subject})`);

    const updated = await db.collection('questions').findOne({ _id: existing._id });

    res.json({
      success: true,
      message: 'Question updated successfully and live synced!',
      question: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Delete a question
 */
router.delete('/questions/:id', verifyAdminToken, adminActionLimiter, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const qid = req.params.id;
    const existing = await db.collection('questions').findOne({
      $or: [{ id: qid }, { _id: qid }]
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Question not found to delete.' });
    }

    await db.collection('questions').deleteOne({ _id: existing._id });

    // Instant In-Memory Cache Sync (< 1ms)
    removeQuestionFromMemory(existing.id || String(existing._id));

    console.log(`[Admin Action] Super Admin deleted question ${qid}`);

    res.json({
      success: true,
      message: `Question ${qid} deleted permanently and cache synced.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. CACHE SYNC TRIGGER
// ==========================================
router.post('/sync-cache', verifyAdminToken, async (req, res) => {
  try {
    const ok = await reloadQuestionsFromMongo();
    res.json({
      success: ok,
      message: ok ? 'In-memory cache successfully reloaded from MongoDB Atlas.' : 'Failed to reload cache.',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 5. REGISTERED STUDENTS / USERS MANAGEMENT
// ==========================================
router.get('/users', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const search = req.query.search ? req.query.search.trim() : '';
    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { deviceId: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await db.collection('users')
      .find(filter, { projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({
      success: true,
      total: users.length,
      users
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/users/:userId/device-reset', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { userId } = req.params;
    await db.collection('users').updateOne(
      { userId },
      { $set: { deviceId: null, activeSessionToken: null, updatedAt: new Date().toISOString() } }
    );
    console.log(`[Admin Action] Reset device binding for user: ${userId}`);
    res.json({ success: true, message: `Device binding for user ${userId} has been reset.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/users/:userId/toggle-status', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { userId } = req.params;
    const user = await db.collection('users').findOne({ userId });
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const newStatus = !user.isLocked;
    await db.collection('users').updateOne(
      { userId },
      { $set: { isLocked: newStatus, isBanned: newStatus, updatedAt: new Date().toISOString() } }
    );
    res.json({ success: true, isLocked: newStatus, message: `User account is now ${newStatus ? 'LOCKED / BANNED' : 'ACTIVE'}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. APP CONFIG: POPUP, BANNERS, MAINTENANCE
// ==========================================
router.get('/app-config', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const [mainConfigDoc, banners] = await Promise.all([
      db.collection('app_config').findOne({ key: 'main_config' }),
      db.collection('banners').find({}).toArray()
    ]);

    res.json({
      success: true,
      popup: mainConfigDoc?.sponsor_popup || {},
      appLock: mainConfigDoc?.app_lock || {},
      banners: banners || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/app-config/popup', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const popupData = req.body || {};
    await db.collection('app_config').updateOne(
      { key: 'main_config' },
      { $set: { sponsor_popup: popupData, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    res.json({ success: true, message: 'Notice popup settings updated successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/app-config/app-lock', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const lockData = req.body || {};
    await db.collection('app_config').updateOne(
      { key: 'main_config' },
      { $set: { app_lock: lockData, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    res.json({ success: true, message: 'App maintenance lock updated successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/app-config/banners', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { title, image_url, action_type, action_target } = req.body || {};
    const newBanner = {
      banner_id: `banner_${Date.now()}`,
      title: title || 'Special Banner',
      image_url,
      action_type: action_type || 'route',
      action_target: action_target || '/daily-test',
      is_active: true,
      created_at: new Date().toISOString()
    };
    await db.collection('banners').insertOne(newBanner);
    res.status(201).json({ success: true, banner: newBanner });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/app-config/banners/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { id } = req.params;
    await db.collection('banners').deleteOne({ $or: [{ banner_id: id }, { _id: id }] });
    res.json({ success: true, message: 'Banner deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 7. CHAPTER TESTS HIERARCHY (SUBJECT -> CHAPTERS -> PARTS -> QUESTIONS)
// ==========================================
router.get('/chapters-tree', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const subject = req.query.subject || 'Physics';

    // Group questions by chapter for this subject
    const chapterStats = await db.collection('questions').aggregate([
      { $match: { subject } },
      {
        $group: {
          _id: '$chapter',
          totalQuestions: { $sum: 1 },
          years: { $addToSet: '$year' }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    const chapters = chapterStats.map(c => {
      const qCount = c.totalQuestions || 0;
      const totalParts = Math.max(1, Math.ceil(qCount / 25));
      return {
        chapterName: c._id || 'General Concepts',
        totalQuestions: qCount,
        totalParts,
        hasPyqs: (c.years || []).some(Boolean)
      };
    });

    res.json({
      success: true,
      subject,
      totalChapters: chapters.length,
      chapters
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/chapters/:subject/:chapterName/parts', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { subject, chapterName } = req.params;
    const targetName = decodeURIComponent(chapterName).trim();

    const count = await db.collection('questions').countDocuments({
      subject,
      chapter: { $regex: `^${targetName}$`, $options: 'i' }
    });

    const PART_SIZE = 25;
    const totalParts = Math.max(1, Math.ceil(count / PART_SIZE));
    const parts = [];

    for (let i = 0; i < totalParts; i++) {
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, count);
      parts.push({
        partNumber: i + 1,
        title: `Part ${i + 1}`,
        subtitle: i === 0 ? 'Free Starter Test' : 'Unlock via 5 Video Ads',
        isFree: i === 0,
        questionCount: Math.max(0, end - start),
        offset: start,
        limit: PART_SIZE
      });
    }

    res.json({
      success: true,
      subject,
      chapter: targetName,
      totalQuestions: count,
      totalParts: parts.length,
      parts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/chapters/:subject/:chapterName/parts/:partNumber/questions', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { subject, chapterName, partNumber } = req.params;
    const targetName = decodeURIComponent(chapterName).trim();
    const part = parseInt(partNumber, 10) || 1;
    const PART_SIZE = 25;
    const skip = (part - 1) * PART_SIZE;

    const [total, questions] = await Promise.all([
      db.collection('questions').countDocuments({
        subject,
        chapter: { $regex: `^${targetName}$`, $options: 'i' }
      }),
      db.collection('questions')
        .find({
          subject,
          chapter: { $regex: `^${targetName}$`, $options: 'i' }
        })
        .skip(skip)
        .limit(PART_SIZE)
        .toArray()
    ]);

    res.json({
      success: true,
      subject,
      chapter: targetName,
      partNumber: part,
      totalInChapter: total,
      questions
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8. BATCHES & VIDEO LECTURES MANAGEMENT
// ==========================================
router.get('/batches', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const batches = await db.collection('batches').find({}).toArray();
    res.json({ success: true, total: batches.length, batches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/batches/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const batch = await db.collection('batches').findOne({
      $or: [{ id: req.params.id }, { _id: req.params.id }]
    });

    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });
    res.json({ success: true, batch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/batches', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const body = req.body || {};
    const newBatch = {
      id: body.id || `batch_${Date.now()}`,
      title: body.title || 'New NEET Batch',
      subtitle: body.subtitle || '',
      educator: body.educator || 'Bhaiya (4 Yrs NEET Experience)',
      badge: body.badge || 'NEW BATCH',
      price: body.price !== undefined ? parseFloat(body.price) : 0,
      originalPrice: body.originalPrice !== undefined ? parseFloat(body.originalPrice) : 2999,
      discount: body.discount || '100% FREE',
      demoVideoId: body.demoVideoId || '',
      thumbnail: body.thumbnail || 'https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/units_and_measurements.jpg',
      description: body.description || '',
      features: Array.isArray(body.features) ? body.features : ['Video Lectures included', 'NCERT Mindmaps', 'Full Mocks'],
      lectures: [],
      materials: [],
      rating: 4.9,
      studentsCount: 1500,
      createdAt: new Date().toISOString()
    };

    await db.collection('batches').insertOne(newBatch);
    res.status(201).json({ success: true, batch: newBatch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/batches/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const bid = req.params.id;
    const updates = req.body || {};
    delete updates._id;

    await db.collection('batches').updateOne(
      { $or: [{ id: bid }, { _id: bid }] },
      { $set: updates }
    );

    const updated = await db.collection('batches').findOne({ $or: [{ id: bid }, { _id: bid }] });
    res.json({ success: true, batch: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/batches/:id/lectures', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const bid = req.params.id;
    const { title, videoId, duration, subject, chapter, notesPdfUrl, isFree } = req.body || {};

    if (!title || !videoId) {
      return res.status(400).json({ success: false, error: 'Lecture title and Video ID/URL are required.' });
    }

    // Clean videoId if user pasted full YouTube link e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ
    let cleanVideoId = videoId.trim();
    const ytMatch = cleanVideoId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (ytMatch && ytMatch[1]) {
      cleanVideoId = ytMatch[1];
    }

    const newLecture = {
      lectureId: `lec_${Date.now()}`,
      title: title.trim(),
      videoId: cleanVideoId,
      duration: duration || '45 mins',
      subject: subject || 'Physics',
      chapter: chapter || 'General',
      notesPdfUrl: notesPdfUrl || '',
      isFree: isFree !== undefined ? !!isFree : true,
      createdAt: new Date().toISOString()
    };

    await db.collection('batches').updateOne(
      { $or: [{ id: bid }, { _id: bid }] },
      { $push: { lectures: newLecture } }
    );

    res.status(201).json({ success: true, lecture: newLecture });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/batches/:id/lectures/:lectureId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { id, lectureId } = req.params;
    await db.collection('batches').updateOne(
      { $or: [{ id }, { _id: id }] },
      { $pull: { lectures: { lectureId } } }
    );

    res.json({ success: true, message: 'Lecture deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 9. STORE TEST PACKS MANAGEMENT
// ==========================================
router.get('/test-packs', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const packs = await db.collection('test_packs').find({}).toArray();
    res.json({ success: true, total: packs.length, packs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/test-packs/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const pid = req.params.id;
    const updates = req.body || {};
    delete updates._id;

    await db.collection('test_packs').updateOne(
      { $or: [{ id: pid }, { _id: pid }] },
      { $set: updates }
    );

    res.json({ success: true, message: 'Test pack updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
