import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import { MongoClient } from 'mongodb';

const uri = "mongodb+srv://pankajkushwaha20093_db_user:N96BNSgzTD99kqLO@nainoneettest.wtw6lru.mongodb.net/?retryWrites=true&w=majority";
const dbName = "naino_neet_db";

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log("Connected to MongoDB Atlas!");
    const db = client.db(dbName);

    // 1. REMOVE / DISABLE SOFT UPDATE in database (Match version so no popup appears)
    const versionControlUpdate = {
      latest_version: "2.0.1",
      min_supported_version: "2.0.0",
      update_type: "none",
      title: "Latest Version Active",
      message: "You are on the latest version of Naino Academy.",
      button_text: "Up to Date",
      playstore_url: "https://play.google.com/store/apps/details?id=com.naino.neet"
    };

    await db.collection('app_config').updateOne(
      { _id: 'main_config' },
      { $set: { version_control: versionControlUpdate } },
      { upsert: true }
    );
    console.log("✅ Soft update removed from MongoDB config!");

    // 2. SEND LIVE NOTIFICATION
    const newNotification = {
      title: "🔥 Special NEET PYQ Challenge is Live!",
      body: "Bhaiya has unlocked 40 Guaranteed Repeated NCERT questions for you. Tap to practice now!",
      tag: "LIVE ALERT",
      route: "/daily-test",
      imageUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/banners/banner2.webp",
      createdAt: new Date()
    };

    const notifResult = await db.collection('app_notifications').insertOne(newNotification);
    console.log("✅ Live notification created in MongoDB with ID:", notifResult.insertedId);

    // 3. CHECK / SETUP POSTER (BANNERS)
    const existingBanners = await db.collection('banners').find({}).toArray();
    console.log(`Current active banners in database: ${existingBanners.length}`);

    // Insert or ensure fresh featured poster
    const posterBanner = {
      bannerId: "banner_neet_conqueror_2027",
      title: "Target NEET 2027: Conqueror Batch",
      subtitle: "100% Free NCERT Line-by-Line Video Classes & Handbooks",
      imageUrl: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/banners/banner1.webp",
      fallbackAsset: "assets/banners/banner1.webp",
      actionType: "route",
      actionTarget: "/notes",
      badge: "FREE BATCH",
      order: 1,
      isActive: true,
      updatedAt: new Date()
    };

    await db.collection('banners').updateOne(
      { bannerId: posterBanner.bannerId },
      { $set: posterBanner },
      { upsert: true }
    );
    console.log("✅ Featured poster / banner setup complete in MongoDB!");

  } catch (err) {
    console.error("Error during operations:", err);
  } finally {
    await client.close();
  }
}

run();
