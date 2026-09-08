import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderQuery } from './avatars.ts';

test('render recipes have a canonical complete cache identity', () => {
	const first = renderQuery('agent/id', { style: 'pebble', inputs: { zed: 'last', color: 'sage' } });
	const second = renderQuery('agent/id', { style: 'pebble', inputs: { color: 'sage', zed: 'last' } });
	assert.equal(first.toString(), second.toString());
	assert.equal(first.get('seed'), 'agent/id');
	assert.equal(first.get('style'), 'pebble');
	assert.equal(first.get('format'), 'svg');
});
