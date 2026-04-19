/**
 * Quick script to check user role in Firestore and fix it if needed
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step',
});

const db = getFirestore();

async function checkAndFixUser() {
    const userId = 'zGAtGBkQCzZ4kBiaOvlvKdPc0ks1';
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
        const data = userDoc.data();
        console.log('User data:', JSON.stringify({
            email: data.email,
            role: data.role,
            status: data.status,
            companyId: data.companyId,
            displayName: data.displayName,
        }, null, 2));

        if (data.role !== 'admin') {
            console.log(`\nUser role is "${data.role}", updating to "admin"...`);
            await userRef.update({ role: 'admin' });
            console.log('✅ Role updated to admin');
        } else {
            console.log('\n✅ User already has admin role');
        }
    } else {
        console.log('❌ User document not found');
    }

    // Also verify the dev_logs were seeded
    const devLogs = await db.collection('dev_logs').get();
    console.log(`\n📝 dev_logs collection has ${devLogs.size} documents:`);
    devLogs.forEach(doc => {
        const data = doc.data();
        console.log(`  - ${data.content?.title} (published: ${data.isPublished})`);
    });

    process.exit(0);
}

checkAndFixUser();
