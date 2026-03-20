const admin = require('firebase-admin');
const fs = require('fs');

if (fs.existsSync('./serviceAccountKey.json')) {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  admin.initializeApp();
}

const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('work_sessions')
      .where('source', '==', 'openclaw')
      .orderBy('startTime', 'desc')
      .limit(3)
      .get();
      
  snapshot.docs.forEach(doc => {
      console.log(`[${doc.id}]`, doc.data());
  });
}
check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
