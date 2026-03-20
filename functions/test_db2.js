const admin = require('firebase-admin');

// Try with applicationDefault or empty (works on GCP/firebase shell)
try {
  admin.initializeApp();
} catch(e) {}

const db = admin.firestore();

async function check() {
  console.log("Querying...");
  try {
    const snapshot = await db.collection('work_sessions')
      .where('source', '==', 'openclaw')
      .get();
      
    if (snapshot.empty) {
        console.log('No OpenClaw sessions found with source == openclaw!');
    } else {
        snapshot.docs.forEach(doc => {
          console.log(`[${doc.id}]`, JSON.stringify(doc.data(), null, 2));
        });
    }
    
    console.log("Querying all recent sessions just in case we miss source...");
    const snap2 = await db.collection('work_sessions')
      .orderBy('startTime', 'desc')
      .limit(3)
      .get();
      
    snap2.docs.forEach(doc => {
      console.log(`[${doc.id}]`, doc.data().source, doc.data().status, doc.data().employeeName);
    });

  } catch(e) {
    console.error("DB Query error:", e);
  }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
