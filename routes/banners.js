import express from 'express';
import { getMongoDb, isMongoConnected } from '../db.js';

const router = express.Router();

// Default High-Performance Banners (Hosted on Cloudflare R2 with instant local fallback)
export const DEFAULT_BANNERS = [
  {
    bannerId: 'banner_welcome',
    title: 'Welcome to Naino',
    subtitle: 'NEET Tests & PYQs • Best Study Notes & Video Lectures',
    imageUrl: 'https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/banners/banner1.webp',
    fallbackAsset: 'assets/banners/banner1.webp',
    actionType: 'route',
    actionTarget: '/notes',
    badge: 'WELCOME',
    order: 1,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    bannerId: 'banner_live_test',
    title: 'NEET Live Test @ 7:00 PM',
    subtitle: 'Real Exam Pattern • Instant Result • Detailed Analysis',
    imageUrl: 'https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/banners/banner2.webp',
    fallbackAsset: 'assets/banners/banner2.webp',
    actionType: 'tab',
    actionTarget: 'tests',
    badge: 'LIVE TEST',
    order: 2,
    isActive: true,
    createdAt: new Date().toISOString()
  }
];

/**
 * 1. GET /api/banners - Public endpoint for mobile app
 * Fetches all active banners ordered by priority
 */
router.get('/banners', async (req, res) => {
  try {
    const db = getMongoDb();
    if (db && isMongoConnected()) {
      const bannersCol = db.collection('banners');
      const count = await bannersCol.countDocuments();
      
      // Auto-seed default banners if collection is brand new
      if (count === 0) {
        await bannersCol.insertMany(DEFAULT_BANNERS);
        console.log('[Banners] Seeded initial banners to MongoDB Atlas');
      }

      const banners = await bannersCol
        .find({ isActive: { $ne: false } })
        .sort({ order: 1, _id: 1 })
        .toArray();

      if (banners && banners.length > 0) {
        return res.json({
          success: true,
          count: banners.length,
          data: banners
        });
      }
    }

    // High-speed fallback
    res.json({
      success: true,
      count: DEFAULT_BANNERS.length,
      data: DEFAULT_BANNERS
    });
  } catch (err) {
    console.error('[Banners:Get] Error:', err);
    res.json({
      success: true,
      count: DEFAULT_BANNERS.length,
      data: DEFAULT_BANNERS
    });
  }
});

/**
 * 2. POST /api/banners - Admin: Add new banner
 */
router.post('/banners', async (req, res) => {
  try {
    const { title, subtitle, imageUrl, actionType, actionTarget, badge, order, fallbackAsset } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ success: false, error: 'Banner imageUrl is required.' });
    }

    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database is currently offline.' });
    }

    const bannerId = `banner_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newBanner = {
      bannerId,
      title: title || '',
      subtitle: subtitle || '',
      imageUrl: imageUrl.trim(),
      fallbackAsset: fallbackAsset || '',
      actionType: actionType || 'none',
      actionTarget: actionTarget || '',
      badge: badge || '',
      order: typeof order === 'number' ? order : 1,
      isActive: true,
      createdAt: new Date()
    };

    await db.collection('banners').insertOne(newBanner);

    res.status(201).json({
      success: true,
      message: 'Banner added successfully!',
      banner: newBanner
    });
  } catch (err) {
    console.error('[Banners:Create] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to create banner.' });
  }
});

/**
 * 3. PUT /api/banners/:id - Admin: Update banner details / order / active state
 */
router.put('/banners/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body, updatedAt: new Date() };
    delete updateData._id;

    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database offline.' });
    }

    const result = await db.collection('banners').updateOne(
      { $or: [{ bannerId: id }, { _id: id }] },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Banner not found.' });
    }

    res.json({ success: true, message: 'Banner updated successfully!' });
  } catch (err) {
    console.error('[Banners:Update] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to update banner.' });
  }
});

/**
 * 4. DELETE /api/banners/:id - Admin: Delete banner
 */
router.delete('/banners/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database offline.' });
    }

    const result = await db.collection('banners').deleteOne(
      { $or: [{ bannerId: id }, { _id: id }] }
    );

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Banner not found.' });
    }

    res.json({ success: true, message: 'Banner deleted successfully!' });
  } catch (err) {
    console.error('[Banners:Delete] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete banner.' });
  }
});

export default router;

