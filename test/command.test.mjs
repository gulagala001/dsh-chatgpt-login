import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommand, formatStatus } from '../src/command.mjs';

test('terminal commands never record or echo authorization input and route it to the current prompt', async () => {
  const secret = 'fixture-one-time-authorization-secret'; let supplied;
  const state = { configured: false, attempt: { id: 'attempt', phase: 'waiting', notices: [], prompt: { id: 'prompt', kind: 'secret', message: '授权码' } } };
  const command = createCommand({ status: async () => state, answer: async (id, promptId, value) => { supplied = { id, promptId, value }; return { configured: true }; } });
  assert.equal(command.recordInput, false);
  const result = await command.handler({ rawInput: ' answer ' + secret });
  assert.deepEqual(supplied, { id: 'attempt', promptId: 'prompt', value: secret });
  assert.equal(result.kind, 'success'); assert.ok(!JSON.stringify(result).includes(secret));
});

test('terminal login selects browser or device-code and reports the authorization URL', async () => {
  const modes = [];
  const state = { configured: false, attempt: { phase: 'waiting', notices: [{ message: '浏览器授权', url: 'https://auth.openai.com/authorize?state=fixture' }] } };
  const command = createCommand({ start: async mode => { modes.push(mode); return state; } });
  assert.match((await command.handler({ rawInput: 'login' })).text, /https:\/\/auth.openai.com/);
  await command.handler({ rawInput: 'login device_code' });
  assert.deepEqual(modes, ['browser', 'device_code']);
});

test('terminal errors are sanitized even when an underlying provider puts credentials in its message', async () => {
  const command = createCommand({ logout: async () => { throw Error('secret-bearer-credential'); } });
  const result = await command.handler({ rawInput: 'logout' });
  assert.equal(result.kind, 'error'); assert.ok(!result.text.includes('secret-bearer-credential'));
  assert.ok(!formatStatus({ configured: true, secret: 'secret-bearer-credential' }).includes('secret-bearer-credential'));
});
