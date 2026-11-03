const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verifyLockfile(text) {
  const pods = text.match(/^PODS:\r?\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m)?.[1];
  if (!pods) throw new Error('Missing PODS section in actual iOS Podfile.lock');
  const versions = [...pods.matchAll(/^  - FirebaseFirestore(?:\/[A-Za-z0-9_-]+)? \(([^)]+)\)/gm)].map(m => m[1]);
  if (versions.length === 0) throw new Error('FirebaseFirestore is missing from actual iOS Podfile.lock');
  for (const version of versions) {
    const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!parts) throw new Error(`Non-release FirebaseFirestore version: ${version}`);
    const [major, minor, patch] = parts.slice(1).map(Number);
    const patched = version === '12.19.3' || major > 13 || (major === 13 && (minor > 1 || (minor === 1 && patch >= 1)));
    if (!patched) throw new Error(`Unpatched FirebaseFirestore ${version}; require 12.19.3 or >=13.1.1`);
  }
  return [...new Set(versions)];
}

if (require.main === module) {
  if (process.env.EAS_BUILD_PLATFORM === 'ios') {
    const lockPath = path.resolve(__dirname, '../ios/Podfile.lock');
    const lock = fs.readFileSync(lockPath, 'utf8');
    const versions = verifyLockfile(lock);
    console.log(`iOS Firestore security gate PASS: ${versions.join(', ')}`);
    console.log(`Actual Podfile.lock SHA256: ${crypto.createHash('sha256').update(lock).digest('hex')}`);
    console.log('BEGIN ACTUAL EAS IOS PODFILE.LOCK\n' + lock + '\nEND ACTUAL EAS IOS PODFILE.LOCK');
  }
}

module.exports = { verifyLockfile };