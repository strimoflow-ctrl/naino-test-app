import express from 'express';
import { ObjectId } from 'mongodb';
import { getMongoDb, isMongoConnected } from '../db.js';

const router = express.Router();

// Clean Dynamic App Configuration
const DEFAULT_APP_CONFIG = {
  app_name: "Naino Academy",

  // 1. Version Update System (Hard vs Soft Update)
  version_control: {
    latest_version: "2.0.1",
    min_supported_version: "2.0.0",
    update_type: "none", // 'hard' (forces update) or 'soft' (dismissible) or 'none'
    title: "Exciting New Update Available! 🚀",
    message: "Naino Academy v2.0.1 includes brand new 3D Glassmorphic tests, AIR ranking fixes & lightning speed.",
    button_text: "Update on Play Store",
    playstore_url: "https://play.google.com/store/apps/details?id=com.naino.neet",
    changelog: [
      "Apple iOS 18 3D Glassmorphic Exam Interface",
      "Instant All-India Rank (AIR) & Percentile Engine",
      "Zero-Lag Offline Resilience & Auto Sync"
    ]
  },

  // 2. Full App Remote Lock (Technical Emergency / Maintenance)
  app_lock: {
    is_locked: false,
    title: "App Under Upgradation 🛠️",
    message: "We are currently performing scheduled maintenance to upgrade Naino Academy test servers. Please check back shortly!",
    expected_time: "Back online in ~30 minutes",
    support_phone: "+91 98765 43210"
  },

  // 3. Dynamic Sponsor & Announcement Popup
  sponsor_popup: {
    is_active: false,
    popup_id: "popup_announcement_live",
    image_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/banners/banner1.webp",
    title: "Special NEET Grand Mock Live! 🎉",
    title_color: "#10B981",
    message: "Bhaiya's 100% Free NCERT Line-by-Line Mock Test is now LIVE. Tap below to start your test!",
    message_color: "#475569",
    bg_color: "#FFFFFF",
    button_text: "Start Test Now 🚀",
    button_color: "#10B981",
    button_text_color: "#FFFFFF",
    action_type: "route", // 'route' or 'url'
    action_target: "/daily-test",
    show_once_per_day: false
  },

  // 4. Dynamic Ad Locks Configuration (Control which features require watching Ads)
  // Strictly restricted to Chapter Parts (Part 2+) and Submit Test per user directive
  ad_locks: {
    is_enabled: true,
    pdf_library: {
      is_locked: false,
      required_ads: 0
    },
    mock_tests: {
      is_locked: false,
      required_ads: 0
    },
    pyq_papers: {
      is_locked: false,
      required_ads: 0
    },
    chapter_parts: {
      is_locked: true,
      required_ads: 5
    },
    diagram_sets: {
      is_locked: false,
      required_ads: 0
    },
    challenger_mode: {
      is_locked: false,
      required_ads: 0
    },
    item_overrides: {}
  }
};

// 1. Dynamic App Configuration (Strictly returns only verified active keys)
router.get('/app-config', async (req, res) => {
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const cfg = await db.collection('app_config').findOne({ _id: 'main_config' });
      if (cfg) {
        return res.json({
          app_name: cfg.app_name || DEFAULT_APP_CONFIG.app_name,
          version_control: {
            ...DEFAULT_APP_CONFIG.version_control,
            ...(cfg.version_control || {})
          },
          app_lock: {
            ...DEFAULT_APP_CONFIG.app_lock,
            ...(cfg.app_lock || {})
          },
          sponsor_popup: {
            ...DEFAULT_APP_CONFIG.sponsor_popup,
            ...(cfg.sponsor_popup || {})
          },
          ad_locks: {
            ...DEFAULT_APP_CONFIG.ad_locks,
            ...(cfg.ad_locks || {})
          }
        });
      }
    }
  } catch (err) {
    console.warn('Error fetching app_config from MongoDB:', err.message);
  }
  res.json(DEFAULT_APP_CONFIG);
});

// 2c. Admin: Update Version Control (Hard/Soft Update, Version & Text)
router.post('/admin/config/update-version', async (req, res) => {
  try {
    const incomingKey = req.headers['x-admin-key'] || req.body.adminKey;
    const configuredSecret = process.env.ADMIN_SECRET || 'naino_admin_secure_vault_2026';
    if (!incomingKey || incomingKey !== configuredSecret) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Invalid admin key' });
    }

    const version_control = {
      ...DEFAULT_APP_CONFIG.version_control,
      ...(req.body.version_control || req.body)
    };

    if (isMongoConnected()) {
      const db = getMongoDb();
      await db.collection('app_config').updateOne(
        { _id: 'main_config' },
        { $set: { version_control } },
        { upsert: true }
      );
    }
    DEFAULT_APP_CONFIG.version_control = version_control;

    return res.json({
      success: true,
      message: 'Version control updated successfully',
      version_control
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2d. Admin: Remote App Lock / Maintenance Toggle
router.post('/admin/config/toggle-app-lock', async (req, res) => {
  try {
    const incomingKey = req.headers['x-admin-key'] || req.body.adminKey;
    const configuredSecret = process.env.ADMIN_SECRET || 'naino_admin_secure_vault_2026';
    if (!incomingKey || incomingKey !== configuredSecret) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Invalid admin key' });
    }

    const app_lock = {
      ...DEFAULT_APP_CONFIG.app_lock,
      ...(req.body.app_lock || req.body)
    };

    if (isMongoConnected()) {
      const db = getMongoDb();
      await db.collection('app_config').updateOne(
        { _id: 'main_config' },
        { $set: { app_lock } },
        { upsert: true }
      );
    }
    DEFAULT_APP_CONFIG.app_lock = app_lock;

    return res.json({
      success: true,
      message: `App lock status updated to ${app_lock.is_locked}`,
      app_lock
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2e. Admin: Dynamic Sponsor / Announcement Popup Manager
router.post('/admin/config/update-sponsor-popup', async (req, res) => {
  try {
    const incomingKey = req.headers['x-admin-key'] || req.body.adminKey;
    const configuredSecret = process.env.ADMIN_SECRET || 'naino_admin_secure_vault_2026';
    if (!incomingKey || incomingKey !== configuredSecret) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Invalid admin key' });
    }

    const sponsor_popup = {
      ...DEFAULT_APP_CONFIG.sponsor_popup,
      ...(req.body.sponsor_popup || req.body)
    };

    if (isMongoConnected()) {
      const db = getMongoDb();
      await db.collection('app_config').updateOne(
        { _id: 'main_config' },
        { $set: { sponsor_popup } },
        { upsert: true }
      );
    }
    DEFAULT_APP_CONFIG.sponsor_popup = sponsor_popup;

    return res.json({
      success: true,
      message: 'Sponsor popup updated successfully',
      sponsor_popup
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Premium Desk, Study Materials & Batches Decks System
const DEFAULT_PREMIUM_DESKS = [
  {
    id: "desk_1",
    title: "Units and Measurements",
    subtitle: "Target NEET Physics • Masterclass Formula Deck",
    subject: "Physics",
    chapter: "Units and Measurements",
    type: "PDF",
    actionType: "pdf",
    actionTarget: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf",
    isTrending: true,
    order: 1,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/units_and_measurements.jpg",
    size: "1.8 MB",
    gradient: ["#0284C7", "#0369A1"]
  },
  {
    id: "desk_2",
    title: "Some Basic Concepts of Chemistry",
    subtitle: "Target NEET Chemistry • Mole Concept & Stoichiometr y Deck",
    subject: "Chemistry",
    chapter: "Some Basic Concepts of Chemistry",
    type: "Slide Deck",
    actionType: "pdf",
    actionTarget: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/basic_concepts_of_chemistry.pdf",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/basic_concepts_of_chemistry.pdf",
    isTrending: true,
    order: 2,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/basic_concepts_of_chemistry.jpg",
    size: "1.5 MB",
    gradient: ["#D97706", "#B45309"]
  },
  {
    id: "desk_3",
    title: "Target NEET 2027 Conqueror Batch",
    subtitle: "Flagship live classes, DPPs and mentorship batch",
    subject: "Biology",
    chapter: "Complete NEET 2027",
    type: "Batch",
    actionType: "batch",
    actionTarget: "batch_neet_2027_conqueror",
    batchId: "batch_neet_2027_conqueror",
    isTrending: true,
    order: 3,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/human_health_and_disease.jpg",
    fileUrl: "",
    size: "Live Batch",
    gradient: ["#059669", "#047857"]
  },
  {
    id: "desk_4",
    title: "Structure of Atom - High Yield",
    subtitle: "Tracing the Electron: Dual Nature to Quantum Mechanics Model",
    subject: "Chemistry",
    chapter: "Structure of Atom",
    type: "Video",
    actionType: "video",
    actionTarget: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/structure_of_atom.pdf",
    isTrending: true,
    order: 4,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/structure_of_atom.jpg",
    size: "1.8 MB",
    gradient: ["#7C3AED", "#6D28D9"]
  },
  {
    id: "desk_5",
    title: "The Living World",
    subtitle: "NEET Biology • Conceptual Notes & Taxonomy Slides",
    subject: "Biology",
    chapter: "The Living World",
    type: "Slide Deck",
    actionType: "pdf",
    actionTarget: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/the_living_world.pdf",
    fileUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/the_living_world.pdf",
    isTrending: true,
    order: 5,
    thumbnail: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/thumbnails/the_living_world.jpg",
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

// POST /api/admin/premium-desk (Allows admin to add/update items: PDF, Video, Batch, Slide Deck)
router.post('/admin/premium-desk', async (req, res) => {
  const deskData = req.body;
  if (!deskData || !deskData.title) {
    return res.status(400).json({ error: 'Title is required for study deck / batch' });
  }

  const id = deskData.id || `desk_${Date.now()}`;
  const newItem = {
    ...deskData,
    id,
    type: deskData.type || 'PDF', // "PDF", "Video", "Batch", "Slide Deck"
    actionType: deskData.actionType || (deskData.fileUrl ? 'pdf' : (deskData.batchId ? 'batch' : 'route')),
    actionTarget: deskData.actionTarget || deskData.fileUrl || deskData.batchId || deskData.targetRoute || '',
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
    message: 'Deck/Batch saved successfully!',
    item: newItem
  });
});

// DELETE /api/admin/premium-desk/:id (Allows admin to remove items)
router.delete('/admin/premium-desk/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      await db.collection('premium_desks').deleteOne({
        $or: [{ id }, { _id: id }]
      });
    }
  } catch (err) {
    console.warn('MongoDB admin delete error:', err.message);
  }

  inMemoryPremiumDesks = inMemoryPremiumDesks.filter(d => d.id !== id);

  res.json({
    success: true,
    message: 'Deck/Batch deleted successfully!'
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
    ],
    subjects: [
      {
        id: "subj_physics",
        name: "Physics",
        chaptersCount: 18,
        totalLectures: 45,
        chapters: [
          {
            id: "phy_ch_1",
            title: "Units and Measurements",
            lecturesCount: 3,
            hasPdf: true,
            lectures: [
              {
                id: "phy_lec_1",
                title: "Units & Dimensions: 10-Second Calculation Shortcuts",
                tag: "Live Stream",
                duration: "45:30",
                isLive: true,
                date: "Streamed Today",
                videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                pdfUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf",
                notesPdfUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf",
                dppPdfUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf"
              },
              {
                id: "phy_lec_2",
                title: "Dimensional Analysis & Error Propagation Masterclass",
                tag: "Classroom",
                duration: "52:10",
                isLive: false,
                date: "29 Oct 2026",
                videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                notesPdfUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/units_and_measurements.pdf"
              }
            ]
          },
          {
            id: "phy_ch_2",
            title: "Kinematics in 1D & 2D",
            lecturesCount: 4,
            hasPdf: true,
            lectures: [
              {
                id: "phy_lec_3",
                title: "Relative Velocity & Projectile Trajectory Tricks",
                tag: "Upcoming Class",
                duration: "60:00",
                isUpcoming: true,
                scheduledTime: new Date(Date.now() + 7200000).toISOString(),
                date: "Tomorrow 7:00 PM",
                videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              }
            ]
          }
        ]
      },
      {
        id: "subj_chemistry",
        name: "Chemistry",
        chaptersCount: 16,
        totalLectures: 42,
        chapters: [
          {
            id: "chem_ch_1",
            title: "Some Basic Concepts of Chemistry",
            lecturesCount: 3,
            hasPdf: true,
            lectures: [
              {
                id: "chem_lec_1",
                title: "Mole Concept & Stoichiometry Formula Tricks",
                tag: "Classroom",
                duration: "52:10",
                isLive: false,
                date: "Streamed 2 days ago",
                videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                notesPdfUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/basic_concepts_of_chemistry.pdf"
              }
            ]
          }
        ]
      },
      {
        id: "subj_biology",
        name: "Biology",
        chaptersCount: 28,
        totalLectures: 65,
        chapters: [
          {
            id: "bio_ch_1",
            title: "Human Health and Disease",
            lecturesCount: 3,
            hasPdf: true,
            lectures: [
              {
                id: "bio_lec_1",
                title: "Immunity, Antibodies & Diagnostic Traps",
                tag: "Classroom",
                duration: "48:15",
                isLive: false,
                date: "Streamed 3 days ago",
                videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                notesPdfUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/study_library/premium_desks/human_health_and_disease.pdf"
              }
            ]
          }
        ]
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
      const queries = [{ id }];
      if (ObjectId.isValid(id)) queries.push({ _id: new ObjectId(id) });
      const batch = await db.collection('batches').findOne({ $or: queries });
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

// ==========================================
// 8. LECTURE & LIVE STREAM REAL-TIME CHAT API
// ==========================================
// GET /api/lectures/:lectureId/chat
router.get('/lectures/:lectureId/chat', async (req, res) => {
  const { lectureId } = req.params;
  const since = parseInt(req.query.since) || 0;

  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      const filter = { lectureId };
      if (since > 0) {
        filter.timestamp = { $gt: since };
      }

      const messages = await db.collection('lecture_chats')
        .find(filter)
        .sort({ timestamp: 1 })
        .limit(200)
        .toArray();

      if (messages.length > 0 || since > 0) {
        return res.json({ success: true, total: messages.length, messages });
      }
    }
  } catch (err) {
    console.warn('MongoDB lecture chat error:', err.message);
  }

  // Initial welcome message if chat room is fresh
  res.json({
    success: true,
    total: 1,
    messages: [
      {
        id: `welcome_${lectureId}`,
        lectureId,
        sender: 'Bhaiya (Mentor)',
        userId: 'admin_mentor',
        isMentor: true,
        text: 'Welcome to this class! Ask your doubts and formula queries here.',
        time: 'Just now',
        timestamp: Date.now()
      }
    ]
  });
});

// POST /api/lectures/:lectureId/chat
router.post('/lectures/:lectureId/chat', async (req, res) => {
  const { lectureId } = req.params;
  const body = req.body || {};
  const text = (body.text || '').trim();

  if (!text) {
    return res.status(400).json({ success: false, error: 'Message text cannot be empty.' });
  }

  const now = new Date();
  const hours = now.getHours();
  const mins = now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  const timeStr = `${hour12}:${mins} ${ampm}`;

  const newMsg = {
    id: body.id || `msg_${Date.now()}`,
    lectureId,
    sender: body.sender && body.sender.trim() ? body.sender.trim() : 'Student',
    userId: body.userId || 'anon_student',
    isMentor: body.isMentor === true,
    text,
    time: timeStr,
    timestamp: Date.now(),
    createdAt: now
  };

  try {
    if (isMongoConnected()) {
      const db = getMongoDb();
      await db.collection('lecture_chats').insertOne(newMsg);
      return res.status(201).json({ success: true, message: newMsg });
    }
  } catch (err) {
    console.warn('MongoDB chat insert error:', err.message);
  }

  res.status(201).json({ success: true, message: newMsg });
});

export default router;
