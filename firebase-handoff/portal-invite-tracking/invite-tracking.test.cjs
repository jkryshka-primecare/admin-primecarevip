const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSender() {
  let message;
  const sandbox = {
    process: { env: {} }, module: { exports: {} },
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