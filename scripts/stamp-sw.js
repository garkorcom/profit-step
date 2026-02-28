#!/usr/bin/env node
/**
 * Prebuild script: stamps the service-worker.js with a unique build hash.
 * This ensures every deploy invalidates the old PWA cache automatically.
 * Usage: node scripts/stamp-sw.js (runs as "prebuild" in package.json)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SW_PATH = path.join(__dirname, '..', 'build', 'service-worker.js');
const hash = crypto.createHash('md5').update(Date.now().toString()).digest('hex').slice(0, 8);

// The file is copied from public/ to build/ by react-scripts build,
// so we run this AFTER build and replace the placeholder.
if (fs.existsSync(SW_PATH)) {
    let content = fs.readFileSync(SW_PATH, 'utf8');
    content = content.replace('__BUILD_HASH__', hash);
    fs.writeFileSync(SW_PATH, content, 'utf8');
    console.log(`[stamp-sw] ✅ Service Worker stamped with hash: ${hash}`);
} else {
    console.warn('[stamp-sw] ⚠️ build/service-worker.js not found. Skipping.');
}
