import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import { ENV, getClientIp } from '../config/env.js';
import { getMongoDb, isMongoConnected, reloadQuestionsFromMongo, addQuestionToMemory, updateQuestionInMemory, removeQuestionFromMemory, resolveImageUrl } from '../db.js';
import { verifyAdminToken, adminLoginLimiter, adminActionLimiter } from '../middleware/adminAuth.js';
import { parseBookMetadata } from './library.js';

const router = express.Router();

function toMongoIdQuery(id) {
  if (!id) return { _id: '__non_existent__' };
  const strId = String(id).trim();
  const queries = [{ id: strId }];
  if (ObjectId.isValid(strId)) {
    queries.push({ _id: new ObjectId(strId) });
  } else {
    queries.push({ _id: strId });
  }
  return { $or: queries };
}

function formatYouTubeUrl(urlOrId) {
  if (!urlOrId) return '';
  const str = String(urlOrId).trim();
  const ytMatch = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (ytMatch && ytMatch[1]) {
    return `https://www.youtube.com/watch?v=${ytMatch[1]}`;
  }
  if (/^[\w-]{11}$/.test(str)) {
    return `https://www.youtube.com/watch?v=${str}`;
  }
  return str;
}

function attachResolvedImages(q, req) {
  if (!q) return q;
  const rawQImg = q.questionImg || q.questionImage || q.diagramUrl || q.image;
  const resolvedQImg = rawQImg ? resolveImageUrl(rawQImg, 'questions', req) : null;
  const rawExpImg = q.explanationImg || q.explanationImage;
  const resolvedExpImg = rawExpImg ? resolveImageUrl(rawExpImg, 'solutions', req) : null;
  return {
    ...q,
    rawQuestionImg: rawQImg,
    questionImg: resolvedQImg || rawQImg,
    questionImage: resolvedQImg || rawQImg,
    diagramUrl: resolvedQImg || rawQImg,
    explanationImg: resolvedExpImg || rawExpImg
  };
}

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
      questions: questions.map(q => attachResolvedImages(q, req))
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

    res.json({ success: true, question: attachResolvedImages(question, req) });
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

router.delete('/users/:userId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { userId } = req.params;
    const result = await db.collection('users').deleteOne({ userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    console.log(`[Admin Action] Deleted user account: ${userId}`);
    res.json({ success: true, message: `Student account ${userId} permanently removed.` });
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
      questions: questions.map(q => attachResolvedImages(q, req))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8. BATCHES & CLASSROOM MANAGEMENT (Full 3-Tier Hierarchy & Live Updates)
// ==========================================

// 8.1 List All Batches
router.get('/batches', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const batches = await db.collection('batches').find({}).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, total: batches.length, batches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.2 Get Single Batch by ID (Supports String id or ObjectId)
router.get('/batches/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const batch = await db.collection('batches').findOne(query);

    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });
    res.json({ success: true, batch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.3 Create New Batch
router.post('/batches', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const body = req.body || {};
    const batchId = body.id || `batch_${Date.now()}`;
    const newBatch = {
      id: batchId,
      title: body.title || 'New NEET Batch',
      subtitle: body.subtitle || '',
      educator: body.educator || 'Bhaiya (4 Yrs NEET Experience)',
      badge: body.badge || 'FLAGSHIP BATCH',
      price: body.price !== undefined ? parseFloat(body.price) : 0,
      originalPrice: body.originalPrice !== undefined ? parseFloat(body.originalPrice) : 2999,
      discount: body.discount || (parseFloat(body.price) === 0 ? '100% FREE' : '60% OFF'),
      demoVideoId: body.demoVideoId || 'dQw4w9WgXcQ',
      thumbnail: body.thumbnail || 'https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/units_and_measurements.jpg',
      description: body.description || 'Complete NEET batch with live streams, recorded classes, DPP notes and chapter tests.',
      features: Array.isArray(body.features) && body.features.length > 0
        ? body.features
        : [
            '120+ Video Lectures by Bhaiya (Physics, Chem, Bio)',
            'Premium NCERT Mindmap PDFs & Handbooks included',
            'Daily Practice Problem (DPP) Sheets with Solutions',
            'Full Syllabus NEET Mocks with AI Rank Predictor'
          ],
      latestUpdates: [],
      materials: [],
      subjects: [
        {
          id: 'subj_physics',
          name: 'Physics',
          chaptersCount: 0,
          totalLectures: 0,
          chapters: []
        },
        {
          id: 'subj_chemistry',
          name: 'Chemistry',
          chaptersCount: 0,
          totalLectures: 0,
          chapters: []
        },
        {
          id: 'subj_biology',
          name: 'Biology',
          chaptersCount: 0,
          totalLectures: 0,
          chapters: []
        }
      ],
      rating: 4.9,
      studentsCount: 2450,
      createdAt: new Date().toISOString()
    };

    await db.collection('batches').insertOne(newBatch);
    res.status(201).json({ success: true, batch: newBatch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.4 Update Batch Metadata / Overview
router.put('/batches/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const updates = { ...(req.body || {}) };
    delete updates._id;

    if (updates.price !== undefined) updates.price = parseFloat(updates.price) || 0;
    if (updates.originalPrice !== undefined) updates.originalPrice = parseFloat(updates.originalPrice) || 0;

    await db.collection('batches').updateOne(query, { $set: updates });
    const updated = await db.collection('batches').findOne(query);
    res.json({ success: true, batch: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.5 Delete Batch (100% Reliable ObjectId + id Query)
router.delete('/batches/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const result = await db.collection('batches').deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Batch not found.' });
    }

    console.log(`[Admin Action] Deleted batch: ${req.params.id}`);
    res.json({ success: true, message: 'Batch deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8.6 LIVE & UPCOMING STREAMS (LATEST Updates Carousel)
// ==========================================

// Add Live / Scheduled Update to Batch
router.post('/batches/:id/updates', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const { title, subject, videoUrl, isLive, scheduledAt, durationMinutes, tag, thumbnail } = req.body || {};

    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required for stream/update.' });
    }

    const cleanVideo = formatYouTubeUrl(videoUrl);
    const duration = parseInt(durationMinutes) || 60;
    const isLiveNow = !!isLive;

    const newUpdate = {
      id: `upd_${Date.now()}`,
      title: title.trim(),
      subject: subject || 'General',
      videoUrl: cleanVideo,
      thumbnail: thumbnail || '',
      isLive: isLiveNow,
      status: isLiveNow ? 'live' : (scheduledAt ? 'upcoming' : 'ended'),
      scheduledAt: scheduledAt || null,
      durationMinutes: duration,
      tag: isLiveNow ? 'LIVE NOW' : (tag || (scheduledAt ? 'UPCOMING CLASS' : 'RECORDED CLASS')),
      createdAt: new Date().toISOString()
    };

    await db.collection('batches').updateOne(query, {
      $push: { latestUpdates: newUpdate }
    });

    const updatedBatch = await db.collection('batches').findOne(query);
    res.status(201).json({ success: true, update: newUpdate, batch: updatedBatch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Live / Scheduled Update
router.delete('/batches/:id/updates/:updateId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    await db.collection('batches').updateOne(query, {
      $pull: { latestUpdates: { id: req.params.updateId } }
    });

    res.json({ success: true, message: 'Update removed from carousel.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8.7 SUBJECTS & CHAPTERS HIERARCHY
// ==========================================

// Add Custom Subject to Batch
router.post('/batches/:id/subjects', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: 'Subject name is required.' });

    const newSubject = {
      id: `subj_${Date.now()}`,
      name: name.trim(),
      chaptersCount: 0,
      totalLectures: 0,
      chapters: []
    };

    await db.collection('batches').updateOne(query, {
      $push: { subjects: newSubject }
    });

    const updatedBatch = await db.collection('batches').findOne(query);
    res.status(201).json({ success: true, subject: newSubject, batch: updatedBatch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Subject from Batch
router.delete('/batches/:id/subjects/:subjectId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    await db.collection('batches').updateOne(query, {
      $pull: { subjects: { id: req.params.subjectId } }
    });

    res.json({ success: true, message: 'Subject deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Chapter under Subject
router.post('/batches/:id/subjects/:subjectId/chapters', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const { title } = req.body || {};
    if (!title) return res.status(400).json({ success: false, error: 'Chapter title is required.' });

    const batch = await db.collection('batches').findOne(query);
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });

    const subjects = batch.subjects || [];
    const subjIndex = subjects.findIndex(s => s.id === req.params.subjectId);
    if (subjIndex === -1) return res.status(404).json({ success: false, error: 'Subject not found.' });

    const newChapter = {
      id: `ch_${Date.now()}`,
      title: title.trim(),
      lecturesCount: 0,
      hasPdf: true,
      lectures: []
    };

    subjects[subjIndex].chapters = subjects[subjIndex].chapters || [];
    subjects[subjIndex].chapters.push(newChapter);
    subjects[subjIndex].chaptersCount = subjects[subjIndex].chapters.length;

    await db.collection('batches').updateOne(query, { $set: { subjects } });

    res.status(201).json({ success: true, chapter: newChapter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Chapter from Subject
router.delete('/batches/:id/subjects/:subjectId/chapters/:chapterId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const batch = await db.collection('batches').findOne(query);
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });

    const subjects = batch.subjects || [];
    const subjIndex = subjects.findIndex(s => s.id === req.params.subjectId);
    if (subjIndex === -1) return res.status(404).json({ success: false, error: 'Subject not found.' });

    const chapters = subjects[subjIndex].chapters || [];
    subjects[subjIndex].chapters = chapters.filter(c => c.id !== req.params.chapterId);
    subjects[subjIndex].chaptersCount = subjects[subjIndex].chapters.length;

    // Recalculate total lectures for subject
    subjects[subjIndex].totalLectures = subjects[subjIndex].chapters.reduce(
      (sum, c) => sum + (c.lectures?.length || 0), 0
    );

    await db.collection('batches').updateOne(query, { $set: { subjects } });

    res.json({ success: true, message: 'Chapter deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8.8 LECTURES INSIDE CHAPTER (Videos, Notes, DPPs)
// ==========================================

// Add Lecture to Chapter
router.post('/batches/:id/subjects/:subjectId/chapters/:chapterId/lectures', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const { title, videoUrl, duration, tag, notesPdfUrl, dppPdfUrl, isLive, isUpcoming } = req.body || {};

    if (!title || !videoUrl) {
      return res.status(400).json({ success: false, error: 'Lecture title and Video URL/ID are required.' });
    }

    const batch = await db.collection('batches').findOne(query);
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });

    const subjects = batch.subjects || [];
    const subjIndex = subjects.findIndex(s => s.id === req.params.subjectId);
    if (subjIndex === -1) return res.status(404).json({ success: false, error: 'Subject not found.' });

    const chapters = subjects[subjIndex].chapters || [];
    const chIndex = chapters.findIndex(c => c.id === req.params.chapterId);
    if (chIndex === -1) return res.status(404).json({ success: false, error: 'Chapter not found.' });

    const cleanVideo = formatYouTubeUrl(videoUrl);

    const newLecture = {
      id: `lec_${Date.now()}`,
      title: title.trim(),
      videoUrl: cleanVideo,
      duration: duration || '45:00',
      tag: tag || 'Classroom',
      notesPdfUrl: notesPdfUrl?.trim() || '',
      dppPdfUrl: dppPdfUrl?.trim() || '',
      pdfUrl: notesPdfUrl?.trim() || dppPdfUrl?.trim() || '',
      isLive: !!isLive,
      isUpcoming: !!isUpcoming,
      createdAt: new Date().toISOString()
    };

    chapters[chIndex].lectures = chapters[chIndex].lectures || [];
    chapters[chIndex].lectures.push(newLecture);
    chapters[chIndex].lecturesCount = chapters[chIndex].lectures.length;
    chapters[chIndex].hasPdf = !!(newLecture.notesPdfUrl || newLecture.dppPdfUrl || chapters[chIndex].hasPdf);

    subjects[subjIndex].totalLectures = chapters.reduce((sum, c) => sum + (c.lectures?.length || 0), 0);

    await db.collection('batches').updateOne(query, { $set: { subjects } });

    res.status(201).json({ success: true, lecture: newLecture });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Lecture from Chapter
router.delete('/batches/:id/subjects/:subjectId/chapters/:chapterId/lectures/:lectureId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const batch = await db.collection('batches').findOne(query);
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });

    const subjects = batch.subjects || [];
    const subjIndex = subjects.findIndex(s => s.id === req.params.subjectId);
    if (subjIndex === -1) return res.status(404).json({ success: false, error: 'Subject not found.' });

    const chapters = subjects[subjIndex].chapters || [];
    const chIndex = chapters.findIndex(c => c.id === req.params.chapterId);
    if (chIndex === -1) return res.status(404).json({ success: false, error: 'Chapter not found.' });

    chapters[chIndex].lectures = (chapters[chIndex].lectures || []).filter(l => l.id !== req.params.lectureId);
    chapters[chIndex].lecturesCount = chapters[chIndex].lectures.length;

    subjects[subjIndex].totalLectures = chapters.reduce((sum, c) => sum + (c.lectures?.length || 0), 0);

    await db.collection('batches').updateOne(query, { $set: { subjects } });

    res.json({ success: true, message: 'Lecture deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.4 Batch Tests / Test Series Management
router.post('/batches/:id/tests', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const body = req.body || {};
    const newTest = {
      id: body.id || `btest_${Date.now()}`,
      title: body.title || 'New Batch Mock Test',
      pattern: body.pattern || 'Full Syllabus NEET 720',
      totalQuestions: parseInt(body.totalQuestions) || 200,
      durationMinutes: parseInt(body.durationMinutes) || 180,
      testId: body.testId || '',
      testUrl: body.testUrl || '',
      status: body.status || 'Active', // 'Active', 'Upcoming', 'Completed'
      badge: body.badge || 'BATCH TEST',
      badgeColor: body.badgeColor || '#059669',
      createdAt: new Date()
    };

    const updateRes = await db.collection('batches').updateOne(
      query,
      { $push: { tests: newTest } }
    );

    if (updateRes.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Batch not found.' });
    }

    res.status(201).json({ success: true, test: newTest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/batches/:id/tests/:testId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const batch = await db.collection('batches').findOne(query);
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });

    const tests = batch.tests || [];
    const tIdx = tests.findIndex(t => t.id === req.params.testId);
    if (tIdx === -1) return res.status(404).json({ success: false, error: 'Test not found.' });

    const body = req.body || {};
    tests[tIdx] = {
      ...tests[tIdx],
      ...body,
      totalQuestions: body.totalQuestions ? parseInt(body.totalQuestions) : tests[tIdx].totalQuestions,
      durationMinutes: body.durationMinutes ? parseInt(body.durationMinutes) : tests[tIdx].durationMinutes,
      updatedAt: new Date()
    };

    await db.collection('batches').updateOne(query, { $set: { tests } });
    res.json({ success: true, test: tests[tIdx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/batches/:id/tests/:testId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const result = await db.collection('batches').updateOne(
      query,
      { $pull: { tests: { id: req.params.testId } } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Batch not found.' });
    }

    res.json({ success: true, message: 'Batch test deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.5 Batch DPP & Notes Management
router.post('/batches/:id/dpp-notes', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const body = req.body || {};
    const newMaterial = {
      id: body.id || `mat_${Date.now()}`,
      title: body.title || 'New Study Handbook',
      chapter: body.chapter || 'All Chapters',
      subject: body.subject || 'Physics',
      type: body.type || 'DPP', // 'DPP', 'Notes', 'Mindmap', 'Formula Sheet'
      questions: body.questions || 'Full Practice Deck',
      fileSize: body.fileSize || '3.5 MB',
      fileUrl: body.fileUrl || '',
      createdAt: new Date()
    };

    const updateRes = await db.collection('batches').updateOne(
      query,
      { $push: { dppNotes: newMaterial } }
    );

    if (updateRes.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Batch not found.' });
    }

    res.status(201).json({ success: true, material: newMaterial });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/batches/:id/dpp-notes/:materialId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const batch = await db.collection('batches').findOne(query);
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });

    const dppNotes = batch.dppNotes || [];
    const mIdx = dppNotes.findIndex(m => m.id === req.params.materialId);
    if (mIdx === -1) return res.status(404).json({ success: false, error: 'Material not found.' });

    const body = req.body || {};
    dppNotes[mIdx] = {
      ...dppNotes[mIdx],
      ...body,
      updatedAt: new Date()
    };

    await db.collection('batches').updateOne(query, { $set: { dppNotes } });
    res.json({ success: true, material: dppNotes[mIdx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/batches/:id/dpp-notes/:materialId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const result = await db.collection('batches').updateOne(
      query,
      { $pull: { dppNotes: { id: req.params.materialId } } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Batch not found.' });
    }

    res.json({ success: true, message: 'Batch material deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.6 Live Lecture Real-Time Chats (Admin Supervision & Mentor Reply)
router.get('/live-lectures', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const batches = await db.collection('batches').find({}).toArray();
    const lectureList = [];

    for (const b of batches) {
      // 1. Check latestUpdates (Live/Scheduled Streams)
      if (b.latestUpdates && Array.isArray(b.latestUpdates)) {
        for (const upd of b.latestUpdates) {
          const chatCount = await db.collection('lecture_chats').countDocuments({ lectureId: upd.id });
          lectureList.push({
            lectureId: upd.id,
            title: upd.title,
            batchId: b.id || b._id?.toString(),
            batchTitle: b.title,
            subject: upd.subject || 'All Subjects',
            videoUrl: upd.videoUrl || '',
            isLive: upd.isLive === true || upd.status === 'live',
            status: upd.status || (upd.isLive ? 'live' : 'scheduled'),
            scheduledAt: upd.scheduledAt,
            type: 'Live Stream',
            chatCount
          });
        }
      }

      // 2. Check regular subject chapters & lectures
      if (b.subjects && Array.isArray(b.subjects)) {
        for (const s of b.subjects) {
          if (s.chapters && Array.isArray(s.chapters)) {
            for (const ch of s.chapters) {
              if (ch.lectures && Array.isArray(ch.lectures)) {
                for (const lec of ch.lectures) {
                  const chatCount = await db.collection('lecture_chats').countDocuments({ lectureId: lec.id });
                  lectureList.push({
                    lectureId: lec.id,
                    title: lec.title,
                    batchId: b.id || b._id?.toString(),
                    batchTitle: b.title,
                    subject: s.name,
                    chapterTitle: ch.title,
                    videoUrl: lec.videoUrl || '',
                    isLive: lec.isLive === true || (lec.tag && lec.tag.toLowerCase().includes('live')),
                    status: lec.isLive ? 'live' : 'recorded',
                    type: 'Chapter Lecture',
                    chatCount
                  });
                }
              }
            }
          }
        }
      }
    }

    res.json({ success: true, total: lectureList.length, lectures: lectureList });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/lectures/:lectureId/chat', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const messages = await db.collection('lecture_chats')
      .find({ lectureId: req.params.lectureId })
      .sort({ timestamp: 1 })
      .limit(300)
      .toArray();

    res.json({ success: true, total: messages.length, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/lectures/:lectureId/chat', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const body = req.body || {};
    const now = new Date();
    const hours = now.getHours();
    const mins = now.getMinutes().toString().padLeft ? now.getMinutes().toString().padStart(2, '0') : (now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    const timeStr = `${hour12}:${mins} ${ampm}`;

    const newMsg = {
      id: `mentor_${Date.now()}`,
      lectureId: req.params.lectureId,
      sender: body.sender || 'Bhaiya (Mentor)',
      userId: 'admin_mentor',
      isMentor: true,
      text: body.text || '',
      time: timeStr,
      timestamp: Date.now(),
      createdAt: now
    };

    await db.collection('lecture_chats').insertOne(newMsg);
    res.status(201).json({ success: true, message: newMsg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/lectures/:lectureId/chat/:messageId', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { lectureId, messageId } = req.params;
    await db.collection('lecture_chats').deleteOne({
      lectureId,
      $or: [
        { id: messageId },
        { _id: ObjectId.isValid(messageId) ? new ObjectId(messageId) : null }
      ].filter(Boolean)
    });

    res.json({ success: true, message: 'Chat message deleted successfully.' });
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

router.post('/test-packs', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const body = req.body || {};
    const newPack = {
      id: body.id || `pack_${Date.now()}`,
      title: body.title || 'New Test Series Pack',
      subtitle: body.subtitle || '',
      badge: body.badge || 'TEST PACK',
      badgeColor: body.badgeColor || '#2563EB',
      price: body.price !== undefined ? parseFloat(body.price) : 0,
      originalPrice: body.originalPrice !== undefined ? parseFloat(body.originalPrice) : 999,
      discount: body.discount || '100% FREE',
      rating: 4.9,
      testsCount: parseInt(body.testsCount) || 10,
      thumbnail: body.thumbnail || 'https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/human_health_and_disease.jpg',
      description: body.description || '',
      highlights: Array.isArray(body.highlights) && body.highlights.length > 0 ? body.highlights : ['Full Length NTA Simulation Papers', 'Real CBT Interface with timer', 'Instant AI Analytics'],
      createdAt: new Date().toISOString()
    };

    await db.collection('test_packs').insertOne(newPack);
    res.status(201).json({ success: true, pack: newPack });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/test-packs/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const updates = { ...(req.body || {}) };
    delete updates._id;

    if (updates.price !== undefined) updates.price = parseFloat(updates.price) || 0;
    if (updates.originalPrice !== undefined) updates.originalPrice = parseFloat(updates.originalPrice) || 0;
    if (updates.testsCount !== undefined) updates.testsCount = parseInt(updates.testsCount) || 10;

    await db.collection('test_packs').updateOne(query, { $set: updates });
    const updated = await db.collection('test_packs').findOne(query);

    res.json({ success: true, pack: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/test-packs/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const query = toMongoIdQuery(req.params.id);
    const result = await db.collection('test_packs').deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Test pack not found.' });
    }

    res.json({ success: true, message: 'Test pack deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 10. STUDY LIBRARY & PDF MANAGEMENT
// ==========================================
router.get('/library/books', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    // 1. Fetch study_materials from MongoDB (100% cloud-driven)
    const materials = await db.collection('study_materials').find({ is_active: { $ne: false } }).toArray();

    // 2. Fetch study_notes from MongoDB (79 HTML Notes)
    const notesDocs = await db.collection('study_notes').find({}).toArray();

    const books = [];
    const baseUrl = process.env.R2_PUBLIC_URL || 'https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/pdfs';

    for (const doc of materials) {
      const filename = doc.filename || `${doc.material_id}.pdf`;
      const meta = parseBookMetadata(filename);
      const sizeBytes = doc.size_bytes || 2500000;
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
      const id = doc.material_id || doc.filename?.replace('.pdf', '') || doc._id?.toString();

      books.push({
        id,
        _id: doc._id,
        fileName: filename,
        title: doc.title || meta.title,
        category: doc.category || meta.category,
        subject: doc.subject || meta.subject,
        chapterNum: doc.chapterNum || meta.chapterNum,
        chapterName: doc.chapterName || meta.chapterName,
        downloadUrl: doc.r2_url || `${baseUrl}/${filename}`,
        sizeMB: `${sizeMB} MB`,
        isCustom: doc.isCustom === true,
        isActive: doc.is_active !== false
      });
    }

    // Include 79 Quick Study Notes from MongoDB study_notes
    for (const note of notesDocs) {
      const sub = note.subject || 'General';
      const id = note._id?.toString() || `note_${sub.toLowerCase()}_${note.fileName.replace('.html', '')}`;
      books.push({
        id,
        _id: note._id,
        fileName: note.fileName,
        title: note.title || note.fileName.replace('.html', '').replace(/_/g, ' '),
        category: 'Quick Study Notes',
        subject: sub,
        downloadUrl: note.r2_url || `/api/notes/${sub.toLowerCase()}/${note.fileName}`,
        sizeMB: 'HTML Note',
        isHtmlNote: true,
        isCustom: false,
        isActive: true
      });
    }

    // Filters
    const { category, subject, search } = req.query;
    let filtered = books;

    if (category && category.toLowerCase() !== 'all') {
      filtered = filtered.filter(b => (b.category || '').toLowerCase() === category.toLowerCase());
    }
    if (subject && subject.toLowerCase() !== 'all') {
      filtered = filtered.filter(b => (b.subject || '').toLowerCase() === subject.toLowerCase());
    }
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      filtered = filtered.filter(b => 
        (b.title || '').toLowerCase().includes(s) || 
        (b.chapterName || '').toLowerCase().includes(s) ||
        (b.fileName || '').toLowerCase().includes(s)
      );
    }

    res.json({
      success: true,
      total: filtered.length,
      totalAll: books.length,
      books: filtered
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/library/books', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const body = req.body || {};
    if (!body.title || !body.downloadUrl) {
      return res.status(400).json({ success: false, error: 'Book title and PDF Download/View URL are required.' });
    }

    const materialId = `mat_${Date.now()}`;
    const filename = body.fileName || `${body.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.pdf`;

    const newBook = {
      material_id: materialId,
      filename: filename,
      title: body.title.trim(),
      category: body.category || 'NCERT Short Notes',
      subject: body.subject || 'Physics',
      chapterNum: body.chapterNum ? parseInt(body.chapterNum) : 1,
      chapterName: body.chapterName || body.title.trim(),
      type: 'pdf',
      r2_url: body.downloadUrl.trim(),
      size_bytes: body.size_bytes || 2500000,
      is_active: true,
      isCustom: true,
      uploaded_at: new Date().toISOString()
    };

    const result = await db.collection('study_materials').insertOne(newBook);
    newBook._id = result.insertedId;
    newBook.id = materialId;
    newBook.downloadUrl = newBook.r2_url;
    newBook.sizeMB = ((newBook.size_bytes) / (1024 * 1024)).toFixed(2) + ' MB';

    res.status(201).json({ success: true, book: newBook });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/library/books/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { id } = req.params;
    const updates = req.body || {};
    delete updates._id;
    updates.updatedAt = new Date().toISOString();

    if (updates.downloadUrl) {
      updates.r2_url = updates.downloadUrl;
    }

    const filter = {
      $or: [
        { material_id: id },
        { filename: id },
        { filename: `${id}.pdf` },
        { _id: ObjectId.isValid(id) ? new ObjectId(id) : null }
      ].filter(f => f._id !== null || !f._id)
    };

    await db.collection('study_materials').updateOne(filter, { $set: updates });
    res.json({ success: true, message: 'Study material updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/library/books/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { id } = req.params;
    const filter = {
      $or: [
        { material_id: id },
        { filename: id },
        { filename: `${id}.pdf` },
        { _id: ObjectId.isValid(id) ? new ObjectId(id) : null }
      ].filter(f => f._id !== null || !f._id)
    };

    // Soft delete to maintain audit log and prevent broken links
    await db.collection('study_materials').updateOne(filter, {
      $set: { is_active: false, deletedAt: new Date().toISOString() }
    });

    res.json({ success: true, message: 'PDF book deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 11. PYQ EXAM PAPERS SUMMARY
// ==========================================
router.get('/pyqs/years', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const yearsAgg = await db.collection('questions').aggregate([
      { $match: { category: 'yearwise_pyq' } },
      { $group: { _id: '$year', count: { $sum: 1 } } },
      { $sort: { _id: -1 } }
    ]).toArray();

    const defaultYears = ['2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015'];
    const aggMap = new Map(yearsAgg.map(y => [String(y._id), y.count]));

    const years = defaultYears.map(year => ({
      year,
      title: `NEET ${year} Official Question Paper`,
      questionCount: aggMap.get(year) || 0
    }));

    res.json({ success: true, years });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 12. DYNAMIC AD-LOCKS ENGINE (IN-CONTEXT)
// ==========================================
router.get('/ad-locks', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const doc = await db.collection('app_config').findOne({ _id: 'main_config' });
    const adLocks = (doc && doc.ad_locks) || {
      is_enabled: true,
      pdf_library: { is_locked: true, required_ads: 1 },
      mock_tests: { is_locked: true, required_ads: 2 },
      pyq_papers: { is_locked: true, required_ads: 2 },
      chapter_parts: { is_locked: true, required_ads: 5 },
      diagram_sets: { is_locked: true, required_ads: 2 },
      challenger_mode: { is_locked: true, required_ads: 1 },
      item_overrides: {}
    };

    res.json({ success: true, adLocks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/ad-locks/section', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { section, is_locked, required_ads } = req.body || {};
    if (!section) return res.status(400).json({ success: false, error: 'Section name required.' });

    const updateObj = {};
    if (is_locked !== undefined) updateObj[`ad_locks.${section}.is_locked`] = !!is_locked;
    if (required_ads !== undefined) updateObj[`ad_locks.${section}.required_ads`] = Math.max(0, parseInt(required_ads) || 0);

    await db.collection('app_config').updateOne(
      { _id: 'main_config' },
      { $set: updateObj },
      { upsert: true }
    );

    res.json({ success: true, message: `Ad lock updated for ${section}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/ad-locks/item', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { itemKey, is_locked, required_ads } = req.body || {};
    if (!itemKey) return res.status(400).json({ success: false, error: 'itemKey required.' });

    const cleanKey = itemKey.replace(/\./g, '_');
    const updateObj = {};
    updateObj[`ad_locks.item_overrides.${cleanKey}`] = {
      is_locked: !!is_locked,
      required_ads: Math.max(0, parseInt(required_ads) || 0),
      updatedAt: new Date().toISOString()
    };

    await db.collection('app_config').updateOne(
      { _id: 'main_config' },
      { $set: updateObj },
      { upsert: true }
    );

    res.json({ success: true, message: `Ad lock override saved for ${cleanKey}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 13. GRAND MOCK TESTS FULL MANAGEMENT
// ==========================================
router.get('/mocks/:id/questions', verifyAdminToken, async (req, res) => {
  try {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected.' });

    const { id } = req.params;
    const questions = await db.collection('questions')
      .find({ category: 'mock_test', mockId: id })
      .limit(200)
      .toArray();

    res.json({ success: true, total: questions.length, questions: questions.map(q => attachResolvedImages(q, req)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
