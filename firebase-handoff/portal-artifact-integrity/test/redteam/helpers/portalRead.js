/**
 * Red-team helpers — the read path. Routes through the PRODUCTION handler,
 * driven EXACTLY the way the deployed wrappers drive it.
 *
 * Corrected against the real repo: only THREE handlers have an artifact mode —
 * `getLabs`, `getImaging`, `getMedicalRecords`. The other five (`getLetters`,
 * `getMedications`, `getAppointments`, `getProblems`, `getAllergies`) are
 * list-only and have nothing to delegate. Each artifact wrapper pins its
 * portalAccess module key and a hardcoded 300s TTL; identity comes only from
 * the bearer token, and the request body is never an identity source.
 */

const { bucket } = require('./storage');

// Production handler — the same module the deployed read functions call.
// eslint-disable-next-line import/no-unresolved
const artifacts = require('../../../functions/core/services/artifacts/readArtifact');

/** The artifact wrappers, expressed as the only thing that differs: the module. */
const WRAPPERS = Object.freeze({
  getLabs: 'labs',
  getImaging: 'imaging',
  getMedicalRecords: 'records',
});

const MODULE_WRAPPER = Object.freeze(
  Object.entries(WRAPPERS).reduce((acc, [fn, mod]) => ({ ...acc, [mod]: fn }), {}),
);

function wrapperFor(moduleKey) {
  const fn = MODULE_WRAPPER[moduleKey];
  if (!fn) throw new Error(`red-team: no production wrapper serves module "${moduleKey}"`);
  return fn;
}

/**
 * Invoke the handler the way wrapper `fn` does: module pinned by the wrapper,
 * TTL hardcoded at 300s, body passed through untouched so a test can attempt to
 * steer it (the handler must ignore it).
 */
async function callWrapper(fn, { token, reportId, ttlSeconds, childElationId, body = {} }) {
  const moduleKey = WRAPPERS[fn];
  if (!moduleKey) throw new Error(`red-team: unknown wrapper ${fn}`);
  return artifacts.handleArtifactRead(
    { headers: { authorization: `Bearer ${token}` }, body: { ...body, reportId, childElationId } },
    { reportId, module: moduleKey, ttlSeconds: ttlSeconds || 300, childElationId },
  );
}

/**
 * Perform an artifact read exactly as the deployed function does.
 *
 * @param {{ as: object, doc?: object, reportId?: string, module?: string,
 *           wrapper?: string, ttlSeconds?: number, body?: object }} opts
 */
async function readArtifact({ as, of, doc, reportId, module: moduleKey, wrapper, ttlSeconds, body = {} } = {}) {
  if (!as || !as.token) throw new Error('readArtifact requires a seeded patient handle with a token');
  const id = reportId || (doc && doc.documentId);
  if (!id) throw new Error('readArtifact requires a reportId (or a seedDocument result)');
  const mod = moduleKey || (doc && doc.module) || 'labs';
  const fn = wrapper || wrapperFor(mod);

  const started = Date.now();
  try {
    // `of` names the subject a guardian is acting on — untrusted client input
    // the handler must authorize before it means anything.
    const childElationId = of ? (of.patientId || String(of)) : undefined;
    const result = await callWrapper(fn, { token: as.token, reportId: id, ttlSeconds, childElationId, body });
    return {
      status: 200,
      wrapper: fn,
      module: WRAPPERS[fn],
      body: result,
      signedUrl: result && result.signedUrl,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return {
      status: (err && err.status) || 500,
      wrapper: fn,
      module: WRAPPERS[fn],
      body: { error: String(err && err.message), reason: err && err.reason },
      elapsedMs: Date.now() - started,
    };
  }
}

/** Mint a signed URL through the production read path (for expiry/replay cases). */
async function mintSignedUrl({ as, doc, reportId, module: moduleKey, wrapper, ttlSeconds = 60 } = {}) {
  const res = await readArtifact({ as, doc, reportId, module: moduleKey, wrapper, ttlSeconds });
  if (res.status !== 200 || !res.signedUrl) {
    throw new Error(`mintSignedUrl: read failed with ${res.status}`);
  }
  return res.signedUrl;
}

/** Direct minting for a known path — only for cases that bypass the handler on purpose. */
async function mintSignedUrlForPath(path, { ttlSeconds = 60 } = {}) {
  const [url] = await bucket()
    .file(path)
    .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + ttlSeconds * 1000 });
  return url;
}

module.exports = {
  readArtifact,
  mintSignedUrl,
  mintSignedUrlForPath,
  callWrapper,
  WRAPPERS,
  MODULE_WRAPPER,
};
