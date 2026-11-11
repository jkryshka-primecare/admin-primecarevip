const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const { logPhiAcknowledgment } = require('./logPhiAcknowledgment');
const { twilioConversationsToken } = require('./twilioConversationsToken');
const { protectedConversationsApi } = require('./protectedConversationsApi');
const { twilioWebhook } = require('./twilioWebhook');
const { addProviderToConversation } = require('./addProviderToConversation');
const { createPatientConversation } = require('./createPatientConversation');
const { getConversationMessages } = require('./getConversationMessages');
const { sendMessage } = require('./sendMessage');
const { getProviderConversations } = require('./getProviderConversations');
const { setUserRole } = require('./setUserRole');
const { syncDirectoryEntry } = require('./syncDirectoryEntry');
const { createUserProfile } = require('./createUserProfile');
const { syncElationPatients } = require('./syncElationPatients');
const { getPatients, getPatient } = require('./getPatients');
const { getMyPatientRecord } = require('./getMyPatientRecord');
const { getMyDependents } = require('./getMyDependents');
const { getProblems } = require('./getProblems');
const { getAppointments } = require('./getAppointments');
const { getAllergies } = require('./getAllergies');
const { getLabs } = require('./getLabs');
const { getImaging } = require('./getImaging');
const { getMedicalRecords } = require('./getMedicalRecords');
const { getLetters } = require('./getLetters');
const { getMedications } = require('./getMedications');
// #543 / D-134 — first Elation write-back: member-initiated refill draft.
const { requestRefill } = require('./requestRefill');
const { claimAccount } = require('./claimAccount');
const { elationEventTarget } = require('./elationEventTarget');
const { ingestElationReports } = require('./ingestElationReports');
const { ingestElationLetters } = require('./ingestElationLetters');
const { syncBeetextingContacts } = require('./syncBeetextingContacts');
const { adminIssueInvite } = require('./adminIssueInvite');
const { adminRevokeInvite } = require('./adminRevokeInvite');
const { adminSetPortalAccess } = require('./adminSetPortalAccess');
const { adminGetPortalAccess } = require('./adminGetPortalAccess');
const { adminProvisionPatients } = require('./adminProvisionPatients');
const { adminRunReadPathSmoke } = require('./adminRunReadPathSmoke');
const {
  auditArtifactCoverageScheduled,
  auditArtifactCoverageOnDemand,
  adminRunArtifactAudit,
} = require('./auditArtifactCoverage');
const { sweepArtifactRepairs, adminRunArtifactRepairSweep } = require('./sweepArtifactRepairs');
// Release 2b — dependents (minor track). GUARDIAN_READS_ENABLED stays OFF.
const { adminLinkGuardian } = require('./adminLinkGuardian');
const { adminRevokeGuardian } = require('./adminRevokeGuardian');
const { adminUnclaimedGuardiansReport } = require('./adminUnclaimedGuardiansReport');
const { adminOnboardingClassifier } = require('./adminOnboardingClassifier');
const { adminBatchInvite } = require('./adminBatchInvite');
const { adminBatchReissue } = require('./adminBatchReissue');
const { adminSyncMemberEmail } = require('./adminSyncMemberEmail');
// #496 Phase 1 / D-406 — scheduled per-practice delta discovery + auto-provision.
const { rosterDiscoveryTick } = require('./rosterDiscoveryTick');
// #496 Phase 2 / D-407 — governed per-practice auto-invite sender (default OFF).
const { autoInviteTick } = require('./autoInviteTick');
// #589 callable-only logical social sign-in; master/practice flags remain OFF.
// Blocking definitions are deliberately not loaded or exported. Re-registration
// and SDK audience validation require the separate #588 registered-hosted gate.
const { socialAvailability, socialBeginAttempt, socialLinkExisting, socialStartVerification, socialConfirmVerification } = require('./socialSignIn');
// D-316 / #527 — roster provisioner (resurrects live claim links for doc-less patients).
const { provisionRosterDocs } = require('./provisionRosterDocs');
// #362 / D-408 — portal-only signed event receiver.
const { sendgridEventWebhook } = require('./sendgridEventWebhook');
const { adminRosterBackfill } = require('./adminRosterBackfill');
const { memberSetGuardianConsent } = require('./memberSetGuardianConsent');
const { dependentBirthdaySweep } = require('./dependentBirthdaySweep');
const { backfillInternalUids } = require('./backfillInternalUids');
const { backfillArtifactObjects } = require('./backfillArtifactObjects');
// HTTP wrapper (admin-gated, minor-set validated). The runner module
// ./backfillElationReports is imported BY the wrapper, never exported here.
const { backfillElationReports } = require('./backfillElationReportsHttp');
// Auto-resume driver: orchestrates the backfill -> sweep -> coverage-audit
// sequence unattended. Re-implements nothing; it only decides when to re-POST.
const { backfillDriverTick, adminRunBackfillDriver } = require('./backfillDriver');
// D-317 — durable slow-chart hydration recovery. The driver runs reports AND
// letters in one run and is the only non-claim writer of hydrationStatus; the
// letters wrapper is the operator surface the reports backfill always had.
const { hydrationRecoveryDriver } = require('./hydrationRecoveryDriver');
const { hydrationRecoveryTick } = require('./hydrationRecoveryTick');
const { claimHydrationWorker } = require('./claimHydrationWorker');
const { backfillElationLettersHttp } = require('./backfillElationLettersHttp');

module.exports = {
  logPhiAcknowledgment,
  twilioConversationsToken,
  protectedConversationsApi,
  twilioWebhook,
  addProviderToConversation,
  getProviderConversations,
  createPatientConversation,
  getConversationMessages,
  sendMessage,
  setUserRole,
  syncDirectoryEntry,
  createUserProfile,
  syncElationPatients,
  getPatients,
  getPatient,
  getMyPatientRecord,
  getMyDependents,
  getProblems,
  getAppointments,
  getAllergies,
  getLabs,
  getImaging,
  getMedicalRecords,
  getLetters,
  getMedications,
  requestRefill,
  claimAccount,
  elationEventTarget,
  ingestElationReports,
  ingestElationLetters,
syncBeetextingContacts,
  adminIssueInvite,
  adminRevokeInvite,
  adminSetPortalAccess,
  adminGetPortalAccess,
  adminProvisionPatients,
  adminRunReadPathSmoke,
  auditArtifactCoverageScheduled,
  auditArtifactCoverageOnDemand,
  adminRunArtifactAudit,
  sweepArtifactRepairs,
  adminRunArtifactRepairSweep,
  adminLinkGuardian,
  adminRevokeGuardian,
  adminUnclaimedGuardiansReport,
  adminOnboardingClassifier,
  adminBatchInvite,
  adminBatchReissue,
  adminSyncMemberEmail,
  rosterDiscoveryTick,
  autoInviteTick,
  socialAvailability,
  socialBeginAttempt,
  socialLinkExisting,
  socialStartVerification,
  socialConfirmVerification,
  provisionRosterDocs,
  sendgridEventWebhook,
  adminRosterBackfill,
  memberSetGuardianConsent,
  dependentBirthdaySweep,
  backfillInternalUids,
  backfillArtifactObjects,
  backfillElationReports,
  backfillDriverTick,
  adminRunBackfillDriver,
  hydrationRecoveryDriver,
  hydrationRecoveryTick,
  claimHydrationWorker,
  backfillElationLettersHttp,
};

