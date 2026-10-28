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
    card_id: "grand_mocks",
    title: "Grand Mock Tests",
    subtitle: "180 Qs • Full Syllabus",
    category: "mock",
    badge: "ALL INDIA",
    icon_name: "timer",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/mock.png",
    gradient: ["#059669", "#047857"],
    route_key: "/grand-mocks",
    sort_order: 1,
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
  },
  {
    card_id: "premium_desk",
    title: "Premium Desk",
    subtitle: "Slide Decks & PPTs",
    category: "library",
    badge: "PPT & PDF",
    icon_name: "slideshow",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/slides.png",
    gradient: ["#0284C7", "#0369A1"],
    route_key: "/premium-desk",
    sort_order: 9,
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
    console.warn('Error fetching study_materials:', err.message);
  }
  res.json({ totalMaterials: 0, materials: [] });
});

// 5. Premium Desk & PPT Slide Decks System
const DEFAULT_PREMIUM_DESKS = [
  {
    id: "desk_1",
    title: "Units and Measurements",
    subtitle: "Target NEET Physics • Masterclass Formula Deck",
    subject: "Physics",
    chapter: "Units and Measurements",
    type: "Slide Desk",
    badge: "TRENDING #1",
    isTrending: true,
    order: 1,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/units_and_measurements.jpg",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf",
    slidesCount: 20,
    size: "17.1 MB",
    gradient: ["#0284C7", "#0369A1"]
  },
  {
    id: "desk_2",
    title: "Some Basic Concepts of Chemistry",
    subtitle: "Target NEET Chemistry • Mole Concept & Stoichiometry Deck",
    subject: "Chemistry",
    chapter: "Some Basic Concepts of Chemistry",
    type: "Slide Desk",
    badge: "HIGH YIELD",
    isTrending: true,
    order: 2,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/basic_concepts_of_chemistry.jpg",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/basic_concepts_of_chemistry.pdf",
    slidesCount: 15,
    size: "14.3 MB",
    gradient: ["#D97706", "#B45309"]
  },
  {
    id: "desk_3",
    title: "Human Health and Disease",
    subtitle: "Visual Mindmaps: Immunity, Diseases & Paradigm of Health",
    subject: "Biology",
    chapter: "Human Health and Disease",
    type: "PPT",
    badge: "DIAGRAM MASTER",
    isTrending: true,
    order: 3,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/human_health_and_disease.jpg",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/human_health_and_disease.pdf",
    slidesCount: 20,
    size: "27.4 MB",
    gradient: ["#059669", "#047857"]
  },
  {
    id: "desk_4",
    title: "Structure of Atom",
    subtitle: "Tracing the Electron: Dual Nature to Quantum Mechanics Model",
    subject: "Chemistry",
    chapter: "Structure of Atom",
    type: "PPT",
    badge: "EXAM BOOSTER",
    isTrending: true,
    order: 4,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/structure_of_atom.jpg",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/structure_of_atom.pdf",
    slidesCount: 15,
    size: "20.2 MB",
    gradient: ["#7C3AED", "#6D28D9"]
  },
  {
    id: "desk_5",
    title: "The Living World",
    subtitle: "NEET Biology • Conceptual Notes & Taxonomy Slides",
    subject: "Biology",
    chapter: "The Living World",
    type: "Slide Desk",
    badge: "NCERT CRACKER",
    isTrending: true,
    order: 5,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/the_living_world.jpg",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/the_living_world.pdf",
    slidesCount: 10,
    size: "13.1 MB",
    gradient: ["#10B981", "#047857"]
  }
];

let inMemoryPremiumDesks = [...DEFAULT_PREMIUM_DESKS];

// GET /api/premium-desk (Fetches desks sorted by admin order)
router.get('/premium-desk', async (req, res) => {
  const { subject, trendingOnly } = req.query;
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const query = {};
      if (subject && subject !== 'All') query.subject = new RegExp(`^${subject}$`, 'i');
      if (trendingOnly === 'true') query.isTrending = true;

      const items = await db.collection('premium_desks')
        .find(query)
        .sort({ order: 1 })
        .toArray();

      if (items && items.length > 0) {
        return res.json({
          total: items.length,
          trending: items.filter(d => d.isTrending).sort((a, b) => (a.order || 99) - (b.order || 99)),
          desks: items
        });
      }
    }
  } catch (err) {
    console.warn('MongoDB premium_desks error, using in-memory:', err.message);
  }

  // In-memory fallback
  let list = inMemoryPremiumDesks.sort((a, b) => (a.order || 99) - (b.order || 99));
  if (subject && subject !== 'All') {
    list = list.filter(d => d.subject.toLowerCase() === subject.toLowerCase());
  }

  const trending = inMemoryPremiumDesks
    .filter(d => d.isTrending)
    .sort((a, b) => (a.order || 99) - (b.order || 99));

  res.json({
    total: list.length,
    trending,
    desks: list
  });
});

// POST /api/admin/premium-desk (Allows admin to set order, toggle trending, add new desks)
router.post('/admin/premium-desk', async (req, res) => {
  const deskData = req.body;
  if (!deskData || !deskData.title) {
    return res.status(400).json({ error: 'Title is required for slide desk' });
  }

  const id = deskData.id || `desk_${Date.now()}`;
  const newItem = {
    ...deskData,
    id,
    order: typeof deskData.order === 'number' ? deskData.order : 99,
    isTrending: deskData.isTrending !== undefined ? deskData.isTrending : true,
    updatedAt: new Date().toISOString()
  };

  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      await db.collection('premium_desks').updateOne(
        { id },
        { $set: newItem },
        { upsert: true }
      );
    }
  } catch (err) {
    console.warn('MongoDB admin update error:', err.message);
  }

  // Update in-memory
  const existingIdx = inMemoryPremiumDesks.findIndex(d => d.id === id);
  if (existingIdx >= 0) {
    inMemoryPremiumDesks[existingIdx] = newItem;
  } else {
    inMemoryPremiumDesks.push(newItem);
  }

  inMemoryPremiumDesks.sort((a, b) => (a.order || 99) - (b.order || 99));

  res.json({
    success: true,
    message: 'Premium desk saved successfully!',
    item: newItem
  });
});

export default router;
