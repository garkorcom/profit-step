#!/usr/bin/env node
/**
 * Tasktotime QA seed: создаёт 10 тестовых юзеров через Firebase Auth REST API
 * + профайлы в Firestore через REST API (ID token user-scoped, обходит admin SDK).
 *
 * Output: ~/projects/pipeline/2026-04-27/tasktotime-qa-credentials.json
 *
 * Usage:
 *   node scripts/seed-tasktotime-qa.mjs            # create users
 *   node scripts/seed-tasktotime-qa.mjs --verify   # log in each, no creates
 *   node scripts/seed-tasktotime-qa.mjs --signin <N>  # quick signin one user
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const API_KEY = 'AIzaSyDjBgLGw60VDlMkFu3w9DiSwTftH6nTh8E';
const PROJECT_ID = 'profit-step';
const PASSWORD = 'TasktotimeQA2026!';
const PIPELINE_DATE = '2026-04-27';
const CRED_FILE = `${homedir()}/projects/pipeline/${PIPELINE_DATE}/tasktotime-qa-credentials.json`;

const USERS = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  return {
    n,
    email: `tasktotime-qa-test${n}@profit-step.dev`,
    displayName: `QA Test User ${n}`,
  };
});

const args = process.argv.slice(2);
const mode = args[0] === '--verify' ? 'verify'
           : args[0] === '--signin' ? 'signin'
           : 'create';

const signUp = async (email, password) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`signUp failed for ${email}: ${JSON.stringify(data)}`);
  return data;
};

const signIn = async (email, password) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`signIn failed for ${email}: ${JSON.stringify(data)}`);
  return data;
};

const updateAuthProfile = async (idToken, displayName) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, displayName, returnSecureToken: false }),
  });
  if (!r.ok) {
    const data = await r.json();
    throw new Error(`updateAuthProfile failed: ${JSON.stringify(data)}`);
  }
};

const createFirestoreProfile = async (idToken, uid, profile) => {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}?currentDocument.exists=false`;
  const fields = {
    email: { stringValue: profile.email.toLowerCase() },
    displayName: { stringValue: profile.displayName },
    companyId: { stringValue: uid },
    role: { stringValue: 'admin' },
    photoURL: { nullValue: null },
    onboarded: { booleanValue: false },
    status: { stringValue: 'active' },
    signupMethod: { stringValue: 'email' },
    loginCount: { integerValue: '0' },
    createdAt: { timestampValue: new Date().toISOString() },
    lastSeen: { timestampValue: new Date().toISOString() },
    qaSeed: { booleanValue: true },
    qaSeedDate: { stringValue: PIPELINE_DATE },
  };
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const data = await r.json();
    throw new Error(`createFirestoreProfile failed for ${uid}: ${JSON.stringify(data)}`);
  }
};

const ensureDir = (p) => {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
};

const saveCredentials = (records) => {
  ensureDir(CRED_FILE);
  writeFileSync(CRED_FILE, JSON.stringify({
    project: PROJECT_ID,
    apiKey: API_KEY,
    password: PASSWORD,
    seededAt: new Date().toISOString(),
    users: records,
  }, null, 2));
  console.log(`💾 Credentials saved: ${CRED_FILE}`);
};

const loadCredentials = () => {
  if (!existsSync(CRED_FILE)) return null;
  return JSON.parse(readFileSync(CRED_FILE, 'utf8'));
};

const main = async () => {
  if (mode === 'create') {
    console.log(`🌱 Seeding 10 tasktotime QA users on ${PROJECT_ID}...`);
    const records = [];
    const existing = loadCredentials();
    const existingMap = new Map((existing?.users || []).map(u => [u.email, u]));

    for (const user of USERS) {
      try {
        let auth;
        if (existingMap.has(user.email)) {
          console.log(`  ⏭️  ${user.email} — already in cred file, signing in to refresh tokens`);
          auth = await signIn(user.email, PASSWORD);
        } else {
          auth = await signUp(user.email, PASSWORD);
          console.log(`  ✅ ${user.email} — Auth created (uid=${auth.localId})`);
        }

        await updateAuthProfile(auth.idToken, user.displayName).catch(() => {});

        try {
          await createFirestoreProfile(auth.idToken, auth.localId, user);
          console.log(`     📄 Firestore profile written`);
        } catch (e) {
          if (String(e).includes('ALREADY_EXISTS') || String(e).includes('does not exist')) {
            console.log(`     📄 Firestore profile already exists (skip)`);
          } else {
            console.log(`     ⚠️  Firestore profile write failed: ${e.message}`);
          }
        }

        records.push({
          n: user.n,
          email: user.email,
          password: PASSWORD,
          displayName: user.displayName,
          uid: auth.localId,
          companyId: auth.localId,
          idToken: auth.idToken,
          refreshToken: auth.refreshToken,
        });
      } catch (e) {
        if (String(e).includes('EMAIL_EXISTS')) {
          console.log(`  ⏭️  ${user.email} — exists in Auth, signing in instead`);
          const auth = await signIn(user.email, PASSWORD);
          records.push({
            n: user.n,
            email: user.email,
            password: PASSWORD,
            displayName: user.displayName,
            uid: auth.localId,
            companyId: auth.localId,
            idToken: auth.idToken,
            refreshToken: auth.refreshToken,
          });
          try {
            await createFirestoreProfile(auth.idToken, auth.localId, user);
            console.log(`     📄 Firestore profile written`);
          } catch (e2) {
            console.log(`     📄 Firestore profile already exists (skip)`);
          }
        } else {
          console.error(`  ❌ ${user.email}: ${e.message}`);
        }
      }
    }

    saveCredentials(records);
    console.log(`\n✅ Done. ${records.length}/10 users ready.`);
    console.log(`\nFor browser login:`);
    console.log(`  Email: tasktotime-qa-test1@profit-step.dev`);
    console.log(`  Pass:  ${PASSWORD}`);
    console.log(`  URL:   https://profit-step.web.app/login`);
    return;
  }

  if (mode === 'verify') {
    console.log(`🔍 Verifying 10 users by signing in...`);
    for (const user of USERS) {
      try {
        const auth = await signIn(user.email, PASSWORD);
        console.log(`  ✅ ${user.email} (uid=${auth.localId})`);
      } catch (e) {
        console.error(`  ❌ ${user.email}: ${e.message}`);
      }
    }
    return;
  }

  if (mode === 'signin') {
    const n = parseInt(args[1] || '1', 10);
    const user = USERS.find(u => u.n === n);
    if (!user) throw new Error(`No user with n=${n}`);
    const auth = await signIn(user.email, PASSWORD);
    console.log(JSON.stringify({
      email: user.email,
      uid: auth.localId,
      idToken: auth.idToken.slice(0, 40) + '…',
    }, null, 2));
    return;
  }
};

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
