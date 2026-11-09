import express from 'express';
import { getMongoDb, isMongoConnected } from '../db.js';
import { optionalToken } from '../middleware/auth.js';

const router = express.Router();

// Memory Rate Limiter for Heartbeats (Key: sessionId or deviceId, Value: timestamp ms)
const lastHeartbeatMap = new Map();

// Helper to clean old entries from memory rate limiter every 15 mins
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of lastHeartbeatMap.entries()) {
    if (now - timestamp > 60000) {
      lastHeartbeatMap.delete(key);
    }
  }
}, 15 * 60 * 1000);

function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket.remoteAddress ||
    '127.0.0.1'
  );
}

// =========================================================================
// 1. LIVE HEARTBEAT (Every 30 Seconds, Anti-Spam Throttled)
// POST /api/analytics/heartbeat
// =========================================================================
router.post('/heartbeat', optionalToken, async (req, res) => {
  try {
    const {
      sessionId,
      deviceId,
      deviceModel,
      deviceBrand,
      currentScreen = 'UnknownScreen',
      totalAdsWatched = 0,
      sessionAdsWatched = 0
    } = req.body || {};

    if (!sessionId || !deviceId) {
      return res.status(400).json({ success: false, error: 'sessionId and deviceId are required' });
    }

    const now = Date.now();
    const rateLimitKey = `${sessionId}_${deviceId}`;
    const lastPing = lastHeartbeatMap.get(rateLimitKey);

    // Anti-Spam Check: Max 1 ping per 20 seconds per session
    if (lastPing && (now - lastPing) < 20000) {
      return res.status(200).json({
        success: true,
        throttled: true,
        isOnline: true,
        message: 'Heartbeat throttled (too frequent). Still active.'
      });
    }

    lastHeartbeatMap.set(rateLimitKey, now);

    const clientIp = getClientIp(req);
    const userId = req.user?.userId || req.body?.userId || null;
    const db = getMongoDb();

    if (isMongoConnected() && db) {
      const nowDate = new Date(now);
      const adsCount = Math.max(0, parseInt(totalAdsWatched) || 0);
      const sessAds = Math.max(0, parseInt(sessionAdsWatched) || 0);

      // 1. Upsert into user_presence collection
      const presenceUpdate = {
        deviceId,
        sessionId,
        userId,
        currentScreen,
        deviceModel: deviceModel || 'Unknown',
        deviceBrand: deviceBrand || 'Unknown',
        ip: clientIp,
        isOnline: true,
        lastPingAt: nowDate
      };
      if (adsCount > 0) {
        presenceUpdate.totalAdsWatched = adsCount;
        presenceUpdate.sessionAdsWatched = sessAds;
      }

      await db.collection('user_presence').updateOne(
        { deviceId },
        { $set: presenceUpdate },
        { upsert: true }
      );

      // 2. If user is logged in, also update users collection
      if (userId) {
        const userSetFields = {
          isOnline: true,
          lastPingAt: nowDate,
          currentScreen
        };
        const updateOp = { $set: userSetFields };
        if (adsCount > 0) {
          updateOp.$max = { adsWatchedCount: adsCount };
        }
        await db.collection('users').updateOne(
          { userId },
          updateOp
        );
      }
    }

    return res.status(200).json({
      success: true,
      isOnline: true,
      serverTime: new Date(now).toISOString()
    });
  } catch (err) {
    console.error('[Analytics:Heartbeat] Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// 2. BATCH EVENT PACKETS UPLOAD (Screen Time & Usage Analytics + Ads Tracking)
// POST /api/analytics/events-batch
// =========================================================================
router.post('/events-batch', optionalToken, async (req, res) => {
  try {
    const {
      sessionId,
      deviceId,
      deviceModel,
      deviceBrand,
      totalAdsWatched = 0,
      sessionAdsWatched = 0,
      events
    } = req.body || {};

    if (!sessionId || !deviceId) {
      return res.status(400).json({ success: false, error: 'sessionId and deviceId are required' });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, error: 'events must be a non-empty array' });
    }

    // Anti-abuse: limit max events per batch
    if (events.length > 50) {
      return res.status(400).json({ success: false, error: 'Max 50 events allowed per batch upload' });
    }

    const clientIp = getClientIp(req);
    const userId = req.user?.userId || req.body?.userId || null;
    const db = getMongoDb();
    const adsCount = Math.max(0, parseInt(totalAdsWatched) || 0);

    if (isMongoConnected() && db) {
      const now = new Date();
      const docsToInsert = [];
      let adsInThisBatch = 0;

      for (const ev of events) {
        if (ev.eventType === 'ad_watched') {
          adsInThisBatch++;
          const adType = (ev.adType || 'rewarded').toString();
          const placement = (ev.placement || 'general').toString();
          const itemKey = (ev.itemKey || '').toString();

          docsToInsert.push({
            sessionId,
            deviceId,
            userId,
            eventType: 'ad_watched',
            adType,
            placement,
            itemKey,
            screenName: ev.screenName || 'UnknownScreen',
            deviceModel: deviceModel || 'Unknown',
            deviceBrand: deviceBrand || 'Unknown',
            ip: clientIp,
            sessionAdsCount: ev.sessionAdsCount || 0,
            totalAdsCount: ev.totalAdsCount || adsCount,
            createdAt: now
          });

          // Global ad metrics aggregate
          await db.collection('ad_metrics').updateOne(
            { _id: 'overview' },
            {
              $inc: {
                totalAdsWatched: 1,
                [`byType.${adType}`]: 1,
                [`byPlacement.${placement.replace(/\./g, '_')}`]: 1
              },
              $set: { lastAdWatchedAt: now }
            },
            { upsert: true }
          );
        } else {
          // Screen View packet
          const screenName = (ev.screenName || 'UnknownScreen').toString().trim();
          const durationSeconds = Math.max(0, parseInt(ev.durationSeconds) || 0);
          const enteredAt = ev.enteredAt ? new Date(ev.enteredAt) : now;
          const exitedAt = ev.exitedAt ? new Date(ev.exitedAt) : now;

          docsToInsert.push({
            sessionId,
            deviceId,
            userId,
            eventType: 'screen_view',
            deviceModel: deviceModel || 'Unknown',
            deviceBrand: deviceBrand || 'Unknown',
            ip: clientIp,
            screenName,
            durationSeconds,
            adsWatchedTotal: ev.adsWatchedTotal ?? adsCount,
            enteredAt,
            exitedAt,
            createdAt: now
          });

          // Atomic Aggregation for real-time popular screens
          await db.collection('screen_metrics').updateOne(
            { screenName },
            {
              $inc: {
                totalVisits: 1,
                totalDurationSeconds: durationSeconds
              },
              $set: {
                lastVisitedAt: now
              }
            },
            { upsert: true }
          );
        }
      }

      if (docsToInsert.length > 0) {
        await db.collection('screen_analytics').insertMany(docsToInsert);
      }

      // Update user presence with ads count
      if (adsCount > 0) {
        await db.collection('user_presence').updateOne(
          { deviceId },
          {
            $max: { totalAdsWatched: adsCount },
            $set: { lastPingAt: now }
          }
        );
      }

      // If user is registered, record user ad count
      if (userId) {
        const userUpdate = { $set: { lastActive: now } };
        if (adsCount > 0) {
          userUpdate.$max = { adsWatchedCount: adsCount };
        }
        if (adsInThisBatch > 0) {
          userUpdate.$set.lastAdWatchedAt = now;
        }
        await db.collection('users').updateOne({ userId }, userUpdate);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Events recorded successfully and safe to delete locally',
      processedCount: events.length
    });
  } catch (err) {
    console.error('[Analytics:EventsBatch] Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

