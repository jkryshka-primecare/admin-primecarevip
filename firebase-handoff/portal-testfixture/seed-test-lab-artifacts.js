#!/usr/bin/env node
/**
 * seed-test-lab-artifacts.js — rows 6/7 fixture for the synthetic member ONLY.
 *
 * Run from the portal repo (prime-care-vip-app-v2) so firebase-admin resolves:
 *   node scripts/seed-test-lab-artifacts.js            # dry run (default)
 *   node scripts/seed-test-lab-artifacts.js --apply
 *   node scripts/seed-test-lab-artifacts.js --cleanup --apply   # remove the synthetic lab + its PDFs
 *
 * What it does (in order):
 *   1. Uploads a dummy PDF to elation-artifacts/<uid>/<reportId>/report.pdf for every
 *      existing category=='lab', deleted==false doc on the test member that has no
 *      object yet, and sets hasArtifact:true on that doc (Storage-truth, D-119).
 *   2. Creates ONE extra synthetic lab doc (SMOKE-LAB-2) + its PDF, so row 7 can prove
 *      "hidden item disappears, sibling untouched".
 *
 * Safety: the patient id, the uid and the synthetic doc id are hard-pinned constants,
 * not argv. It aborts unless the roster doc matches the pinned uid AND the synthetic
 * test email. It only ever writes under this one patient / this one uid prefix.
 * Real Elation report ids are numeric; the synthetic id is not, so no poller/backfill
 * (merge:false store-once by reportId) can collide with it.
 */

const admin = require('firebase-admin');

// ---- hard pins (do not parameterise) ---------------------------------------
const PATIENT_ID = '816455979040769';
const FIREBASE_UID = 'neozyhs59ue0vooapsrocygo1ah3'; // lowercase = Firestore/Storage ownership key (D-016/D-112)
const EXPECTED_EMAIL = 'patient-test-1@primecarevip.com';
const SYNTHETIC_LAB_ID = 'SMOKE-LAB-2';
// getLabs/getImaging/getMedicalRecords read this bucket EXPLICITLY; index.js sets no
// default storageBucket, so writing to admin.storage().bucket() lands elsewhere (#379).
const BUCKET = 'prive-care-vip.firebasestorage.app';

const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');
const tag = APPLY ? '[APPLY]' : '[DRY-RUN]';

function dummyPdf(title) {
  // Minimal single-page PDF. Must start with %PDF- (backfill's own self-check) and
  // render in-browser, since row 6 opens it through the signed URL.
  const text = `(${title}) Tj`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null, // stream, built below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 72 700 Td ${text} ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function objectPath(reportId) {
  return `elation-artifacts/${FIREBASE_UID}/${reportId}/report.pdf`;
}

async function main() {
  admin.initializeApp({ storageBucket: BUCKET });
  const db = admin.firestore();
  const bucket = admin.storage().bucket(BUCKET);
  const FieldValue = admin.firestore.FieldValue;

  // ---- guard ---------------------------------------------------------------
  const rosterRef = db.collection('patients').doc(PATIENT_ID);
  const roster = await rosterRef.get();
  if (!roster.exists) throw new Error(`ABORT: patients/${PATIENT_ID} does not exist`);
  const r = roster.data() || {};
  if (String(r.email || '').toLowerCase() !== EXPECTED_EMAIL) {
    throw new Error(`ABORT: roster email is not the synthetic test address (got ${r.email})`);
  }
  if (String(r.firebaseUid || '').toLowerCase() !== FIREBASE_UID) {
    throw new Error(`ABORT: roster firebaseUid does not match the pinned uid (got ${r.firebaseUid})`);
  }
  console.log(`${tag} guard OK — ${PATIENT_ID} / ${r.email} / uid ${FIREBASE_UID}`);

  const labsCol = rosterRef.collection('labs');

  // ---- cleanup mode --------------------------------------------------------
  if (CLEANUP) {
    console.log(`${tag} delete labs/${SYNTHETIC_LAB_ID} and its PDF`);
    if (APPLY) {
      await labsCol.doc(SYNTHETIC_LAB_ID).delete().catch(() => {});
      await bucket.file(objectPath(SYNTHETIC_LAB_ID)).delete({ ignoreNotFound: true });
    }
    console.log(`${tag} cleanup done (seeded PDFs on REAL report ids are left in place — `
      + 'delete them by hand only if the report genuinely has no Elation printable).');
    return;
  }

  // ---- 1) hydrate artifacts for existing lab docs ---------------------------
  const snap = await labsCol.where('category', '==', 'lab').where('deleted', '==', false).get();
  console.log(`${tag} existing lab docs: ${snap.size}`);

  for (const d of snap.docs) {
    if (d.id === SYNTHETIC_LAB_ID) continue;
    const path = objectPath(d.id);
    const [exists] = await bucket.file(path).exists();
    if (exists) {
      console.log(`  - ${d.id}: PDF already present (${path}) — skip`);
      continue;
    }
    const title = (d.data() || {}).title || `Lab report ${d.id}`;
    console.log(`  - ${d.id}: upload dummy PDF -> ${path}; set hasArtifact:true`);
    if (APPLY) {
      await bucket.file(path).save(dummyPdf(`TEST FIXTURE — ${title}`), {
        contentType: 'application/pdf',
        resumable: false,
        metadata: { metadata: { seededBy: 'seed-test-lab-artifacts', synthetic: 'true' } },
      });
      await d.ref.set({ hasArtifact: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }

  // ---- 2) second synthetic lab item ----------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const secondDoc = {
    reportId: SYNTHETIC_LAB_ID,
    title: 'CBC with Differential (test fixture)',
    reportType: 'Lab',
    category: 'lab',
    subCategory: null,
    unmappedType: false,
    documentDate: today,
    resultedDate: today,
    signed: true,
    deleted: false,
    hasArtifact: true,
    results: [
      { name: 'WBC', value: '6.2', units: 'K/uL', referenceRange: '4.0-11.0', abnormalFlag: null },
      { name: 'Hemoglobin', value: '14.1', units: 'g/dL', referenceRange: '13.5-17.5', abnormalFlag: null },
      { name: 'Platelets', value: '243', units: 'K/uL', referenceRange: '150-400', abnormalFlag: null },
    ],
    updatedAt: FieldValue.serverTimestamp(),
  };
  console.log(`${tag} create labs/${SYNTHETIC_LAB_ID} + ${objectPath(SYNTHETIC_LAB_ID)}`);
  if (APPLY) {
    await labsCol.doc(SYNTHETIC_LAB_ID).set(secondDoc, { merge: false });
    await bucket.file(objectPath(SYNTHETIC_LAB_ID)).save(
      dummyPdf('TEST FIXTURE — CBC with Differential'),
      {
        contentType: 'application/pdf',
        resumable: false,
        metadata: { metadata: { seededBy: 'seed-test-lab-artifacts', synthetic: 'true' } },
      },
    );
  }

  // ---- verify --------------------------------------------------------------
  const after = await labsCol.where('category', '==', 'lab').where('deleted', '==', false).get();
  console.log(`\n${tag} post-state — ${after.size} visible lab docs:`);
  for (const d of after.docs) {
    const [exists] = await bucket.file(objectPath(d.id)).exists();
    const x = d.data() || {};
    console.log(`  ${d.id}  hasArtifact=${!!x.hasArtifact}  pdfInStorage=${exists}  "${x.title || ''}"`);
    if (APPLY && !!x.hasArtifact !== exists) {
      console.log('    ^ MISMATCH: hasArtifact and Storage disagree');
      process.exitCode = 2;
    }
  }
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to write.');
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
