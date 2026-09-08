import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutationIsSameOrigin } from './request-origin.ts';

test('allows same-origin and non-browser mutations', () => {
	assert.equal(mutationIsSameOrigin(new Request('http://local/api'), 'http://local'), true);
	assert.equal(mutationIsSameOrigin(new Request('http://local/api', { headers: { origin: 'http://local' } }), 'http://local'), true);
});

test('rejects cross-origin browser mutations', () => {
	assert.equal(mutationIsSameOrigin(new Request('http://local/api', { headers: { origin: 'https://evil.example' } }), 'http://local'), false);
});
