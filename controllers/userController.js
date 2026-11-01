import { getMongoDb } from '../db.js';
import { getClientIp } from '../config/env.js';

/**
 * GET user profile from MongoDB Atlas (Pure user info, no Target Score/Exam clutter)
 */
export async function getProfile(req, res) {
  try {
    const userId = req.user?.userId;
    const db = getMongoDb();

    if (db && userId) {
      const user = await db.collection('users').findOne(
        { userId },
        { projection: { password: 0, refreshToken: 0 } }
      );
      if (user) {
        return res.json({
          success: true,
          userId: user.userId,
          name: user.name || 'Future Doctor',
          email: user.email || 'aspirant@naino.local',
          streak: user.streak || 1,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt
        });
      }
    }

    res.json({
      success: true,
      name: 'Future Doctor',
      email: 'aspirant@naino.local',
      streak: 1
    });
  } catch (err) {
    console.error('[User:GetProfile] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve profile.' });
  }
}

/**
 * PUT update profile (Name & Email) with client IP tracking
 */
export async function updateProfile(req, res) {
  try {
    const { name, email } = req.body;
    const userId = req.user?.userId;
    const clientIp = getClientIp(req);

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized.' });
    }

    const db = getMongoDb();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database connection offline.' });
    }

    const now = new Date();
    const updateFields = {
      updatedAt: now,
      lastUpdatedIp: clientIp
    };

    if (name && name.trim()) updateFields.name = name.trim();
    if (email && email.trim()) {
      const cleanEmail = email.trim().toLowerCase();
      // Check if new email is taken by another account
      const existing = await db.collection('users').findOne({
        email: cleanEmail,
        userId: { $ne: userId }
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'This email is already in use by another account.'
        });
      }
      updateFields.email = cleanEmail;
    }

    await db.collection('users').updateOne(
      { userId },
      {
        $set: updateFields,
        $push: {
          ipHistory: {
            $each: [{ ip: clientIp, action: 'profile_update', timestamp: now }],
            $slice: -20
          }
        }
      }
    );

    const updatedUser = await db.collection('users').findOne(
      { userId },
      { projection: { password: 0, refreshToken: 0 } }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: {
        userId: updatedUser.userId,
        name: updatedUser.name,
        email: updatedUser.email,
        streak: updatedUser.streak || 1
      }
    });
  } catch (err) {
    console.error('[User:UpdateProfile] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
}
