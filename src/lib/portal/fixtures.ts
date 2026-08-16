/**
 * Non-patient records that live in the production portal roster.
 *
 * The Step 1 smoke-test fixture is a real Firestore document, so it inflates
 * every roster count by one and must never be swept into a bulk operation.
 * Anything listed here is excluded from reconciliation totals and can never be
 * selected for provisioning.
 */
export const TEST_FIXTURE_ELATION_IDS: ReadonlySet<string> = new Set([
  "816455979040769", // Test Kieffer — Step 1 smoke-test fixture (_testSeed)
]);

export function isTestFixture(elationId: unknown): boolean {
  const id = String(elationId ?? "").trim();
  return id.length > 0 && TEST_FIXTURE_ELATION_IDS.has(id);
}

/** Firestore docs carry a `_testSeed` marker; trust it as well as the id list. */
export function isFixtureDoc(doc: Record<string, unknown>): boolean {
  return doc._testSeed === true || isTestFixture(doc.id);
}
