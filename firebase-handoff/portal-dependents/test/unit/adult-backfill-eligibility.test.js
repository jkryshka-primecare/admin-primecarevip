const assert = require('node:assert/strict');
const test = require('node:test');

const {
  adultBackfillEligibility,
} = require('../../functions/core/services/patient/ingestEligibility');

test('adult backfill admits unclaimed portal lifecycle states', () => {
  for (const status of [undefined, '', 'not_invited', 'invited', 'active', 'pending', 'claimed']) {
    assert.equal(adultBackfillEligibility({ status }).eligible, true, String(status));
  }
});

test('adult backfill normalizes lifecycle status', () => {
  assert.equal(adultBackfillEligibility({ status: ' Invited ' }).eligible, true);
});

test('adult backfill rejects explicit disabled states and minors', () => {
  assert.deepEqual(
    adultBackfillEligibility({ status: 'deactivated' }),
    { eligible: false, reason: 'NOT_ACTIVE' },
  );
  assert.deepEqual(
    adultBackfillEligibility({ status: 'invited', dependent: { isMinor: true } }),
    { eligible: false, reason: 'IS_A_MINOR' },
  );
});