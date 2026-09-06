import type { CommsReceipt } from './server/comms';

export interface ReceiptState {
	receipts: CommsReceipt[] | null;
	loading: boolean;
	error: boolean;
	checkedAt: number | null;
}

type ReceiptFetcher = (messageId: string, signal: AbortSignal) => Promise<CommsReceipt[]>;

export async function fetchReceiptList(messageId: string, signal: AbortSignal): Promise<CommsReceipt[]> {
	const response = await fetch(`/api/receipts/${encodeURIComponent(messageId)}`, {
		signal,
		cache: 'no-store'
	});
	if (!response.ok) throw new Error('Read status unavailable');
	const data = await response.json();
	if (!Array.isArray(data.receipts) || !data.receipts.every((receipt: CommsReceipt) =>
		receipt?.agent?.id && receipt.agent.handle && (receipt.state === 'read' || receipt.state === 'unread')
	)) throw new Error('Invalid read status response');
	return data.receipts;
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
	const fetchReceipts = options.fetchReceipts ?? fetchReceiptList;
	let state: ReceiptState = { receipts: null, loading: true, error: false, checkedAt: null };
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
			const receipts = await fetchReceipts(messageId, request.signal);
			if (stopped || request.signal.aborted) return;
			state = { receipts, loading: false, error: false, checkedAt: Date.now() };
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
