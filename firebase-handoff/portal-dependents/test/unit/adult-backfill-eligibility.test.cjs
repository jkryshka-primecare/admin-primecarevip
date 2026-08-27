const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(
  __dirname,
  '../../functions/core/services/patient/ingestEligibility.js',
);
const source = fs.readFileSync(sourcePath, 'utf8');
const sandbox = { module: { exports: {} }, exports: {} };
vm.runInNewContext(source, sandbox, { filename: sourcePath });
const { adultBackfillEligibility } = sandbox.module.exports;

test('adult backfill admits unclaimed portal lifecycle states', () => {
  for (const status of [undefined, '', 'not_invited', 'invited', 'active', 'pending', 'claimed']) {
    assert.equal(adultBackfillEligibility({ status }).eligible, true, String(status));
  }
});

test('adult backfill normalizes lifecycle status', () => {
  assert.equal(adultBackfillEligibility({ status: ' Invited ' }).eligible, true);
});

test('adult backfill rejects explicit disabled states and minors', () => {
  const disabled = adultBackfillEligibility({ status: 'deactivated' });
  assert.equal(disabled.eligible, false);
  assert.equal(disabled.reason, 'NOT_ACTIVE');

  const minor = adultBackfillEligibility({ status: 'invited', dependent: { isMinor: true } });
  assert.equal(minor.eligible, false);
  assert.equal(minor.reason, 'IS_A_MINOR');
});

test('adult backfill rejects suspended, disabled and removed lifecycle states', () => {
  for (const status of ['suspended', 'disabled', 'removed']) {
    const result = adultBackfillEligibility({ status });
    assert.equal(result.eligible, false, status);
    assert.equal(result.reason, 'NOT_ACTIVE', status);
  }
});

test('adult backfill rejects a missing patient doc', () => {
  const result = adultBackfillEligibility(null);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'NO_PATIENT_DOC');
});
