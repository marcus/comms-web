import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchReceiptReport, receiptStateOf, watchMessageReceipts, type ReceiptState } from './receipts.ts';
import type { CommsReceipt, CommsReceiptReport } from './server/comms';

const agent = (handle: string, id = handle) => ({ id, handle, created_at: '', updated_at: '' });
const receipt = (state: 'read' | 'unread'): CommsReceipt => ({
	agent: agent('reader', 'agent-b'),
	state,
	...(state === 'read' ? { read_at: '2026-09-05T12:00:00Z' } : {})
});
const report = (...subscribers: CommsReceipt[]): CommsReceiptReport => ({ subscribers, inspectors: [] });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('per-agent state derives acknowledgment before retrieval depth', () => {
	assert.equal(receiptStateOf({ state: 'read' }), 'read');
	// An acknowledged message stays read even though it was also opened.
	assert.equal(receiptStateOf({ state: 'read', inspected_at: 'x', seen_at: 'y' }), 'read');
	assert.equal(receiptStateOf({ state: 'unread', inspected_at: 'x', seen_at: 'y' }), 'inspected');
	assert.equal(receiptStateOf({ state: 'unread', seen_at: 'y' }), 'seen');
	assert.equal(receiptStateOf({ state: 'unread' }), 'unseen');
	// An inspector carries no cursor state at all.
	assert.equal(receiptStateOf({ inspected_at: 'x' }), 'inspected');
	assert.equal(receiptStateOf({}), 'unseen');
});

test('receipt transport only observes the selected message and rejects malformed responses', async (t) => {
	const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
		assert.equal(url, '/api/receipts/message%2Fid');
		assert.equal(init?.method ?? 'GET', 'GET');
		assert.equal(init?.body, undefined);
		assert.equal(init?.cache, 'no-store');
		return Response.json({
			subscribers: [receipt('read')],
			inspectors: [{ agent: agent('orchestrator'), seen_at: 'x', inspected_at: 'x', seen_count: 1 }]
		});
	});
	const fetched = await fetchReceiptReport('message/id', new AbortController().signal);
	assert.equal(fetched.subscribers[0].state, 'read');
	assert.equal(fetched.inspectors[0].agent.handle, 'orchestrator');

	// The old bare-array shape is no longer a valid response.
	fetchMock.mock.mockImplementation(async () => Response.json({ receipts: [receipt('read')] }));
	await assert.rejects(fetchReceiptReport('message/id', new AbortController().signal), /Invalid read status/);
	fetchMock.mock.mockImplementation(async () => Response.json({ subscribers: [{ state: 'delivered' }], inspectors: [] }));
	await assert.rejects(fetchReceiptReport('message/id', new AbortController().signal), /Invalid read status/);
	fetchMock.mock.mockImplementation(async () => Response.json({ subscribers: [], inspectors: [{ seen_at: 'x' }] }));
	await assert.rejects(fetchReceiptReport('message/id', new AbortController().signal), /Invalid read status/);
	fetchMock.mock.mockImplementation(async () => Response.json({ error: 'offline' }, { status: 500 }));
	await assert.rejects(fetchReceiptReport('message/id', new AbortController().signal), /unavailable/);
});

test('read acknowledgments refresh without new messages', async (t) => {
	t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
	const states: ReceiptState[] = [];
	let calls = 0;
	const watch = watchMessageReceipts('message-a', (state) => states.push(state), {
		fetchReceipts: async () => report(receipt(++calls === 1 ? 'unread' : 'read')), intervalMs: 4000
	});
	t.after(() => watch.stop());
	await flush();
	assert.equal(states.at(-1)?.report?.subscribers[0].state, 'unread');
	t.mock.timers.tick(4000);
	await flush();
	assert.equal(states.at(-1)?.report?.subscribers[0].state, 'read');
	assert.equal(calls, 2);
});

test('stopping a selection aborts its request and ignores late results without overlapping reads', async (t) => {
	const states: ReceiptState[] = [];
	let calls = 0;
	let signal: AbortSignal | undefined;
	let finish!: (value: CommsReceiptReport) => void;
	const watch = watchMessageReceipts('old-message', (state) => states.push(state), {
		fetchReceipts: async (_, requestSignal) => {
			calls++;
			signal = requestSignal;
			return new Promise((resolve) => { finish = resolve; });
		}
	});
	t.after(() => watch.stop());
	await watch.refresh();
	assert.equal(calls, 1);
	watch.stop();
	assert.equal(signal?.aborted, true);
	finish(report(receipt('read')));
	await flush();
	assert.equal(states.length, 1);
	assert.equal(states[0].report, null);
});

test('refresh failure retains explicitly stale data and a retry recovers', async (t) => {
	let fail = false;
	let state!: ReceiptState;
	const watch = watchMessageReceipts('message-a', (next) => { state = next; }, {
		fetchReceipts: async () => { if (fail) throw new Error('offline'); return report(receipt('read')); }
	});
	t.after(() => watch.stop());
	await flush();
	const checkedAt = state.checkedAt;
	fail = true;
	await watch.refresh();
	assert.equal(state.error, true);
	assert.equal(state.report?.subscribers[0].state, 'read');
	assert.equal(state.checkedAt, checkedAt);
	fail = false;
	await watch.refresh();
	assert.equal(state.error, false);
});

test('hidden views defer reads and refresh immediately when requested on return', async (t) => {
	let visible = false;
	let calls = 0;
	const watch = watchMessageReceipts('message-a', () => {}, {
		isVisible: () => visible,
		fetchReceipts: async () => { calls++; return report(); }
	});
	t.after(() => watch.stop());
	assert.equal(calls, 0);
	visible = true;
	await watch.refresh();
	assert.equal(calls, 1);
});

test('a stalled request times out as unavailable instead of waiting forever', async (t) => {
	t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
	let state!: ReceiptState;
	const watch = watchMessageReceipts('message-a', (next) => { state = next; }, {
		timeoutMs: 100,
		fetchReceipts: (_, signal) => new Promise((_, reject) => {
			signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
		})
	});
	t.after(() => watch.stop());
	t.mock.timers.tick(100);
	await flush();
	assert.equal(state.error, true);
	assert.equal(state.loading, false);
	assert.equal(state.report, null);
});
