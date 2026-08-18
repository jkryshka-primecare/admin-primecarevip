/**
 * Red-team helpers — the read path. Routes through the PRODUCTION handler.
 *
 * These deliberately import the real portal artifact read handler and the real
 * signed-URL minting used in production. Do not substitute a local
 * reimplementation: the whole point of the suite is that ownership,
 * suppression and expiry are proven on the code that actually serves members.
 *
 * The call shapes here match the suite exactly (review round 2, items 2, 3, 6):
 *   readArtifact({ as, documentId, body })  -> { status, body, signedUrl, elapsedMs }
 *   mintSignedUrl({ as, documentId, ttlSeconds }) -> url string
 */

const { bucket } = require('./storage');

// Production handler — same module the deployed read function calls.
// eslint-disable-next-line import/no-unresolved
const artifacts = require('../../../functions/core/services/artifacts/readArtifact');

/**
 * Perform an artifact read exactly as the deployed function does.
 * @param {{ as: { token: string }, documentId: string, body?: object }} opts
 *        `as` is a patient handle from seedPatient(); its real token is used so
 *        verifyPatientToken runs for real. `body` lets a test attempt to steer
 *        the request (e.g. supplying someone else's patientId) — the handler
 *        must ignore it.
 */
async function readArtifact({ as, documentId, body = {} } = {}) {
  if (!as || !as.token) throw new Error('readArtifact requires a seeded patient handle with a token');
  if (!documentId) throw new Error('readArtifact requires a documentId');
  const started = Date.now();
  try {
    const result = await artifacts.handleArtifactRead(
      { headers: { authorization: `Bearer ${as.token}` }, body: { ...body, documentId } },
      { documentId, ...body },
    );
    return {
      status: 200,
      body: result,
      signedUrl: result && result.url,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return {
      status: (err && err.status) || 500,
      body: { error: String(err && err.message), state: err && err.state },
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * Mint a signed URL through the production read path (used for expiry/replay).
 * Falls back to direct minting only when the handler exposes no TTL override,
 * so the URL under test is always one the portal could actually hand out.
 */
async function mintSignedUrl({ as, documentId, ttlSeconds = 60 } = {}) {
  const res = await readArtifact({ as, documentId, body: { ttlSeconds } });
  if (res.status !== 200 || !res.signedUrl) {
    throw new Error(`mintSignedUrl: read failed with ${res.status}`);
  }
  return res.signedUrl;
}

/** Direct minting for a known path — only for cases that bypass the handler on purpose. */
async function mintSignedUrlForPath(path, { ttlSeconds = 60 } = {}) {
  const [url] = await bucket()
    .file(path)
    .getSignedUrl({ action: 'read', expires: Date.now() + ttlSeconds * 1000 });
  return url;
}

module.exports = { readArtifact, mintSignedUrl, mintSignedUrlForPath };
