const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const owning = path.join(__dirname, '../../core/services/email/sendgridEvents.js');
const local = path.join(__dirname, '../portal-sendgrid/functions/core/services/email/sendgridEvents.js');
const sandbox = { module: { exports: {} }, require(name) {
  if (name === 'crypto') return require('node:crypto');
  if (name === './suppression') return { buildSuppressionRow() {} };
  throw new Error('Unexpected dependency: ' + name);
} };
vm.runInNewContext(fs.readFileSync(fs.existsSync(owning) ? owning : local, 'utf8'), sandbox);
for (const event of ['unsubscribe', 'group_unsubscribe']) {
  test(`${event} is classified by the existing receiver as hard unsubscribe suppression`, () => {
    const result = sandbox.module.exports.classifyEvent({
      email: 'synthetic@example.com', event, sg_event_id: 'fixture-id', asm_group_id: 36716,
    });
    assert.equal(result.valid, true);
    assert.equal(result.eventType, event);
    assert.equal(result.suppression.reason, 'unsubscribe');
    assert.equal(result.suppression.severity, 'hard');
    assert.equal(result.funnel, false);
  });
}