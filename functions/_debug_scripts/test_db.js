const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'profit-step' }); // If it fails with auth, I'll figure it out
const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('work_sessions')
    .where('source', '==', 'openclaw')
    .orderBy('startTime', 'desc')
    .limit(5)
    .get();
    
  if (snapshot.empty) {
      console.log('No OpenClaw sessions found!');
      return;
  }
  
  snapshot.docs.forEach(doc => {
    console.log(`[${doc.id}]`, JSON.stringify(doc.data(), null, 2));
  });
}

check().catch(console.error);
