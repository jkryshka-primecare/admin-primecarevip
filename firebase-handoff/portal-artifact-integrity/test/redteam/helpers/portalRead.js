/**
 * Red-team helpers — the read path. Routes through the PRODUCTION handler,
 * driven EXACTLY the way the nine deployed wrappers drive it.
 *
 * Review round 3 gap: the suite previously called `handleArtifactRead` with no
 * `collection`, so every case fell through to the `documents` default while the
 * tests hid items under `labs`. Suppression is per-collection, so the gate was
 * exercising a different path than production. Fixed here: a read must name the
 * collection (or inherit it from the seeded document), and the call is made
 * through `callWrapper`, which mirrors what `getLabs`, `getImaging`, … do —
 * fixed `collection`, fixed default TTL, caller body never used for identity.
 */

const { bucket } = require('./storage');

// Production handler — same module the deployed read functions call.
// eslint-disable-next-line import/no-unresolved
const artifacts = require('../../../functions/core/services/artifacts/readArtifact');

/**
 * The nine production wrappers, expressed as the only thing that differs
 * between them: the collection they pin. Mirrors REFACTOR-READ-PATH.md.
 */
const WRAPPERS = Object.freeze({
  getLabs: 'labs',
  getImaging: 'imaging',
  getMedications: 'medications',
  getLetters: 'letters',
  getMedicalRecords: 'documents',
  getAppointments: 'appointments',
  getProblems: 'problems',
  getAllergies: 'allergies',
});

const COLLECTION_WRAPPER = Object.freeze(
  Object.entries(WRAPPERS).reduce((acc, [fn, col]) => ({ ...acc, [col]: fn }), {}),
);

function wrapperFor(collection) {
  const fn = COLLECTION_WRAPPER[collection];
  if (!fn) throw new Error(`red-team: no production wrapper serves collection "${collection}"`);
  return fn;
}

/**
 * Invoke the handler the way wrapper `fn` does: collection is pinned by the
 * wrapper, identity comes only from the bearer token, and the request body is
 * passed through untouched so a test can attempt to steer it.
 */
async function callWrapper(fn, { token, documentId, ttlSeconds, body = {} }) {
  const collection = WRAPPERS[fn];
  if (!collection) throw new Error(`red-team: unknown wrapper ${fn}`);
  return artifacts.handleArtifactRead(
    { headers: { authorization: `Bearer ${token}` }, body: { ...body, documentId } },
    { documentId, collection, ttlSeconds: ttlSeconds || 300 },
  );
}

/**
 * Perform an artifact read exactly as the deployed function does.
 *
 * @param {{ as: object, documentId?: string, doc?: object, collection?: string,
 *           wrapper?: string, ttlSeconds?: number, body?: object }} opts
 *        `as` is a patient handle from seedPatient(); its real token is used so
 *        verifyPatientToken runs for real. `doc` is a seedDocument() result and
 *        supplies both documentId and collection. `body` lets a test attempt to
 *        steer the request (e.g. supplying someone else's patientId) — the
 *        handler must ignore it.
 */
async function readArtifact({ as, doc, documentId, collection, wrapper, ttlSeconds, body = {} } = {}) {
  if (!as || !as.token) throw new Error('readArtifact requires a seeded patient handle with a token');
  const id = documentId || (doc && doc.documentId);
  if (!id) throw new Error('readArtifact requires a documentId (or a seedDocument result)');
  const col = collection || (doc && doc.collection) || 'labs';
  const fn = wrapper || wrapperFor(col);

  const started = Date.now();
  try {
    const result = await callWrapper(fn, { token: as.token, documentId: id, ttlSeconds, body });
    return {
      status: 200,
      wrapper: fn,
      collection: WRAPPERS[fn],
      body: result,
      signedUrl: result && result.url,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return {
      status: (err && err.status) || 500,
      wrapper: fn,
      collection: WRAPPERS[fn],
      body: { error: String(err && err.message), state: err && err.state },
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * Mint a signed URL through the production read path (used for expiry/replay),
 * so the URL under test is always one the portal could actually hand out.
 */
async function mintSignedUrl({ as, doc, documentId, collection, wrapper, ttlSeconds = 60 } = {}) {
  const res = await readArtifact({ as, doc, documentId, collection, wrapper, ttlSeconds });
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

module.exports = {
  readArtifact,
  mintSignedUrl,
  mintSignedUrlForPath,
  callWrapper,
  WRAPPERS,
  COLLECTION_WRAPPER,
};
