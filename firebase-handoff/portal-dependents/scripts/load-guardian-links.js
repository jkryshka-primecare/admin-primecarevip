#!/usr/bin/env node
// scripts/load-guardian-links.js
//
// Loads the staff-finalized guardian CSV by calling adminLinkGuardian once per
// row. Dry-run by default; --apply is required to write.
//
//   node scripts/load-guardian-links.js \
//     --csv ../guardian-links-final-2026-08-22.csv \
//     --actor you@primecarevip.com \
//     --only-minor 1252809063464961        # fixture dry run: one child
//     [--apply]
//
// Auth: uses Application Default Credentials to mint a Google identity token
// for each function URL, exactly as Prime Care OS does.
//   gcloud auth application-default login
//
// Idempotent: replaying the same CSV updates rather than duplicates.

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const REGION = process.env.FN_REGION || 'us-central1';
const PROJECT = process.env.GCLOUD_PROJECT || 'prive-care-vip';
const FN_URL = `https://${REGION}-${PROJECT}.cloudfunctions.net/adminLinkGuardian`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes('--apply');
const CSV = arg('csv');
const ACTOR = arg('actor');
const ONLY_MINOR = arg('only-minor');
const LIMIT = Number(arg('limit', '0')) || 0;
const REASON = arg('reason', 'Release 2b guardian batch load');

if (!CSV || !ACTOR) {
  console.error('usage: --csv <file> --actor <email> [--only-minor <elationId>] [--limit N] [--apply]');
  process.exit(2);
}

// Minimal RFC4180 parser: quoted fields, no embedded newlines (the export has none).
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    const row = {};
    header.forEach((h, i) => { row[h.trim()] = (cells[i] || '').trim(); });
    return row;
  });
}

async function main() {
  const rows = parseCsv(fs.readFileSync(path.resolve(CSV), 'utf8'));

  const selected = rows.filter((r) => {
    if (ONLY_MINOR && r.minor_elation_id !== ONLY_MINOR) return false;
    return true;
  });
  const work = LIMIT ? selected.slice(0, LIMIT) : selected;

  const skipped = work.filter((r) => !r.minor_elation_id);
  const ready = work.filter((r) => r.minor_elation_id);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}  rows=${rows.length} selected=${work.length} ready=${ready.length} skipped_no_chart=${skipped.length}`);
  for (const r of skipped) console.log(`  SKIP  ${r.minor_name} (${r.minor_hint_id}) — no minor_elation_id`);

  if (!APPLY) {
    for (const r of ready) {
      console.log(`  would link ${r.minor_elation_id} <- ${r.guardian_email} [${r.match_source}]`);
    }
    console.log('\nNo writes performed. Re-run with --apply.');
    return;
  }

  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(FN_URL);

  let ok = 0;
  const failures = [];
  for (const r of ready) {
    const body = {
      childElationId: r.minor_elation_id,
      actor: ACTOR,
      reason: REASON,
      source: r.match_source === 'manual_search' ? 'manual' : r.match_source,
      guardianElationId: r.guardian_elation_id || '',
      guardianHintId: r.guardian_hint_id || '',
      guardianEmail: r.guardian_email,
      guardianName: r.guardian_name,
    };
    try {
      const resp = await client.request({ url: FN_URL, method: 'POST', data: body });
      ok += 1;
      console.log(`  OK    ${r.minor_elation_id} <- ${r.guardian_email} ${resp.data.created ? '(created)' : '(updated)'}`);
    } catch (e) {
      const detail = (e.response && e.response.data && e.response.data.error) || { message: e.message };
      failures.push({ row: r, detail });
      console.log(`  FAIL  ${r.minor_elation_id} <- ${r.guardian_email} :: ${detail.details ? detail.details.reason : detail.message}`);
    }
    // Serial with a small gap: the control plane is not a bulk endpoint.
    await new Promise((res) => setTimeout(res, 120));
  }

  console.log(`\nlinked=${ok} failed=${failures.length} skipped=${skipped.length}`);
  if (failures.length) {
    fs.writeFileSync('guardian-load-failures.json', JSON.stringify(failures, null, 2));
    console.log('failures written to guardian-load-failures.json');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
