import test from 'node:test';
import assert from 'node:assert/strict';
import { validState, validateClient, redirectUri } from '../scripts/setup-google-drive.mjs';

test('only the configured web callback is accepted', () => {
  const web = { client_id: 'test', client_secret: 'test', redirect_uris: [redirectUri] };
  assert.equal(validateClient({ web }), web);
  assert.throws(() => validateClient({ installed: web }));
  assert.throws(() => validateClient({ web: { ...web, redirect_uris: ['http://localhost:8765/oauth/callback'] } }));
  assert.throws(() => validateClient({ web: { ...web, client_secret: '' } }));
});

test('callback state rejects missing, different and unequal-length values', () => {
  assert.equal(validState('abc', 'abc'), true);
  for (const actual of [null, '', 'abcd', 'abd']) {
    assert.equal(validState(actual, 'abc'), false);
  }
});
