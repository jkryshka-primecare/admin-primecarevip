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

/**
 * Staff-created probe records live in Hint under names that start with
 * "Health check" (e.g. "Health check 08-19"). They are not people, so they are
 * excluded from reconciliation counts and can never be provisioned.
 */
export function isTestFixtureName(...parts: Array<unknown>): boolean {
  const name = parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return name.startsWith("health check") || name.startsWith("healthcheck");
}

/** Firestore docs carry a `_testSeed` marker; trust it as well as the id list. */
export function isFixtureDoc(doc: Record<string, unknown>): boolean {
  return (
    doc._testSeed === true ||
    isTestFixture(doc.id) ||
    isTestFixtureName(doc.firstName, doc.lastName) ||
    isTestFixtureName(doc.name)
  );
}

