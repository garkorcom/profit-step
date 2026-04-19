#!/usr/bin/env node
/**
 * Post-build: inject Firebase config into static HTML landings in build/.
 *
 * 6 standalone landing pages under public/promo*, public/saas-landing,
 * public/promo-garkor inline their own Firebase config block — they are
 * not processed by Vite, so env vars never reach them.
 *
 * This script runs AFTER `vite build` (after public/ is copied to build/)
 * and replaces the hardcoded 'profit-step' Firebase config with values
 * from env vars. When the env vars aren't set, hardcoded values stay as-is
 * — so local dev and current prod continue to work without changes.
 *
 * Required env vars for injection (all optional):
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN
 *   VITE_FIREBASE_PROJECT_ID
 *   VITE_FIREBASE_STORAGE_BUCKET
 *   VITE_FIREBASE_MESSAGING_SENDER_ID
 *   VITE_FIREBASE_APP_ID
 *
 * Safe to run twice — second run is a no-op if values already match env.
 * Runs in `npm run build` after stamp-sw.js.
 *
 * Spec: docs/migration/HARDCODED_INVENTORY.md §1.4
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');

// Landing pages that contain inline Firebase config (captured from
// HARDCODED_INVENTORY.md §1.4; verify with grep before editing).
const TARGETS = [
  'promo/index.html',
  'promo-high-end/index.html',
  'promo-creative/index.html',
  'promo-garkor/index.html',
  'saas-landing/index.html',
  'saas-landing/ru.html',
];

// Current hardcoded values in source HTMLs. When new env vars are provided,
// these get replaced. Intentionally NOT env-driven — they're the ground
// truth for "what's in the file right now", which lets the script be
// idempotent and skip files that already match.
const CURRENT_HARDCODED = {
  apiKey: 'AIzaSyDjBgLGw60VDlMkFu3w9DiSwTftH6nTh8E',
  authDomain: 'profit-step.firebaseapp.com',
  projectId: 'profit-step',
  storageBucket: 'profit-step.firebasestorage.app',
  // messagingSenderId and appId vary across files, so we handle them
  // separately with regex substitution below.
};

// New values from env (when present).
const NEW = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

function injectOne(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[inject-firebase-config] ⚠️  missing ${filePath}, skipping`);
    return { changed: 0, skipped: true };
  }

  const original = fs.readFileSync(filePath, 'utf8');
  let updated = original;
  let changes = 0;

  // Simple string replacements for fields where the old value is known
  for (const [key, oldVal] of Object.entries(CURRENT_HARDCODED)) {
    const newVal = NEW[key];
    if (!newVal || newVal === oldVal) continue;
    const count = (updated.match(new RegExp(oldVal.replace(/\./g, '\\.'), 'g')) || []).length;
    if (count > 0) {
      updated = updated.split(oldVal).join(newVal);
      changes += count;
    }
  }

  // messagingSenderId / appId vary per file — use regex that matches the
  // JSON-ish config block. Format: `messagingSenderId: "123456789"` and
  // `appId: "1:123:web:abc"`.
  if (NEW.messagingSenderId) {
    updated = updated.replace(
      /messagingSenderId:\s*"[^"]*"/g,
      (m) => {
        if (m.includes(`"${NEW.messagingSenderId}"`)) return m;
        changes++;
        return `messagingSenderId: "${NEW.messagingSenderId}"`;
      },
    );
  }
  if (NEW.appId) {
    updated = updated.replace(
      /appId:\s*"[^"]*"/g,
      (m) => {
        if (m.includes(`"${NEW.appId}"`)) return m;
        changes++;
        return `appId: "${NEW.appId}"`;
      },
    );
  }

  if (changes > 0) {
    fs.writeFileSync(filePath, updated, 'utf8');
  }
  return { changed: changes, skipped: false };
}

function main() {
  const anyNewValue = Object.values(NEW).some(Boolean);
  if (!anyNewValue) {
    console.log('[inject-firebase-config] no VITE_FIREBASE_* env vars set — leaving landings as-is');
    return;
  }

  console.log(`[inject-firebase-config] injecting into ${TARGETS.length} landings in ${BUILD_DIR}`);
  let totalChanges = 0;
  let filesChanged = 0;
  for (const rel of TARGETS) {
    const abs = path.join(BUILD_DIR, rel);
    const { changed } = injectOne(abs);
    if (changed > 0) {
      filesChanged++;
      console.log(`  ${rel.padEnd(40)} ${changed} replacement(s)`);
    }
    totalChanges += changed;
  }
  console.log(`[inject-firebase-config] ✅ ${totalChanges} replacements in ${filesChanged} file(s)`);
}

main();
