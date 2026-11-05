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

    // 1. DELETE the banner that user didn't want
    const delResult = await db.collection('banners').deleteOne({ bannerId: "banner_neet_conqueror_2027" });
    console.log(`Deleted extra banner: ${delResult.deletedCount}`);

    // 2. ACTIVATE SPONSOR POPUP IN DATABASE
    const sponsorPopup = {
      is_active: true,
      popup_id: "popup_live_" + Date.now(), // New ID so SharedPreferences always shows it
      image_url: "https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/banners/banner1.webp",
      title: "Special NEET Grand Mock Live! 🎉",
      title_color: "#10B981",
      message: "Bhaiya's 100% Free NCERT Line-by-Line Mock Test is now LIVE. Tap below to start your test!",
      message_color: "#475569",
      bg_color: "#FFFFFF",
      button_text: "Start Test Now 🚀",
      button_color: "#10B981",
      button_text_color: "#FFFFFF",
      action_type: "route",
      action_target: "/daily-test",
      show_once_per_day: false // Show on launch for testing
    };

    await db.collection('app_config').updateOne(
      { _id: 'main_config' },
      { $set: { sponsor_popup: sponsorPopup } },
      { upsert: true }
    );
    console.log("✅ Sponsor popup ACTIVATED in MongoDB with dynamic ID:", sponsorPopup.popup_id);

    // 3. INSERT FRESH NOTIFICATION
    const newNotif = {
      title: "📢 High-Yield Live Alert!",
      body: "Bhaiya's Formula slide handbooks & Daily Test are now unlocked. Check them out!",
      tag: "LIVE ALERT",
      route: "/daily-test",
      createdAt: new Date()
    };

    const notifRes = await db.collection('app_notifications').insertOne(newNotif);
    console.log("✅ New notification inserted in MongoDB with ID:", notifRes.insertedId);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.close();
  }
}

run();
