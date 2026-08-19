/**
 * Cheap, environment-free guard: the audit and sweep must resolve the SAME
 * bucket as the read path. The red-team stateful suite runs on the Storage
 * emulator, which has one bucket, so a production default-bucket mismatch can
 * never surface there — this test is what fails CI on a bare-bucket regression.
 */

const fs = require('fs');
const path = require('path');

const FN_DIR = path.join(__dirname, '..', '..', 'functions');

const { ARTIFACT_BUCKET, artifactBucketName } = require('../../functions/core/config/artifactBucket');

const SOURCES = [
  'auditArtifactCoverage.js',
  'sweepArtifactRepairs.js',
  path.join('core', 'services', 'artifacts', 'readArtifact.js'),
];

describe('artifact bucket is named, never defaulted', () => {
  test('the shared constant is the firebasestorage.app bucket', () => {
    expect(ARTIFACT_BUCKET).toBe('prive-care-vip.firebasestorage.app');
    delete process.env.ARTIFACT_BUCKET;
    expect(artifactBucketName()).toBe(ARTIFACT_BUCKET);
  });

  test.each(SOURCES)('%s never calls admin.storage().bucket() bare', (rel) => {
    const src = fs.readFileSync(path.join(FN_DIR, rel), 'utf8');
    expect(src).not.toMatch(/storage\(\)\s*\.\s*bucket\(\s*\)/);
    expect(src).toMatch(/artifactBucketName\(\)/);
  });

  test.each(SOURCES)('%s imports the shared bucket config', (rel) => {
    const src = fs.readFileSync(path.join(FN_DIR, rel), 'utf8');
    expect(src).toMatch(/config\/artifactBucket/);
  });
});
