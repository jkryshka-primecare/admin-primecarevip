const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyLockfile } = require('../scripts/verify-ios-firestore.cjs');
const lock = version => `PODS:\n  - FirebaseFirestore (${version}):\n    - FirebaseFirestore/Default (= ${version})\n  - FirebaseFirestore/Default (${version})\n\nDEPENDENCIES:\n  - RNFBFirestore\n`;
for (const version of ['12.19.3', '13.1.1', '13.2.0', '14.0.0']) {
  test(`accept patched resolved Firestore ${version}`, () => assert.deepEqual(verifyLockfile(lock(version)), [version]));
}
for (const version of ['12.18.0', '12.19.2', '12.20.0', '13.0.9', '13.1.0', '13.1.1-beta']) {
  test(`reject unaccepted resolved Firestore ${version}`, () => assert.throws(() => verifyLockfile(lock(version))));
}
test('reject absent Firestore even if dependency lists a safe constraint', () => assert.throws(() => verifyLockfile('PODS:\n  - RNFBApp (24.0.0)\n\nDEPENDENCIES:\n  - FirebaseFirestore (= 12.19.3)\n')));
test('reject conflicting subspec resolution', () => assert.throws(() => verifyLockfile(lock('12.19.3').replace('  - FirebaseFirestore/Default (12.19.3)', '  - FirebaseFirestore/Default (12.18.0)'))));
test('reject missing PODS section', () => assert.throws(() => verifyLockfile('DEPENDENCIES:\n  - FirebaseFirestore (= 12.19.3)\n')));