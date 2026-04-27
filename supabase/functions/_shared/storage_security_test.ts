// Verifies hardened access on the public `email-assets` bucket:
//  1. Anonymous clients CANNOT list files (RLS blocks SELECT on storage.objects).
//  2. Service-role clients CAN list files.
//  3. Direct public URLs still serve the file bytes (CDN public-flag path).
//
// Run with:
//   supabase functions test --filter "email-assets storage hardening"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Publishable URL + anon key are safe to embed (same values shipped to the browser).
const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ??
  "https://imewkweatgvqledptdna.supabase.co";
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltZXdrd2VhdGd2cWxlZHB0ZG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTk1OTYsImV4cCI6MjA5MTkzNTU5Nn0.miryNgADke5fAjCIhu_mt62sji4uTaewmX2rn_YAXFY";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "email-assets";
const KNOWN_FILE = "primecare-logo.jpg"; // seeded asset

Deno.test({
  name: "email-assets storage hardening",
  // Supabase client keeps realtime heartbeat intervals open; not relevant here.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const admin = SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE)
    : null;

  await t.step("anonymous client cannot list files", async () => {
    const { data, error } = await anon.storage.from(BUCKET).list();
    // Either the API returns an explicit error or an empty list (RLS filters all rows).
    if (error) {
      assert(error.message.length > 0, "expected error message");
    } else {
      assertEquals(
        data?.length ?? 0,
        0,
        `anon listing should be empty, got ${data?.length} items`,
      );
    }
  });

  await t.step("service role can list files", async () => {
    if (!admin) {
      console.warn("SUPABASE_SERVICE_ROLE_KEY not set — skipping");
      return;
    }
    const { data, error } = await admin.storage.from(BUCKET).list();
    assertEquals(error, null, `service role list error: ${error?.message}`);
    assert(
      (data?.length ?? 0) > 0,
      "service role should see at least one file",
    );
  });

  await t.step("direct public URL still serves the file", async () => {
    const { data } = anon.storage.from(BUCKET).getPublicUrl(KNOWN_FILE);
    const res = await fetch(data.publicUrl);
    assertEquals(
      res.status,
      200,
      `expected 200 from ${data.publicUrl}, got ${res.status}`,
    );
    const buf = await res.arrayBuffer();
    assert(buf.byteLength > 0, "expected non-empty file body");
  });
});
