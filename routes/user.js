import express from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../db.js';

const router = express.Router();
const STREAK_FILE = path.join(DATA_DIR, 'user_streak.json');
const BOOKMARKS_FILE = path.join(DATA_DIR, 'user_bookmarks.json');
const PROFILE_FILE = path.join(DATA_DIR, 'user_profile.json');

// --- STREAK ENGINE ---
let streakData = {
  currentStreak: 5,
  bestStreak: 7,
  lastActiveDate: null,
  history: []
};

if (fs.existsSync(STREAK_FILE)) {
  try {
    streakData = JSON.parse(fs.readFileSync(STREAK_FILE, 'utf-8'));
  } catch (_) {}
}

function saveStreakToDisk() {
  try {
    fs.writeFileSync(STREAK_FILE, JSON.stringify(streakData, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving streak:', err);
  }
}

function getTodayIST() {
  const now = new Date();
  return new Date(now.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];
}

// 1. GET Streak Info
router.get('/streak', (req, res) => {
  res.json({
    currentStreak: streakData.currentStreak,
    bestStreak: streakData.bestStreak,
    lastActiveDate: streakData.lastActiveDate,
    history: streakData.history || []
  });
});

// 2. POST Ping / Update Streak
router.post('/streak/ping', (req, res) => {
  const today = getTodayIST();

  if (streakData.lastActiveDate !== today) {
    if (streakData.lastActiveDate) {
      const lastDate = new Date(streakData.lastActiveDate);
      const currDate = new Date(today);
      const diffDays = Math.round((currDate - lastDate) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        streakData.currentStreak += 1;
      } else if (diffDays > 1) {
        streakData.currentStreak = 1;
      }
    } else {
      streakData.currentStreak = 1;
    }

    if (streakData.currentStreak > streakData.bestStreak) {
      streakData.bestStreak = streakData.currentStreak;
    }

    streakData.lastActiveDate = today;
    if (!streakData.history.includes(today)) {
      streakData.history.push(today);
    }

    saveStreakToDisk();
  }

  res.json({
    success: true,
    currentStreak: streakData.currentStreak,
    bestStreak: streakData.bestStreak,
    lastActiveDate: streakData.lastActiveDate
  });
});

// --- BOOKMARKS ---
let userBookmarks = [];
if (fs.existsSync(BOOKMARKS_FILE)) {
  try {
    userBookmarks = JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf-8'));
  } catch (_) {}
}

function saveBookmarksToDisk() {
  try {
    fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(userBookmarks, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving bookmarks:', err);
  }
}

router.get('/bookmarks', (req, res) => {
  res.json({ totalBookmarks: userBookmarks.length, bookmarks: userBookmarks });
});

router.post('/bookmarks', (req, res) => {
  const item = req.body;
  if (item && item.id) {
    const idx = userBookmarks.findIndex(b => String(b.id) === String(item.id));
    if (idx >= 0) {
      userBookmarks.splice(idx, 1);
      saveBookmarksToDisk();
      return res.json({ success: true, isBookmarked: false, totalBookmarks: userBookmarks.length });
    } else {
      userBookmarks.unshift({ ...item, bookmarkedAt: new Date().toISOString() });
      saveBookmarksToDisk();
      return res.json({ success: true, isBookmarked: true, totalBookmarks: userBookmarks.length });
    }
  }
  res.status(400).json({ error: 'Invalid bookmark payload' });
});

// --- PROFILE & PERFORMANCE STATS ---
let userProfile = {
  name: 'Future Doctor',
  targetExam: 'NEET 2026',
  targetScore: '680+ / 720',
  totalTestsTaken: 12,
  totalQuestionsSolved: 284,
  accuracy: 86.5,
  joinedAt: '2026-01-01'
};

if (fs.existsSync(PROFILE_FILE)) {
  try {
    userProfile = { ...userProfile, ...JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8')) };
  } catch (_) {}
}

router.get('/profile', (req, res) => {
  res.json({
    ...userProfile,
    streak: streakData.currentStreak,
    bestStreak: streakData.bestStreak,
    totalBookmarks: userBookmarks.length
  });
});

router.post('/profile', (req, res) => {
  userProfile = { ...userProfile, ...req.body };
  try {
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(userProfile, null, 2), 'utf-8');
  } catch (_) {}
  res.json({ success: true, profile: userProfile });
});

export default router;
