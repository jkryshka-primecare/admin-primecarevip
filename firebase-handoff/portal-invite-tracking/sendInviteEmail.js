// functions/core/services/email/sendInviteEmail.js
// Shared claim-invite sender. Extracted so the automated 18th-birthday
// conversion (dependentBirthdaySweep) sends the EXACT same email a
// staff-issued invite (adminIssueInvite) sends: same template, same From,
// same subject, same claim link shape.
//
// The raw claim token is single-use and account-claiming. It is never logged
// here and never returned; the only thing this module does with it is put it
// in the link inside the message body.

const sgMail = require('@sendgrid/mail');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'prive-care-vip';
const CLAIM_BASE = 'https://care.primecarevip.com/claim';

function claimEmailHtml(claimLink) {
  return (
    '<div style="background-color:#f4f4f5;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="width:100%;max-width:600px;box-sizing:border-box;margin:0 auto;background-color:#ffffff;padding:32px;">' +
        '<img src="https://care.primecarevip.com/email/prime-care-vip-email-logo-color.png" alt="Prime Care VIP" width="220" style="width:220px;max-width:70%;height:auto;display:block;margin-bottom:24px;" />' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 16px;">Dear Prime Care VIP Member,</p>' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 16px;">We\'re excited to invite you to your new Prime Care VIP Patient Portal! It\'s a secure, convenient way to stay connected with your care, where you can view your lab and imaging results, medications, and upcoming appointments in one place.</p>' +
        '<p style="color:#111111;font-size:18px;font-weight:bold;line-height:1.5;margin:24px 0 8px;">Activate your portal</p>' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 16px;">Use your unique invitation link below to create your account:</p>' +
        `<p style="margin:0 0 16px;"><a href="${claimLink}" style="color:#1a73e8;font-size:16px;word-break:break-all;">${claimLink}</a></p>` +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 16px;">For your security, this link is just for you and expires in 30 days. If it expires before you finish, contact us and we\'ll send a new one.</p>' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 24px;">Need help? Email us at health@primecarevip.com or call 561-948-2020.</p>' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0;">Warmly,<br />The Prime Care VIP Team</p>' +
        '<p><a href="<%asm_group_unsubscribe_raw_url%>">Unsubscribe from portal invitations</a></p>' +
      '</div>' +
    '</div>'
  );
}

let sendgridReady = false;
function claimEmailText(claimLink) {
  return [
    'Dear Prime Care VIP Member,',
    '',
    'Your Prime Care VIP Patient Portal is ready. View your lab and imaging results, medications, and upcoming appointments securely.',
    '',
    'Activate your portal using your unique invitation link:',
    claimLink,
    '',
    'For your security, this link is just for you and expires in 30 days. If it expires, contact us for a new one.',
    '',
    'Need help? Email health@primecarevip.com or call 561-948-2020.',
    '',
    'Warmly,',
    'The Prime Care VIP Team',
    '',
    'Unsubscribe from portal invitations: <%asm_group_unsubscribe_raw_url%>',
  ].join('\n');
}

async function initSendgrid() {
  if (sendgridReady) return;
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/SENDGRID_API_KEY/versions/latest`,
  });
  sgMail.setApiKey(version.payload.data.toString('utf8'));
  sendgridReady = true;
}

/**
 * Send the portal claim invite.
 * @param {{to: string, token: string}} args - `to` comes from the roster doc,
 *   never from caller input: the link is an account-claim token, so an
 *   arbitrary destination would be an account-takeover path.
 */
const INVITE_CATEGORY = 'portal_invite';

function inviteAsmGroupId() {
  const raw = process.env.SENDGRID_PORTAL_INVITE_ASM_GROUP_ID;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    throw new Error('sendInviteEmail: valid SENDGRID_PORTAL_INVITE_ASM_GROUP_ID required');
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new Error('sendInviteEmail: ASM group ID out of range');
  return id;
}

async function sendInviteEmail({ to, token }) {
  const recipient = typeof to === 'string' ? to.trim() : '';
  if (!recipient) throw new Error('sendInviteEmail: recipient required');
  if (!token) throw new Error('sendInviteEmail: token required');
  const groupId = inviteAsmGroupId();

  await initSendgrid();
  await sgMail.send({
    to: recipient,
    from: { email: 'health@primecarevip.com', name: 'Prime Care VIP' },
    subject: 'Your Prime Care VIP patient portal is ready',
    // Non-PHI tag so emailEvents can be filtered to invite sends (wave gate math).
    categories: [INVITE_CATEGORY],
    // SendGrid owns unsubscribe URLs and headers; no custom mailto or endpoint.
    asm: { groupId, groupsToDisplay: [groupId] },
    // Keep branded claim URLs intact; retain opens for invite wave checks.
    trackingSettings: {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: true },
      // Subscription tracking is GLOBAL to this SendGrid account. The ASM
      // footer above is group-scoped; label the global footer truthfully.
      subscriptionTracking: {
        enable: true,
        html: '<p>To unsubscribe from all emails sent through this mailing account, <% click here %>.</p>',
        text: 'To unsubscribe from all emails sent through this mailing account, <% click here %>.',
      },
    },
    content: [
      { type: 'text/plain', value: claimEmailText(`${CLAIM_BASE}?t=${token}`) },
      { type: 'text/html', value: claimEmailHtml(`${CLAIM_BASE}?t=${token}`) },
    ],
  });
}

module.exports = { sendInviteEmail, INVITE_CATEGORY, claimEmailHtml, claimEmailText, CLAIM_BASE };
