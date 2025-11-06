# 🧪 V2 GUARDS - MANUAL TESTING GUIDE

**Purpose**: Verify that V2 Guards work correctly with real user updates
**Time Required**: 5-10 minutes
**When to Run**: Right now (to validate deployment)

---

## 🎯 TESTING STRATEGY

We'll create test user updates and verify Guards activate correctly.

### Test Scenarios

1. **Test EventId Guard** - Verify duplicate events are blocked
2. **Test Field Change Guard** - Verify unchanged fields are ignored
3. **Test Self-Update Guard** - Verify self-triggering is prevented
4. **Test Full Execution** - Verify legitimate updates succeed

---

## 🔧 OPTION 1: Manual Testing (Via Firebase Console)

### Step 1: Update a Test User

1. Open Firebase Console → Firestore
2. Navigate to `users` collection
3. Find ANY user document (or create a test user)
4. Click "Edit" and modify `lastSeen` field:
   ```
   lastSeen: (current timestamp)
   ```
5. Save the document

### Step 2: Check Logs (Wait 10 seconds)

```bash
# Check incrementLoginCount_v2 logs
firebase functions:log --only incrementLoginCount_v2 | grep "Guard\|✅\|⏩" | head -10
```

### Expected Output:
```
✅ Field Guard: lastSeen changed (null → 2025-11-06...)
✅ Full Guard: All checks passed for incrementLoginCount_v2
✅ incrementLoginCount_v2: Login count incremented for user abc123
```

### Step 3: Update Same User Again (Test EventId Guard)

1. Update the SAME user's `lastSeen` again
2. Wait 10 seconds
3. Check logs again

### Expected Output:
```
⏩ EventId Guard: Event xyz789 already processed
(Function should exit early)
```

### Step 4: Update Irrelevant Field (Test Field Guard)

1. Update the user's `title` field only (not lastSeen)
2. Wait 10 seconds
3. Check incrementLoginCount_v2 logs

### Expected Output:
```
⏩ Field Guard: lastSeen unchanged
(Function should exit early)
```

---

## 🔧 OPTION 2: Programmatic Testing (Faster)

Create a simple test script:

### Step 1: Create Test Script

```bash
# Create test-guards.js in functions folder
cd /Users/denysharbuzov/Projects/profit-step
cat > test-guards-manual.js << 'EOF'
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./functions/service-account-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function testGuards() {
  console.log('🧪 Testing V2 Guards...\n');

  // Find or create test user
  const testUserId = 'test-user-' + Date.now();

  console.log('1️⃣ Creating test user...');
  await db.collection('users').doc(testUserId).set({
    email: 'test@example.com',
    displayName: 'Test User',
    lastSeen: admin.firestore.Timestamp.now(),
    loginCount: 0,
    status: 'active',
    companyId: 'test-company-123'
  });
  console.log('   ✅ Test user created:', testUserId);

  console.log('\n2️⃣ Updating lastSeen (should trigger incrementLoginCount_v2)...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await db.collection('users').doc(testUserId).update({
    lastSeen: admin.firestore.Timestamp.now()
  });
  console.log('   ✅ Update sent');

  console.log('\n3️⃣ Waiting 10 seconds for function execution...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log('\n4️⃣ Checking if loginCount was incremented...');
  const userDoc = await db.collection('users').doc(testUserId).get();
  const userData = userDoc.data();
  console.log('   Current loginCount:', userData.loginCount);
  console.log('   lastModifiedBy:', userData.lastModifiedBy);

  if (userData.loginCount === 1 && userData.lastModifiedBy === 'incrementLoginCount_v2') {
    console.log('\n   ✅ SUCCESS! Guard protection working correctly!');
  } else {
    console.log('\n   ⚠️ Unexpected result. Check Firebase logs.');
  }

  console.log('\n5️⃣ Checking processedEvents collection...');
  const processedEvents = await db.collection('processedEvents')
    .where('functionName', '==', 'incrementLoginCount_v2')
    .orderBy('timestamp', 'desc')
    .limit(5)
    .get();

  console.log(`   Found ${processedEvents.size} recent events`);
  processedEvents.forEach(doc => {
    const data = doc.data();
    console.log(`   - Event ${doc.id} at ${data.timestamp.toDate()}`);
  });

  console.log('\n6️⃣ Cleanup: Deleting test user...');
  await db.collection('users').doc(testUserId).delete();
  console.log('   ✅ Test user deleted');

  console.log('\n🎉 Test complete! Check Firebase Console logs for Guard messages.');
  console.log('   Run: firebase functions:log --only incrementLoginCount_v2\n');

  process.exit(0);
}

testGuards().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
EOF
```

### Step 2: Run Test

```bash
# Install dependencies if needed
cd /Users/denysharbuzov/Projects/profit-step
npm install firebase-admin

# Run test
node test-guards-manual.js
```

### Expected Output:
```
🧪 Testing V2 Guards...

1️⃣ Creating test user...
   ✅ Test user created: test-user-1730901234567

2️⃣ Updating lastSeen (should trigger incrementLoginCount_v2)...
   ✅ Update sent

3️⃣ Waiting 10 seconds for function execution...

4️⃣ Checking if loginCount was incremented...
   Current loginCount: 1
   lastModifiedBy: incrementLoginCount_v2

   ✅ SUCCESS! Guard protection working correctly!

5️⃣ Checking processedEvents collection...
   Found 1 recent events
   - Event abc123-xyz789 at Wed Nov 06 2025 12:50:00 GMT

6️⃣ Cleanup: Deleting test user...
   ✅ Test user deleted

🎉 Test complete! Check Firebase Console logs for Guard messages.
```

---

## 🔧 OPTION 3: Use Existing User (Simplest)

If you have the app running locally:

### Step 1: Log Into App
```bash
# Start the app (if not already running)
npm start

# Open http://localhost:3000
# Log in with your test account
```

### Step 2: Monitor Logs in Real-Time
```bash
# In another terminal, watch logs
firebase functions:log --only incrementLoginCount_v2 | grep --line-buffered "Guard\|✅\|⏩"
```

### Step 3: Trigger Updates
- Log out and log back in (triggers lastSeen update)
- Update your profile (triggers logUserUpdates_v2)
- Upload an avatar (triggers trackUserActivation_v2)

### Expected Log Output:
```
✅ Field Guard: lastSeen changed
✅ Full Guard: All checks passed
✅ incrementLoginCount_v2: Login count incremented for user abc123
⏩ Field Guard: loginCount unchanged (self-update protection)
```

---

## 📊 VERIFICATION CHECKLIST

After running ANY of the above tests:

### ✅ Check Firebase Logs
```bash
firebase functions:log --only incrementLoginCount_v2 | head -50
```

**Look for:**
- [ ] `✅ Full Guard: All checks passed` (Guards working)
- [ ] `⏩ EventId Guard: Event already processed` (Deduplication working)
- [ ] `⏩ Field Guard: unchanged` (Field protection working)
- [ ] `⏩ SelfUpdate Guard: Last modified by` (Self-update prevention working)

### ✅ Check Firestore Collections

**processedEvents:**
```
Collection: processedEvents
Expected: Documents with structure:
{
  eventId: "abc123-xyz789",
  functionName: "incrementLoginCount_v2",
  timestamp: (recent timestamp)
}
```

**users:**
```
Collection: users
Check any updated user has:
{
  loginCount: (incremented),
  lastModifiedBy: "incrementLoginCount_v2",
  lastModifiedAt: (recent timestamp)
}
```

### ✅ Check Monitoring Function
```bash
firebase functions:log --only monitorFunctionLoops | grep "Invocations" | head -5
```

**Expected:**
```
=== Function Invocations (Last 5 minutes) ===
{
  "incrementLoginCount_v2": 5,
  "logUserUpdates_v2": 3,
  "trackUserActivation_v2": 1
}
✅ All functions within normal limits
```

---

## 🚨 TROUBLESHOOTING

### Issue 1: No Logs Appearing

**Symptoms**: No output when checking logs

**Possible Causes:**
1. Function hasn't been triggered yet (no user updates)
2. Logs take 30-60 seconds to appear in Console
3. Function errored before logging

**Solutions:**
```bash
# Check function status
firebase functions:list | grep "_v2"

# Check for ANY logs (including errors)
firebase functions:log | grep "incrementLoginCount_v2"

# Check for errors specifically
firebase functions:log | grep "Error\|❌"
```

### Issue 2: Function Not Executing

**Symptoms**: User updates but loginCount doesn't increment

**Possible Causes:**
1. Guards blocking all updates (too strict)
2. Function permissions issue
3. EventId Guard blocking legitimate updates

**Solutions:**
```bash
# Check Firestore rules
cat firestore.rules

# Check function permissions
firebase functions:config:get

# Check processedEvents for duplicates
# (Via Firebase Console → Firestore → processedEvents)
```

### Issue 3: Guards Not Activating

**Symptoms**: loginCount increments but no Guard messages

**Possible Causes:**
1. Old V1 function still running (not V2)
2. Guards code not deployed correctly

**Solutions:**
```bash
# Verify V2 is deployed
firebase functions:list | grep "incrementLoginCount"

# Should show ONLY incrementLoginCount_v2
# If you see incrementLoginCount (v1), delete it:
firebase functions:delete incrementLoginCount

# Redeploy V2
cd functions
npm run build
firebase deploy --only functions:incrementLoginCount_v2
```

---

## 🎯 SUCCESS CRITERIA

Your V2 Guards are working correctly if you see:

1. **✅ Guard Messages in Logs**
   - Mix of `⏩` (Guard activated) and `✅` (Success) messages
   - Proof that Guards are checking conditions

2. **✅ processedEvents Populating**
   - New documents appearing with recent timestamps
   - Each successful execution creates an entry

3. **✅ lastModifiedBy Markers**
   - Updated documents have `lastModifiedBy: "incrementLoginCount_v2"`
   - Proof of self-update tracking

4. **✅ No Infinite Loops**
   - Invocation count stays < 1000/5min
   - Monitoring function shows normal limits

---

## 📝 TEST RESULTS LOG

Record your test results here:

| Date/Time | Test Type | Result | Guard Messages | Notes |
|-----------|-----------|--------|----------------|-------|
| 2025-11-06 | | | | |
| | | | | |
| | | | | |

---

## 🎉 NEXT STEPS AFTER TESTING

### If Tests Pass ✅
1. Continue monitoring for 24-48 hours
2. Check billing daily
3. Delete V1 functions after 48 hours
4. Celebrate! 🎊

### If Tests Fail ❌
1. Document the failure in TEST_RESULTS.md
2. Check Firebase logs for errors
3. Review Guard configuration in guards.ts
4. Test in Firebase emulators first
5. Redeploy with fixes

---

**Generated**: 2025-11-06 12:46 UTC
**Status**: 🧪 **READY FOR TESTING**

🤖 Run any of the 3 test options above to verify V2 Guards!
