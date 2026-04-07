const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // I might need to initialize differently or use the default ADC

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});
const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('work_sessions').orderBy('startTime', 'desc').limit(10).get();
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    console.log(`ID: ${doc.id}, Source: ${data.source}, Status: ${data.status}, Name: ${data.employeeName}, Time: ${data.startTime.toDate()}`);
  });
}
check().catch(console.error);
