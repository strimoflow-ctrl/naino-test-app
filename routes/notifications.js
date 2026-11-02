import express from 'express';
import { getMongoDb } from '../db.js';

const router = express.Router();

let firebaseAdmin = null;

async function getFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  try {
    const admin = await import('firebase-admin');
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (serviceAccountVar) {
      let credentials;
      try {
        credentials = typeof serviceAccountVar === 'string' ? JSON.parse(serviceAccountVar) : serviceAccountVar;
      } catch (_) {
        credentials = null;
      }

      if (credentials && !admin.default.apps.length) {
        admin.default.initializeApp({
          credential: admin.default.credential.cert(credentials),
        });
      }
      firebaseAdmin = admin.default;
      return firebaseAdmin;
    }

    if (!admin.default.apps.length) {
      admin.default.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'naino-neet-test-app',
      });
    }
    firebaseAdmin = admin.default;
    return firebaseAdmin;
  } catch (err) {
    console.warn('[FCM] Firebase Admin notice:', err.message);
    return null;
  }
}

// 1. Register or update FCM Device Token (Called when user reaches Home Screen)
router.post('/register-token', async (req, res) => {
  try {
    const { token, platform = 'android', deviceModel } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'FCM token is required' });
    }

    const db = getMongoDb();
    if (db) {
      await db.collection('user_device_tokens').updateOne(
        { token },
        {
          $set: {
            token,
            platform,
            deviceModel: deviceModel || 'Unknown',
            updatedAt: new Date(),
            active: true,
          },
        },
        { upsert: true }
      );
    }

    return res.status(200).json({ success: true, message: 'Device token registered successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Fetch Active In-App Notifications
router.get('/list', async (req, res) => {
  try {
    const db = getMongoDb();
    let list = [];
    if (db) {
      list = await db.collection('app_notifications')
        .find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
    }
    return res.status(200).json({ success: true, data: list });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Admin Broadcast Native Notification (Pops up on screen lock, background & foreground)
router.post('/broadcast', async (req, res) => {
  try {
    const {
      title,
      body,
      imageUrl,
      route = '/daily-test',
      tag = 'LIVE ARENA',
      adminKey,
    } = req.body;

    const validKey = adminKey === 'naino_admin_master_2026' || adminKey === process.env.ADMIN_SECRET;
    if (!validKey) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Invalid admin key' });
    }

    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body are required' });
    }

    const notificationDoc = {
      title,
      body,
      imageUrl: imageUrl || null,
      route,
      tag,
      createdAt: new Date(),
    };

    // Store in MongoDB Atlas app_notifications collection
    const db = getMongoDb();
    if (db) {
      await db.collection('app_notifications').insertOne(notificationDoc);
    }

    // Broadcast Native Push Notifications to all devices
    const pushResults = { sentCount: 0, failureCount: 0, totalTokens: 0 };
    const admin = await getFirebaseAdmin();

    if (admin && db) {
      const tokenDocs = await db.collection('user_device_tokens').find({ active: true }).toArray();
      const tokens = tokenDocs.map((d) => d.token).filter(Boolean);
      pushResults.totalTokens = tokens.length;

      if (tokens.length > 0) {
        // FCM multicast in batches of 500
        const batchSize = 500;
        for (let i = 0; i < tokens.length; i += batchSize) {
          const batch = tokens.slice(i, i + batchSize);
          const message = {
            notification: {
              title,
              body,
              ...(imageUrl ? { imageUrl } : {}),
            },
            data: {
              route: route || '/notifications',
              title,
              body,
              ...(imageUrl ? { imageUrl } : {}),
            },
            android: {
              priority: 'high',
              notification: {
                channelId: 'naino_live_alerts',
                priority: 'high',
                defaultSound: true,
                defaultVibrateTimings: true,
                icon: 'ic_launcher',
              },
            },
            tokens: batch,
          };

          try {
            const resp = await admin.messaging().sendEachForMulticast(message);
            pushResults.sentCount += resp.successCount;
            pushResults.failureCount += resp.failureCount;
          } catch (sendErr) {
            console.error('[FCM Batch Send Error]', sendErr.message);
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Notification broadcasted successfully',
      data: notificationDoc,
      pushResults,
    });
  } catch (err) {
    console.error('[Notification Broadcast Error]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
