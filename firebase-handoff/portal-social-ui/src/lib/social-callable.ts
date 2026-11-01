import { getFirebaseApp } from "@/lib/firebase";
import type { Callable } from "./social-flow";

/** Separate from the HTTP/PHI client; these are Firebase onCall endpoints. No automatic retries. */
export const callSocial: Callable = async (name, data) => {
  if (!["socialAvailability", "socialBeginAttempt", "socialLinkExisting", "socialStartVerification", "socialConfirmVerification"].includes(name)) throw new Error("UNSUPPORTED_CALL");
  const app = getFirebaseApp();
  if (!app) throw new Error("PROVIDER_UNAVAILABLE");
  const { getFunctions, httpsCallable } = await import("firebase/functions");
  const response = await httpsCallable(getFunctions(app, "us-central1"), name, { timeout: 180000 })(data);
  return response.data;
};