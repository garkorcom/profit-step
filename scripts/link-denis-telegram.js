/**
 * One-time script: Link Telegram ID to Denis's Firebase UID
 * Uses GOOGLE_APPLICATION_CREDENTIALS or service account from firebase login
 * Run: npx ts-node scripts/link-denis-telegram.js
 */
const { execSync } = require('child_process');

// Get access token from firebase CLI
const token = execSync('firebase login:ci --no-localhost 2>/dev/null || echo ""').toString().trim();

const admin = require('firebase-admin');

// Try to use firebase tools credentials
let credential;
try {
  // Use firebase CLI token if available  
  const { GoogleAuth } = require('google-auth-library');
  credential = admin.credential.cert({});
} catch(e) {
  // Fallback: use the firebase admin with project ID only (works if GOOGLE_APPLICATION_CREDENTIALS set)
}

const app = admin.initializeApp({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step'
});

const db = admin.firestore();

async function main() {
  const userId = 'mxtAppmSHNgDAVWVBNAfHKZ2e172';
  const telegramId = '5844328957';
  
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();
  
  if (!userDoc.exists) {
    console.error('❌ User document not found:', userId);
    process.exit(1);
  }
  
  const data = userDoc.data();
  console.log('Current user data:', JSON.stringify({
    displayName: data.displayName,
    email: data.email,
    telegramId: data.telegramId || '(not set)',
    hourlyRate: data.hourlyRate,
  }, null, 2));
  
  if (data.telegramId === telegramId) {
    console.log('✅ telegramId already set correctly.');
  } else {
    await userRef.update({ telegramId });
    console.log(`✅ Updated telegramId to: ${telegramId}`);
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
