import type { CommsInspector, CommsReceipt, CommsReceiptReport, CommsRetrieval } from './server/comms';

export interface ReceiptState {
	report: CommsReceiptReport | null;
	loading: boolean;
	error: boolean;
	checkedAt: number | null;
}

/**
 * The one word a reader needs, derived from the two independent facts a
 * receipt carries. Kept as a pure function so the web and the CLI agree:
 * acknowledged wins, then a full body, then a preview, then nothing.
 */
export type AgentReceiptState = 'read' | 'inspected' | 'seen' | 'unseen';

export function receiptStateOf(entry: CommsRetrieval & { state?: string }): AgentReceiptState {
	if (entry.state === 'read') return 'read';
	if (entry.inspected_at) return 'inspected';
	if (entry.seen_at) return 'seen';
	return 'unseen';
}

type ReceiptFetcher = (messageId: string, signal: AbortSignal) => Promise<CommsReceiptReport>;

const isAgent = (value: any) => Boolean(value?.agent?.id && value?.agent?.handle);
const isSubscriber = (value: any): value is CommsReceipt =>
	isAgent(value) && (value.state === 'read' || value.state === 'unread');
const isInspector = (value: any): value is CommsInspector => isAgent(value);

export async function fetchReceiptReport(
	messageId: string,
	signal: AbortSignal
): Promise<CommsReceiptReport> {
	const response = await fetch(`/api/receipts/${encodeURIComponent(messageId)}`, {
		signal,
		cache: 'no-store'
	});
	if (!response.ok) throw new Error('Read status unavailable');
	const data = await response.json();
	if (
		!Array.isArray(data.subscribers) ||
		!data.subscribers.every(isSubscriber) ||
		!Array.isArray(data.inspectors) ||
		!data.inspectors.every(isInspector)
	)
		throw new Error('Invalid read status response');
	return { subscribers: data.subscribers, inspectors: data.inspectors };
}

/** Observe the selected message independently of new-message events. Never advances a read cursor. */
export function watchMessageReceipts(
	messageId: string,
	onChange: (state: ReceiptState) => void,
	options: {
		fetchReceipts?: ReceiptFetcher;
		intervalMs?: number;
		timeoutMs?: number;
		isVisible?: () => boolean;
	} = {}
) {
	const fetchReceipts = options.fetchReceipts ?? fetchReceiptReport;
	let state: ReceiptState = { report: null, loading: true, error: false, checkedAt: null };
	let stopped = false;
	let pending = false;
	let controller: AbortController | null = null;
	let timeout: ReturnType<typeof setTimeout> | undefined;

	async function refresh() {
		if (stopped || pending || options.isVisible?.() === false) return;
		pending = true;
		controller = new AbortController();
		const request = controller;
		timeout = setTimeout(() => request.abort(), options.timeoutMs ?? 10_000);
		try {
			const report = await fetchReceipts(messageId, request.signal);
			if (stopped || request.signal.aborted) return;
			state = { report, loading: false, error: false, checkedAt: Date.now() };
			onChange(state);
		} catch {
			if (stopped) return;
			state = { ...state, loading: false, error: true };
			onChange(state);
		} finally {
			clearTimeout(timeout);
			pending = false;
		}
	}

	onChange(state);
	void refresh();
	const interval = setInterval(() => void refresh(), options.intervalMs ?? 4_000);
	return {
		refresh,
		stop() {
			stopped = true;
			clearInterval(interval);
			clearTimeout(timeout);
			controller?.abort();
		}
	};
}
