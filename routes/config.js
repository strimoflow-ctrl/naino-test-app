import express from 'express';
import { getMongoDb, isMongoConnected } from '../db.js';

const router = express.Router();

// Default Fallback Configurations
const DEFAULT_APP_CONFIG = {
  header_target_text: "NEET 2026",
  header_subtext: "Mission 720/720",
  header_badge: "Live Test Series",
  daily_challenge: {
    title: "Daily NEET 7:00 PM Live Challenge",
    subtitle: "20 Questions • 20 Minutes • National Ranking",
    badge: "LIVE NOW",
    duration_minutes: 20,
    total_questions: 20,
    is_enabled: true
  },
  announcement_ticker: "Welcome to Naino NEET 2026 Test Series! Daily Live Test opens at 7:00 PM IST.",
  is_maintenance: false
};

const DEFAULT_HOME_SECTIONS = [
  {
    card_id: "daily_challenge",
    title: "Daily 7 PM Live Test",
    subtitle: "20 Questions • 20 Mins",
    category: "live",
    badge: "DAILY LIVE",
    icon_name: "bolt",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/daily.png",
    gradient: ["#10B981", "#059669"],
    route_key: "/daily-test",
    sort_order: 1,
    is_active: true
  },
  {
    card_id: "grand_mocks",
    title: "Grand Mock Tests",
    subtitle: "180 Qs • Full Syllabus",
    category: "mock",
    badge: "ALL INDIA",
    icon_name: "timer",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/mock.png",
    gradient: ["#059669", "#047857"],
    route_key: "/grand-mocks",
    sort_order: 2,
    is_active: true
  },
  {
    card_id: "challenger_mode",
    title: "Challenger Mode",
    subtitle: "Numericals & Tough Qs",
    category: "practice",
    badge: "RANK BOOSTER",
    icon_name: "psychology",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/challenger.png",
    gradient: ["#047857", "#065F46"],
    route_key: "/challenger-mode",
    sort_order: 3,
    is_active: true
  },
  {
    card_id: "chapterwise_tests",
    title: "Chapter-Wise Tests",
    subtitle: "Physics, Chem & Bio",
    category: "tests",
    badge: "NCERT",
    icon_name: "menu_book",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/chapter.png",
    gradient: ["#10B981", "#047857"],
    route_key: "/chapterwise-tests",
    sort_order: 4,
    is_active: true
  },
  {
    card_id: "pyq_papers",
    title: "NEET PYQ Papers",
    subtitle: "2015 - 2024 Real Tests",
    category: "pyq",
    badge: "10 YEARS",
    icon_name: "history_edu",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/pyq.png",
    gradient: ["#059669", "#064E3B"],
    route_key: "/pyq-papers",
    sort_order: 5,
    is_active: true
  },
  {
    card_id: "study_library",
    title: "Study Library & PDFs",
    subtitle: "590+ PDFs & Notes",
    category: "library",
    badge: "HIGH YIELD",
    icon_name: "auto_stories",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/library.png",
    gradient: ["#047857", "#064E3B"],
    route_key: "/study-library",
    sort_order: 6,
    is_active: true
  },
  {
    card_id: "diagram_tests",
    title: "Diagram & Anatomy Tests",
    subtitle: "Visual NCERT Questions",
    category: "tests",
    badge: "VISUAL",
    icon_name: "image",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/diagram.png",
    gradient: ["#059669", "#065F46"],
    route_key: "/diagram-tests",
    sort_order: 7,
    is_active: true
  },
  {
    card_id: "repeated_pyqs",
    title: "Most Repeated PYQs",
    subtitle: "500+ Guaranteed MCQs",
    category: "practice",
    badge: "V.IMP",
    icon_name: "star",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/repeated.png",
    gradient: ["#10B981", "#047857"],
    route_key: "/repeated-pyqs",
    sort_order: 8,
    is_active: true
  }
];

// 1. Dynamic App Configuration
router.get('/app-config', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const cfg = await db.collection('app_config').findOne({ _id: 'main_config' });
      if (cfg) return res.json(cfg);
    }
  } catch (err) {
    console.warn('Error fetching app_config from MongoDB:', err.message);
  }
  res.json(DEFAULT_APP_CONFIG);
});

// 2. Dynamic Home Screen Sections / Categories
router.get('/home-layout', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const sections = await db.collection('home_sections')
        .find({ is_active: true })
        .sort({ sort_order: 1 })
        .toArray();
      if (sections && sections.length > 0) {
        return res.json({
          totalSections: sections.length,
          sections
        });
      }
    }
  } catch (err) {
    console.warn('Error fetching home_sections from MongoDB:', err.message);
  }
  res.json({
    totalSections: DEFAULT_HOME_SECTIONS.length,
    sections: DEFAULT_HOME_SECTIONS
  });
});

// 3. Dynamic Chapters from MongoDB
router.get('/dynamic-chapters', async (req, res) => {
  const { subject } = req.query;
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const query = { is_active: true };
      if (subject) query.subject = new RegExp(`^${subject}$`, 'i');
      const chapters = await db.collection('chapters')
        .find(query)
        .sort({ sort_order: 1 })
        .toArray();
      return res.json({
        totalChapters: chapters.length,
        chapters
      });
    }
  } catch (err) {
    console.warn('Error fetching chapters from MongoDB:', err.message);
  }
  res.json({ totalChapters: 0, chapters: [] });
});

// 4. Dynamic Study Materials (PDFs) from MongoDB
router.get('/study-materials', async (req, res) => {
  const { subject, type, search } = req.query;
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const query = { is_active: true };
      if (subject) query.subject = new RegExp(`^${subject}$`, 'i');
      if (type) query.type = type;
      if (search) query.title = new RegExp(search, 'i');

      const materials = await db.collection('study_materials')
        .find(query)
        .limit(100)
        .toArray();
      return res.json({
        totalMaterials: materials.length,
        materials
      });
    }
  } catch (err) {
    console.warn('Error fetching study_materials from MongoDB:', err.message);
  }
  res.json({ totalMaterials: 0, materials: [] });
});

export default router;
