const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function check() {
  console.log("Fetching openclaw sessions...");
  const snapshot = await db.collection('work_sessions')
  	  .orderBy('startTime', 'desc')
      .limit(10)
      .get();
      
  let found = 0;
  snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.source === 'openclaw' || data.employeeName === 'DRV Юля') {
          console.log(`[${doc.id}]`, JSON.stringify(data, null, 2));
          found++;
      }
  });
  console.log(`Summary: found ${found} OpenClaw sessions.`);
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
