import MedicationStats from "@/components/MedicationStats";

/**
 * Refill Requests is the in-app surface for refill management.
 * It currently re-uses the MedicationStats component (originally built
 * inside Insights) which already handles FHIR sandbox + Hint joins.
 */
export default function RefillRequests() {
  return <MedicationStats />;
}
