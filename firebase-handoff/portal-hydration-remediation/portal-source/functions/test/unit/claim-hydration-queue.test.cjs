const { test } = require('node:test');
const assert = require('node:assert/strict');
const { queueClaimHydration } = require('../../core/services/patient/claimHydrationQueue');
function fixture(patient, exists = false) {
  const writes = [];
  const db = { collection: c => ({ doc: id => ({ c, id }) }), runTransaction: fn => fn({
    get: async ref => ref.c === 'patients' ? { exists: !!patient, data: () => patient } : { exists },
    set: (ref, data) => writes.push({ ref, data }),
  }) };
  const FieldValue = { serverTimestamp: () => 'TS', arrayUnion: id => [id] };
  return { writes, args: { db, FieldValue, patientId: '123456', rawUid: 'TrueCaseUID' } };
}
test('bind + loading job + recovery ID commit atomically before hydration starts', async () => {
  const f = fixture({ authUid: 'TrueCaseUID', firebaseUid: 'truecaseuid' });
  assert.equal(await queueClaimHydration(f.args), true);
  assert.equal(f.writes.length, 3);
  assert.equal(f.writes[0].data.status, 'active');
  assert.equal(f.writes[0].data.hydrationStatus, 'pending');
  assert.equal(f.writes[1].data.state, 'queued');
  assert.deepEqual(f.writes[2].data.queued, ['123456']);
});
test('wrong true-case UID cannot queue another patient', async () => {
  const f = fixture({ authUid: 'truecaseuid', firebaseUid: 'truecaseuid' });
  await assert.rejects(queueClaimHydration(f.args), /BINDING_MISMATCH/);
  assert.equal(f.writes.length, 0);
});
test('completed records never restart', async () => {
  const f = fixture({ authUid: 'TrueCaseUID', firebaseUid: 'truecaseuid', hydrationStatus: 'complete' });
  assert.equal(await queueClaimHydration(f.args), false);
  assert.equal(f.writes.length, 0);
});
test('a repeated job cannot enqueue duplicate worker work', async () => {
  const f = fixture({ authUid: 'TrueCaseUID', firebaseUid: 'truecaseuid' }, true);
  assert.equal(await queueClaimHydration(f.args), false);
  assert.equal(f.writes.length, 0);
});