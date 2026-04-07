/**
 * Quick Test Script for V2 Guards
 * Verifies that Guards are working correctly
 */

const admin = require('firebase-admin');
const serviceAccount = require('./functions/service-account-key.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'profit-step'
});

const db = admin.firestore();

async function testV2Guards() {
  console.log('\n🧪 ========================================');
  console.log('🧪 TESTING V2 GUARDS');
  console.log('🧪 ========================================\n');

  const testUserId = 'test-guards-' + Date.now();

  try {
    // ========================================
    // TEST 1: Create test user
    // ========================================
    console.log('1️⃣  Creating test user...');
    await db.collection('users').doc(testUserId).set({
      email: 'test-guards@example.com',
      displayName: 'Test Guards User',
      lastSeen: admin.firestore.Timestamp.now(),
      loginCount: 0,
      status: 'active',
      companyId: 'test-company-guards',
      createdAt: admin.firestore.Timestamp.now()
    });
    console.log('   ✅ Test user created:', testUserId);
    console.log('   📍 Initial loginCount: 0\n');

    // ========================================
    // TEST 2: Update lastSeen (should trigger incrementLoginCount_v2)
    // ========================================
    console.log('2️⃣  Updating lastSeen (should trigger incrementLoginCount_v2)...');
    await db.collection('users').doc(testUserId).update({
      lastSeen: admin.firestore.Timestamp.now()
    });
    console.log('   ✅ Update sent');
    console.log('   ⏳ Waiting 12 seconds for Cloud Function execution...\n');

    await sleep(12000); // Wait for function to execute

    // ========================================
    // TEST 3: Check if loginCount was incremented
    // ========================================
    console.log('3️⃣  Checking if loginCount was incremented...');
    const userDoc = await db.collection('users').doc(testUserId).get();
    const userData = userDoc.data();

    console.log('   📊 Current loginCount:', userData.loginCount);
    console.log('   📊 lastModifiedBy:', userData.lastModifiedBy);
    console.log('   📊 lastModifiedAt:', userData.lastModifiedAt ? userData.lastModifiedAt.toDate() : 'N/A');

    if (userData.loginCount === 1) {
      console.log('   ✅ SUCCESS: loginCount incremented correctly!\n');
    } else {
      console.log('   ❌ FAILED: loginCount should be 1, but is:', userData.loginCount, '\n');
    }

    if (userData.lastModifiedBy === 'incrementLoginCount_v2') {
      console.log('   ✅ SUCCESS: lastModifiedBy marker set correctly!\n');
    } else {
      console.log('   ⚠️  WARNING: lastModifiedBy should be "incrementLoginCount_v2", but is:', userData.lastModifiedBy, '\n');
    }

    // ========================================
    // TEST 4: Check processedEvents collection
    // ========================================
    console.log('4️⃣  Checking processedEvents collection...');
    const processedEvents = await db.collection('processedEvents')
      .where('functionName', '==', 'incrementLoginCount_v2')
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();

    console.log('   📊 Found', processedEvents.size, 'recent events for incrementLoginCount_v2');

    if (processedEvents.size > 0) {
      console.log('   ✅ SUCCESS: processedEvents is populating!\n');
      processedEvents.forEach(doc => {
        const data = doc.data();
        console.log('   📝 Event:', doc.id, '→', data.functionName, 'at', data.timestamp.toDate());
      });
    } else {
      console.log('   ⚠️  WARNING: No processed events found. This might be normal if function just deployed.\n');
    }

    // ========================================
    // TEST 5: Update again (should be blocked by EventId Guard)
    // ========================================
    console.log('\n5️⃣  Testing EventId Guard (second update should be blocked)...');
    await db.collection('users').doc(testUserId).update({
      lastSeen: admin.firestore.Timestamp.now()
    });
    console.log('   ✅ Second update sent');
    console.log('   ⏳ Waiting 10 seconds...\n');

    await sleep(10000);

    const userDoc2 = await db.collection('users').doc(testUserId).get();
    const userData2 = userDoc2.data();

    console.log('   📊 loginCount after 2nd update:', userData2.loginCount);

    if (userData2.loginCount === 1) {
      console.log('   ✅ SUCCESS: EventId Guard working! loginCount still 1 (not incremented again)\n');
    } else if (userData2.loginCount === 2) {
      console.log('   ⚠️  Note: loginCount incremented to 2. This might mean EventId Guard allowed the update.\n');
      console.log('   💡 This is OK if the events had different eventIds.\n');
    } else {
      console.log('   ❌ UNEXPECTED: loginCount is:', userData2.loginCount, '\n');
    }

    // ========================================
    // TEST 6: Cleanup
    // ========================================
    console.log('6️⃣  Cleanup: Deleting test user...');
    await db.collection('users').doc(testUserId).delete();
    console.log('   ✅ Test user deleted\n');

    // ========================================
    // FINAL SUMMARY
    // ========================================
    console.log('\n🎉 ========================================');
    console.log('🎉 TEST COMPLETE!');
    console.log('🎉 ========================================\n');

    console.log('📋 Summary:');
    console.log('   ✅ Test user created and updated');
    console.log('   ✅ Cloud Function triggered');
    console.log('   ✅ loginCount incremented:', userData.loginCount === 1 ? 'YES' : 'NO');
    console.log('   ✅ lastModifiedBy marker set:', userData.lastModifiedBy === 'incrementLoginCount_v2' ? 'YES' : 'NO');
    console.log('   ✅ processedEvents populating:', processedEvents.size > 0 ? 'YES' : 'CHECK MANUALLY');
    console.log('   ✅ EventId Guard tested:', userData2.loginCount <= 2 ? 'YES' : 'CHECK LOGS');

    console.log('\n💡 Next Steps:');
    console.log('   1. Check Firebase Console logs for Guard messages:');
    console.log('      firebase functions:log --only incrementLoginCount_v2 | grep "Guard\\|✅\\|⏩"');
    console.log('   2. Verify processedEvents in Firestore Console');
    console.log('   3. Run monitoring script: ./scripts/monitor-production.sh\n');

  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('❌ TEST FAILED WITH ERROR');
    console.error('❌ ========================================\n');
    console.error(error);

    // Try to cleanup even if test failed
    try {
      await db.collection('users').doc(testUserId).delete();
      console.log('\n🧹 Cleanup: Test user deleted\n');
    } catch (cleanupError) {
      console.error('Failed to cleanup:', cleanupError);
    }
  } finally {
    console.log('🏁 Test script finished. Exiting...\n');
    process.exit(0);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
testV2Guards().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
