import express from 'express';
import { getMongoDb, isMongoConnected } from '../db.js';

const router = express.Router();

// Default Fallback Configurations
const DEFAULT_APP_CONFIG = {
  header_target_text: "NEET 2027",
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
  announcement_ticker: "Welcome to Naino NEET 2027 Test Series! Daily Live Test opens at 7:00 PM IST.",
  is_maintenance: false
};

const DEFAULT_HOME_SECTIONS = [
  {
    card_id: "grand_mocks",
    title: "Grand Mock Tests",
    subtitle: "180 Qs • Full Syllabus",
    category: "mock",
    badge: "720 MARKS",
    icon_name: "timer",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/mock.png",
    gradient: ["#2563EB", "#1D4ED8"],
    route_key: "/grand-mocks",
    sort_order: 1,
    is_active: true
  },
  {
    card_id: "chapterwise_tests",
    title: "Chapter-Wise Tests",
    subtitle: "Physics, Chem & Bio",
    category: "tests",
    badge: "159+ CH",
    icon_name: "auto_stories",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/chapter.png",
    gradient: ["#0284C7", "#0369A1"],
    route_key: "/chapterwise-tests",
    sort_order: 2,
    is_active: true
  },
  {
    card_id: "challenger_mode",
    title: "Challenger Mode",
    subtitle: "Numericals & Tough Qs",
    category: "practice",
    badge: "30s BLITZ",
    icon_name: "bolt",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/challenger.png",
    gradient: ["#DC2626", "#B91C1C"],
    route_key: "/challenger-mode",
    sort_order: 3,
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
    gradient: ["#7C3AED", "#6D28D9"],
    route_key: "/pyq-papers",
    sort_order: 4,
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
    gradient: ["#0D9488", "#0F766E"],
    route_key: "/diagram-tests",
    sort_order: 5,
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
    gradient: ["#D97706", "#B45309"],
    route_key: "/repeated-pyqs",
    sort_order: 6,
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
    gradient: ["#059669", "#047857"],
    route_key: "/study-library",
    sort_order: 7,
    is_active: true
  },
  {
    card_id: "premium_desk",
    title: "Premium Desk",
    subtitle: "Slide Decks & PPTs",
    category: "library",
    badge: "SLIDES & PPT",
    icon_name: "slideshow",
    icon_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/icons/slides.png",
    gradient: ["#EA580C", "#C2410C"],
    route_key: "/premium-desk",
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
    size: "1.8 MB",
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
    size: "1.5 MB",
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
    size: "2.5 MB",
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
    size: "1.8 MB",
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
    size: "0.9 MB",
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

// 6. Batches System (Video Courses + Study Materials)
const DEFAULT_BATCHES = [
  {
    id: "batch_neet_2027_conqueror",
    title: "Target NEET 2027: Conqueror Batch",
    subtitle: "Complete Physics, Chemistry & Biology by Bhaiya",
    educator: "Bhaiya (4 Yrs NEET Ground Experience)",
    badge: "FLAGSHIP BATCH",
    rating: 4.9,
    studentsCount: 2450,
    price: 0,
    originalPrice: 2999,
    discount: "100% FREE (Early Access)",
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/human_health_and_disease.jpg",
    description: "Designed specifically for NEET 2026/2027 aspirants. Learn the exact exam tricks, high-yield NCERT pointers, and 4-year battle-tested problem-solving techniques directly from Bhaiya.",
    features: [
      "120+ Video Lectures by Bhaiya (Physics, Chem, Bio)",
      "Premium NCERT Mindmap PDFs & Handbooks included",
      "25 Full Syllabus NEET Mocks with AI Rank",
      "Direct 1-on-1 Mentor Doubt Support",
      "Valid till NEET 2027 Exam Date"
    ],
    demoVideoId: "dQw4w9WgXcQ",
    lectures: [
      {
        id: "lec_1",
        title: "How to Score 680+ in NEET: Bhaiya's 4-Year Strategy",
        subject: "Strategy",
        duration: "24:15",
        isDemo: true,
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      },
      {
        id: "lec_2",
        title: "Units & Dimensions: 10-Second Calculation Shortcuts",
        subject: "Physics",
        duration: "45:30",
        isDemo: true,
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      },
      {
        id: "lec_3",
        title: "Mole Concept & Stoichiometry Formula Tricks",
        subject: "Chemistry",
        duration: "52:10",
        isDemo: false,
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      },
      {
        id: "lec_4",
        title: "Cell The Unit of Life: Line by Line NCERT Decode",
        subject: "Biology",
        duration: "58:40",
        isDemo: false,
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      },
      {
        id: "lec_5",
        title: "Human Health & Disease: Immunity Diagrams & Traps",
        subject: "Biology",
        duration: "48:15",
        isDemo: false,
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      }
    ],
    materials: [
      {
        id: "mat_1",
        title: "Units & Measurements Master Formula Deck",
        subject: "Physics",
        size: "1.8 MB",
        isDemo: true,
        fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf"
      },
      {
        id: "mat_2",
        title: "Some Basic Concepts of Chemistry Deck",
        subject: "Chemistry",
        size: "1.5 MB",
        isDemo: true,
        fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/basic_concepts_of_chemistry.pdf"
      },
      {
        id: "mat_3",
        title: "Human Health & Disease Visual Mindmaps",
        subject: "Biology",
        size: "2.5 MB",
        isDemo: false,
        fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/human_health_and_disease.pdf"
      },
      {
        id: "mat_4",
        title: "Structure of Atom Quick Notes & PPT",
        subject: "Chemistry",
        size: "1.8 MB",
        isDemo: false,
        fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/structure_of_atom.pdf"
      },
      {
        id: "mat_5",
        title: "The Living World High-Yield Slides",
        subject: "Biology",
        size: "0.9 MB",
        isDemo: false,
        fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/the_living_world.pdf"
      }
    ]
  },
  {
    id: "batch_neet_crash_course",
    title: "NEET 90-Day High-Yield Crash Course",
    subtitle: "Top 100 Most Repeated Chapters with Question Bank",
    educator: "Bhaiya & Expert Team",
    badge: "CRASH COURSE",
    rating: 4.8,
    studentsCount: 1820,
    price: 0,
    originalPrice: 1999,
    discount: "100% FREE (Early Access)",
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/basic_concepts_of_chemistry.jpg",
    description: "Rapid revision batch focused solely on high-frequency questions and formula applications to boost your score by 150+ marks.",
    features: [
      "60 Targeted Fast-Paced Video Lectures",
      "Formula Formula Booster Handbook PDF",
      "15 High-Yield Mock Test Series",
      "Daily Doubt Clearing Support"
    ],
    demoVideoId: "dQw4w9WgXcQ",
    lectures: [
      {
        id: "lec_c1",
        title: "Crash Strategy: Which 40 Chapters Give 550+ Marks",
        subject: "Strategy",
        duration: "18:40",
        isDemo: true,
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      },
      {
        id: "lec_c2",
        title: "Kinematics & Projectile in 1 Shot",
        subject: "Physics",
        duration: "55:00",
        isDemo: false,
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      }
    ],
    materials: [
      {
        id: "mat_c1",
        title: "Top 100 Most Repeated Formulas Handbook",
        subject: "Physics & Chemistry",
        size: "1.8 MB",
        isDemo: true,
        fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf"
      }
    ]
  }
];

let inMemoryBatches = [...DEFAULT_BATCHES];

// GET /api/batches
router.get('/batches', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const batches = await db.collection('batches').find({}).toArray();
      if (batches && batches.length > 0) {
        return res.json({ total: batches.length, batches });
      }
    }
  } catch (err) {
    console.warn('MongoDB batches error:', err.message);
  }
  res.json({ total: inMemoryBatches.length, batches: inMemoryBatches });
});

// GET /api/batches/:id
router.get('/batches/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const batch = await db.collection('batches').findOne({ id });
      if (batch) return res.json(batch);
    }
  } catch (err) {
    console.warn('MongoDB batch single error:', err.message);
  }
  const found = inMemoryBatches.find(b => b.id === id);
  if (found) return res.json(found);
  res.status(404).json({ error: 'Batch not found' });
});

// 7. Test Packs API
router.get('/test-packs', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const packs = await db.collection('test_packs').find({}).toArray();
      if (packs && packs.length > 0) {
        return res.json({ total: packs.length, packs });
      }
    }
  } catch (err) {
    console.warn('MongoDB test_packs error:', err.message);
  }
  res.json({
    total: 3,
    packs: [
      {
        id: "test_pack_grand_mocks",
        title: "All-India Grand Mock Test Series 2027",
        subtitle: "Full 720-marks simulation with All-India Rank & Weak Area Analytics",
        badge: "720 MARKS",
        badgeColor: "#2563EB",
        price: 0,
        originalPrice: 1499,
        discount: "100% FREE",
        rating: 4.9,
        testsCount: 20,
        thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/units_and_measurements.jpg",
        description: "20 Full Length All-India Grand Mock Tests strictly adhering to the latest NTA NEET UG pattern. Includes timer, negative marking simulation, answer keys with detailed video solutions and rank predictor.",
        highlights: [
          "20 Full Length 720-Mark Simulation Papers",
          "Real NTA CBT Interface with timer & section switches",
          "Instant AI Performance & Weak Area Analytics",
          "All-India Percentile & Projected Rank Predictor"
        ]
      },
      {
        id: "test_pack_pyq_10yr",
        title: "NEET 10-Year (2015-2024) Solved PYQ Test Pack",
        subtitle: "Practice authentic past exam papers in real test engine",
        badge: "10 YEARS",
        badgeColor: "#7C3AED",
        price: 0,
        originalPrice: 999,
        discount: "100% FREE",
        rating: 4.8,
        testsCount: 14,
        thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/structure_of_atom.jpg",
        description: "Authentic questions from past 10 NEET UG examinations (2015 to 2024) organized year-by-year as interactive time-bound tests with step-by-step explanations.",
        highlights: [
          "Official NTA & CBSE NEET UG Question Papers",
          "Detailed explanations for Physics, Chemistry & Biology",
          "Filter questions by chapter and repeated frequency",
          "Re-attempt facility with instant score comparison"
        ]
      },
      {
        id: "test_pack_biology_diagram",
        title: "NCERT Biology 500+ Diagram & Traps Test Series",
        subtitle: "Visual NEET questions based exclusively on NCERT Diagrams",
        badge: "VISUAL NEET",
        badgeColor: "#059669",
        price: 0,
        originalPrice: 699,
        discount: "100% FREE",
        rating: 4.9,
        testsCount: 10,
        thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/human_health_and_disease.jpg",
        description: "Dedicated visual test series targeting labeling, flowcharts, histology slides and cycle diagrams from NCERT Class 11 and 12 Biology.",
        highlights: [
          "500+ High-Yield NCERT Diagram based questions",
          "Anatomy, Morphology, Genetics & Physiology special mocks",
          "Zero typing error with verified scientific keys"
        ]
      }
    ]
  });
});

// GET /api/test-packs/:id
router.get('/test-packs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const pack = await db.collection('test_packs').findOne({ id });
      if (pack) return res.json(pack);
    }
  } catch (err) {
    console.warn('MongoDB test_pack single error:', err.message);
  }
  res.status(404).json({ error: 'Test pack not found' });
});

export default router;
