const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSender(env = { SENDGRID_PORTAL_INVITE_ASM_GROUP_ID: '12345' }) {
  let message;
  const sandbox = {
    process: { env }, module: { exports: {} },
    require(name) {
      if (name === '@sendgrid/mail') return {
        setApiKey() {}, async send(value) { message = value; },
      };
      if (name === '@google-cloud/secret-manager') return {
        SecretManagerServiceClient: class {
          async accessSecretVersion() { return [{ payload: { data: Buffer.from('fixture-only') } }]; }
        },
      };
      throw new Error('Unexpected dependency: ' + name);
    },
  };
  const owningPath = path.join(__dirname, '../../core/services/email/sendInviteEmail.js');
  const localPath = path.join(__dirname, 'sendInviteEmail.js');
  vm.runInNewContext(fs.readFileSync(fs.existsSync(owningPath) ? owningPath : localPath, 'utf8'), sandbox);
  return { send: sandbox.module.exports.sendInviteEmail, message: () => message };
}

test('portal invite disables HTML and plain-text click tracking', async () => {
  const sender = loadSender();
  await sender.send({ to: 'synthetic@example.com', token: 'synthetic-token' });
  assert.equal(sender.message().trackingSettings.clickTracking.enable, false);
  assert.equal(sender.message().trackingSettings.clickTracking.enableText, false);
});

test('portal invite retains open tracking', async () => {
  const sender = loadSender();
  await sender.send({ to: 'synthetic@example.com', token: 'synthetic-token' });
  assert.equal(sender.message().trackingSettings.openTracking.enable, true);
});

test('normal sender keeps exact portal_invite category and practice From', async () => {
  const sender = loadSender();
  await sender.send({ to: 'synthetic@example.com', token: 'synthetic-token' });
  assert.deepEqual(Array.from(sender.message().categories), ['portal_invite']);
  assert.equal(sender.message().from.email, 'health@primecarevip.com');
});

test('invite provides plain-text and HTML alternatives with the same claim link', async () => {
  const sender = loadSender();
  await sender.send({ to: 'synthetic@example.com', token: 'synthetic-token' });
  const parts = sender.message().content;
  assert.deepEqual(Array.from(parts, part => part.type), ['text/plain', 'text/html']);
  for (const part of parts) {
    assert.ok(part.value.includes('https://care.primecarevip.com/claim?t=synthetic-token'));
    assert.ok(part.value.includes('30 days'));
  }
  assert.equal(/<(?:div|p|a)\b/.test(parts[0].value), false);
});

test('invite uses the configured ASM group, not a custom unsubscribe header', async () => {
  const sender = loadSender();
  await sender.send({ to: 'synthetic@example.com', token: 'synthetic-token' });
  assert.equal(sender.message().asm.groupId, 12345);
  assert.deepEqual(Array.from(sender.message().asm.groupsToDisplay), [12345]);
  assert.equal(sender.message().headers, undefined);
  for (const part of sender.message().content) {
    assert.ok(part.value.includes('<%asm_group_unsubscribe_raw_url%>'));
  }
});

test('invite enables per-message subscription tracking without a replacement tag', async () => {
  const sender = loadSender();
  await sender.send({ to: 'synthetic@example.com', token: 'synthetic-token' });
  const settings = sender.message().trackingSettings.subscriptionTracking;
  assert.equal(settings.enable, true);
  assert.ok(settings.html.includes('<% click here %>'));
  assert.ok(settings.text.includes('<% click here %>'));
  assert.equal(settings.substitutionTag, undefined);
});

test('invite refuses absent or invalid ASM configuration before transport', async () => {
  for (const value of [undefined, '', '0', '-1', '1.5', '123x', ' 123 ', '9007199254740992']) {
    const sender = loadSender({ SENDGRID_PORTAL_INVITE_ASM_GROUP_ID: value });
    await assert.rejects(sender.send({ to: 'synthetic@example.com', token: 'synthetic-token' }), /ASM/);
    assert.equal(sender.message(), undefined);
  }
});