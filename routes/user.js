import * as userController from '../controllers/userController.js';
import express from 'express';
import { getMongoDb, isMongoConnected } from '../db.js';
import { verifyToken, optionalToken } from '../middleware/auth.js';

const router = express.Router();

// --- STREAK ENGINE (In-Memory RAM cache + MongoDB Atlas) ---
let streakData = {
  currentStreak: 1,
  bestStreak: 1,
  lastActiveDate: null,
  history: []
};

function getTodayIST() {
  const now = new Date();
  return new Date(now.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];
}

// 1. GET Streak Info (MongoDB Atlas + In-Memory Fallback)
router.get('/streak', optionalToken, async (req, res) => {
  const userId = req.user?.id || req.user?.email || 'default_user';
  let userStreak = { ...streakData };

  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const doc = await db.collection('user_streaks').findOne({ userId });
      if (doc) {
        userStreak = {
          currentStreak: doc.currentStreak || 1,
          bestStreak: doc.bestStreak || 1,
          lastActiveDate: doc.lastActiveDate || null,
          history: doc.history || []
        };
      }
    }
  } catch (err) {
    console.warn('[User:Streak] Mongo fetch warning:', err.message);
  }

  res.json({
    currentStreak: userStreak.currentStreak,
    bestStreak: userStreak.bestStreak,
    lastActiveDate: userStreak.lastActiveDate,
    history: userStreak.history || []
  });
});

// 2. POST Ping / Update Streak (MongoDB Atlas Persistent)
router.post('/streak/ping', optionalToken, async (req, res) => {
  const userId = req.user?.id || req.user?.email || 'default_user';
  const today = getTodayIST();
  let userStreak = { ...streakData };

  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const doc = await db.collection('user_streaks').findOne({ userId });
      if (doc) {
        userStreak = {
          currentStreak: doc.currentStreak || 1,
          bestStreak: doc.bestStreak || 1,
          lastActiveDate: doc.lastActiveDate || null,
          history: doc.history || []
        };
      }
    }
  } catch (err) {
    console.warn('[User:Streak] Mongo lookup warning:', err.message);
  }

  if (userStreak.lastActiveDate !== today) {
    if (userStreak.lastActiveDate) {
      const lastDate = new Date(userStreak.lastActiveDate);
      const currDate = new Date(today);
      const diffDays = Math.round((currDate - lastDate) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        userStreak.currentStreak += 1;
      } else if (diffDays > 1) {
        userStreak.currentStreak = 1;
      }
    } else {
      userStreak.currentStreak = 1;
    }

    if (userStreak.currentStreak > userStreak.bestStreak) {
      userStreak.bestStreak = userStreak.currentStreak;
    }

    userStreak.lastActiveDate = today;
    if (!userStreak.history.includes(today)) {
      userStreak.history.push(today);
    }

    try {
      if (isMongoConnected()) {
        const db = getMongoDb();
        await db.collection('user_streaks').updateOne(
          { userId },
          { $set: { ...userStreak, userId, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
      }
    } catch (err) {
      console.warn('[User:Streak] Mongo update warning:', err.message);
    }

    streakData = { ...userStreak };
  }

  res.json({
    success: true,
    currentStreak: userStreak.currentStreak,
    bestStreak: userStreak.bestStreak,
    lastActiveDate: userStreak.lastActiveDate
  });
});

// --- BOOKMARKS (In-Memory + MongoDB Atlas) ---
let userBookmarks = [];

router.get('/bookmarks', (req, res) => {
  res.json({ totalBookmarks: userBookmarks.length, bookmarks: userBookmarks });
});

router.post('/bookmarks', (req, res) => {
  const item = req.body;
  if (item && item.id) {
    const idx = userBookmarks.findIndex(b => String(b.id) === String(item.id));
    if (idx >= 0) {
      userBookmarks.splice(idx, 1);
      return res.json({ success: true, isBookmarked: false, totalBookmarks: userBookmarks.length });
    } else {
      userBookmarks.unshift({ ...item, bookmarkedAt: new Date().toISOString() });
      return res.json({ success: true, isBookmarked: true, totalBookmarks: userBookmarks.length });
    }
  }
  res.status(400).json({ error: 'Invalid bookmark payload' });
});

// --- REAL USER PERFORMANCE & TEST RECORDS ---
let localTestRecords = [];

function calculateRank(avgScore, totalTests) {
  if (totalTests === 0) return 'Unranked';
  // Standard NEET distribution percentile simulation
  // 680-720: Top 50
  // 640-679: Top 150
  // 600-639: Top 500
  // 550-599: Top 1200
  if (avgScore >= 680) return `AIR #${Math.max(1, Math.floor(50 - (avgScore - 680)))}`;
  if (avgScore >= 640) return `AIR #${Math.floor(150 - (avgScore - 640) * 2.5)}`;
  if (avgScore >= 600) return `AIR #${Math.floor(500 - (avgScore - 600) * 8.75)}`;
  if (avgScore >= 550) return `AIR #${Math.floor(1200 - (avgScore - 550) * 14)}`;
  return `AIR #${Math.floor(2500 - (avgScore / 550) * 1000)}`;
}

// 3. GET /api/user/performance
router.get('/performance', async (req, res) => {
  const userId = req.query.userId || 'guest_user';

  let records = [];
  let mongoLoaded = false;
  if (isMongoConnected()) {
    try {
      const db = getMongoDb();
      records = await db.collection('user_test_records')
        .find({ userId })
        .sort({ submittedAt: -1 })
        .toArray();
      mongoLoaded = true;
    } catch (_) {}
  }
  if (!mongoLoaded) {
    records = localTestRecords.filter(r => r.userId === userId || !r.userId);
  }

  const totalTests = records.length;
  let totalScore = 0;
  let totalAccuracy = 0;
  let phyAcc = 0, chemAcc = 0, bioAcc = 0;
  let phyCount = 0, chemCount = 0, bioCount = 0;

  records.forEach(r => {
    totalScore += (r.score || 0);
    totalAccuracy += (r.accuracy || 0);

    if (r.subjectBreakdown) {
      if (r.subjectBreakdown.Physics) {
        phyAcc += r.subjectBreakdown.Physics.accuracy || 0;
        phyCount++;
      }
      if (r.subjectBreakdown.Chemistry) {
        chemAcc += r.subjectBreakdown.Chemistry.accuracy || 0;
        chemCount++;
      }
      if (r.subjectBreakdown.Biology) {
        bioAcc += r.subjectBreakdown.Biology.accuracy || 0;
        bioCount++;
      }
    }
  });

  const avgScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;
  const avgAccuracy = totalTests > 0 ? Math.round(totalAccuracy / totalTests) : 0;
  const recentScores = records.slice(0, 6).map(r => r.score || 0).reverse();
  const rank = totalTests > 0 ? calculateRank(avgScore, totalTests) : 'Unranked';

  res.json({
    userId,
    rank,
    totalTestsTaken: totalTests,
    avgScore,
    accuracy: avgAccuracy,
    streak: streakData.currentStreak,
    bestStreak: streakData.bestStreak,
    recentScores,
    subjectBreakdown: {
      physics: {
        name: 'Physics',
        accuracy: phyCount > 0 ? Math.round(phyAcc / phyCount) : 0,
        color: '#0284C7'
      },
      chemistry: {
        name: 'Chemistry',
        accuracy: chemCount > 0 ? Math.round(chemAcc / chemCount) : 0,
        color: '#8B5CF6'
      },
      biology: {
        name: 'Biology',
        accuracy: bioCount > 0 ? Math.round(bioAcc / bioCount) : 0,
        color: '#10B981'
      }
    }
  });
});

// 4. POST /api/user/test-record
router.post('/test-record', async (req, res) => {
  const {
    userId = 'guest_user',
    testTitle,
    category,
    score,
    totalMarks,
    accuracy,
    correctCount,
    wrongCount,
    unattemptedCount,
    durationSeconds,
    subjectBreakdown
  } = req.body;

  const record = {
    userId,
    testTitle: testTitle || 'NEET Test',
    category: category || 'practice',
    score: Number(score) || 0,
    totalMarks: Number(totalMarks) || 80,
    accuracy: Number(accuracy) || 0,
    correctCount: Number(correctCount) || 0,
    wrongCount: Number(wrongCount) || 0,
    unattemptedCount: Number(unattemptedCount) || 0,
    durationSeconds: Number(durationSeconds) || 0,
    subjectBreakdown: subjectBreakdown || {},
    submittedAt: new Date().toISOString()
  };

  // 1. Save to local in-memory fallback
  localTestRecords.unshift(record);

  // 2. Save to MongoDB Atlas
  if (isMongoConnected()) {
    try {
      const db = getMongoDb();
      await db.collection('user_test_records').insertOne(record);
      await db.collection('user_profiles').updateOne(
        { userId },
        {
          $inc: { totalTestsTaken: 1, totalScore: record.score },
          $set: { lastActive: record.submittedAt }
        },
        { upsert: true }
      );
    } catch (err) {
      console.warn('Error saving test record to MongoDB:', err.message);
    }
  }

  res.json({
    success: true,
    message: 'Test record saved successfully',
    record
  });
});

// 5. GET /api/user/test-history
router.get('/test-history', async (req, res) => {
  const userId = req.query.userId || 'guest_user';
  let records = [];
  let mongoLoaded = false;

  if (isMongoConnected()) {
    try {
      const db = getMongoDb();
      records = await db.collection('user_test_records')
        .find({ userId })
        .sort({ submittedAt: -1 })
        .limit(25)
        .toArray();
      mongoLoaded = true;
    } catch (_) {}
  }

  if (!mongoLoaded) {
    records = localTestRecords.filter(r => r.userId === userId || !r.userId).slice(0, 25);
  }

  res.json({
    totalRecords: records.length,
    records
  });
});

// 5.5 POST /api/user/clear-history
router.post('/clear-history', async (req, res) => {
  const userId = req.body.userId || 'guest_user';
  localTestRecords = localTestRecords.filter(r => r.userId && r.userId !== userId);

  if (isMongoConnected()) {
    try {
      const db = getMongoDb();
      await db.collection('user_test_records').deleteMany({ userId });
      await db.collection('user_profiles').deleteMany({ userId });
    } catch (_) {}
  }

  res.json({
    success: true,
    message: 'User test history cleared successfully'
  });
});

// 6. GET Profile (Returns dynamic user info from MongoDB)
router.get('/profile', optionalToken, userController.getProfile);

// 7. PUT Update Profile (Allows user to edit name and email with IP tracking)
router.put('/profile', verifyToken, userController.updateProfile);

// 8. PUT Change Password (Old password + New password with IP tracking)
router.put('/change-password', verifyToken, userController.changePassword);

export default router;
