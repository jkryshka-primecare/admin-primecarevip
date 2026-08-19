/**
 * THE one artifact bucket. Single source of truth for read, write, audit, sweep.
 *
 * A bare `admin.storage().bucket()` resolves to the DEFAULT bucket
 * (`prive-care-vip.appspot.com`), which is NOT where artifacts live. Using the
 * default silently makes every `exists()` false (audit reports 0% coverage) and
 * makes heals land in a bucket nothing reads. Never call
 * `admin.storage().bucket()` with no argument for artifacts.
 */
const ARTIFACT_BUCKET = 'prive-care-vip.firebasestorage.app';

/** Emulator runs have a single bucket; allow an explicit override there only. */
function artifactBucketName() {
  return process.env.ARTIFACT_BUCKET || ARTIFACT_BUCKET;
}

module.exports = { ARTIFACT_BUCKET, artifactBucketName };
