import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvatarRecipe, type AvatarPreferenceRecord } from './avatar-preferences.ts';

const at = '2026-09-07T00:00:00Z';
const records: AvatarPreferenceRecord[] = [
	{ scope: 'default', key: 'global', recipe: { style: 'gorey' }, updated_at: at },
	{ scope: 'agent', key: 'agent-a', recipe: { style: 'pebble' }, updated_at: at },
	{ scope: 'session', key: 'agent-a:same-session', recipe: { style: 'picasso' }, updated_at: at }
];

test('resolves session over agent over default', () => {
	assert.equal(resolveAvatarRecipe(records, 'agent-a', 'same-session').source, 'session');
	assert.equal(resolveAvatarRecipe(records, 'agent-a').source, 'agent');
	assert.equal(resolveAvatarRecipe(records, 'agent-b').source, 'default');
});

test('session identity includes the agent identity', () => {
	assert.equal(resolveAvatarRecipe(records, 'agent-b', 'same-session').source, 'default');
});

test('a deletion record reveals the inherited layer', () => {
	const deleted = [...records, { scope: 'agent' as const, key: 'agent-a', recipe: null, updated_at: at }];
	assert.equal(resolveAvatarRecipe(deleted, 'agent-a').source, 'default');
});
