/**
 * Red-team helpers — the read path. Routes through the PRODUCTION handler.
 *
 * These deliberately import the real portal artifact read handler and the real
 * signed-URL minting used in production. Do not substitute a local
 * reimplementation: the whole point of the suite is that ownership,
 * suppression and expiry are proven on the code that actually serves members.
 */

const { bucket } = require('./storage');

// Production handler — same module the deployed read function calls.
// eslint-disable-next-line import/no-unresolved
const artifacts = require('../../../functions/core/services/artifacts/readArtifact');

/**
 * Perform an artifact read exactly as the deployed function does.
 * @param {{ token: string }} auth  a real patient token (verifyPatientToken runs inside)
 * @param {string} documentId
 * @returns {Promise<{ status: number, body?: any, signedUrl?: string }>}
 */
async function readArtifact(auth, documentId) {
  try {
    const result = await artifacts.handleArtifactRead(
      { headers: { authorization: `Bearer ${auth.token}` } },
      { documentId },
    );
    return { status: 200, body: result, signedUrl: result && result.url };
  } catch (err) {
    return { status: (err && err.status) || 500, body: { error: String(err && err.message) } };
  }
}

/** Mint a signed URL directly (used for expiry/replay cases). */
async function mintSignedUrl(path, { expiresInMs = 60_000 } = {}) {
  const [url] = await bucket()
    .file(path)
    .getSignedUrl({ action: 'read', expires: Date.now() + expiresInMs });
  return url;
}

module.exports = { readArtifact, mintSignedUrl };
