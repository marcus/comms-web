<script lang="ts">
	import { Check, CheckCheck, ChevronRight, Clock, Eye, RefreshCw } from '@lucide/svelte';
	import { receiptStateOf, watchMessageReceipts, type AgentReceiptState, type ReceiptState } from './receipts';
	import { formatExactDate, formatTimeAgo } from './utils';

	let { messageId, now }: { messageId: string; now: number } = $props();
	let receiptState = $state<ReceiptState>({ report: null, loading: true, error: false, checkedAt: null });
	let retry = $state<(() => Promise<void>) | null>(null);

	const subscribers = $derived(receiptState.report?.subscribers ?? []);
	const inspectors = $derived(receiptState.report?.inspectors ?? []);
	const anyone = $derived(subscribers.length > 0 || inspectors.length > 0);

	const rank: Record<AgentReceiptState, number> = { read: 0, inspected: 1, seen: 2, unseen: 3 };
	const orderedSubscribers = $derived(
		[...subscribers].sort((a, b) => rank[receiptStateOf(a)] - rank[receiptStateOf(b)])
	);
	const byState = $derived({
		read: subscribers.filter((entry) => receiptStateOf(entry) === 'read'),
		inspected: subscribers.filter((entry) => receiptStateOf(entry) === 'inspected'),
		seen: subscribers.filter((entry) => receiptStateOf(entry) === 'seen')
	});

	/** The strongest signal any subscriber reached, which the collapsed line leads with. */
	const lead = $derived<AgentReceiptState>(
		byState.read.length ? 'read' : byState.inspected.length ? 'inspected' : byState.seen.length ? 'seen' : 'unseen'
	);
	const names = (entries: { agent: { handle: string } }[]) =>
		entries.slice(0, 2).map((entry) => `@${entry.agent.handle}`).join(', ') +
		(entries.length > 2 ? ` +${entries.length - 2}` : '');
	const summary = $derived(
		lead === 'read'
			? `${receiptState.error ? 'Last known readers:' : 'Read by'} ${names(byState.read)}`
			: lead === 'inspected'
				? `Opened by ${names(byState.inspected)}, not acknowledged`
				: lead === 'seen'
					? `Previewed by ${names(byState.seen)}, not acknowledged`
					: receiptState.error
						? 'No retrieval at last check'
						: 'Not yet retrieved by any agent'
	);
	const inspectorNote = $derived(
		inspectors.length ? ` · ${inspectors.length} inspector${inspectors.length === 1 ? '' : 's'}` : ''
	);

	const visits = (count?: number) => (count && count > 1 ? ` · ${count} visits` : '');

	$effect(() => {
		const watch = watchMessageReceipts(messageId, (next) => { receiptState = next; }, {
			isVisible: () => document.visibilityState !== 'hidden'
		});
		retry = watch.refresh;
		const refreshOnReturn = () => { if (document.visibilityState !== 'hidden') void watch.refresh(); };
		document.addEventListener('visibilitychange', refreshOnReturn);
		return () => {
			watch.stop();
			document.removeEventListener('visibilitychange', refreshOnReturn);
		};
	});
</script>

<div class="message-receipts" aria-label="Message acknowledgments and retrieval">
	{#if receiptState.loading}
		<div class="receipt-status"><Clock size={13} /><span>Checking read status…</span></div>
	{:else if anyone}
		<details>
			<summary class:has-readers={lead === 'read'}>
				{#if lead === 'read'}<CheckCheck size={14} />
				{:else if lead === 'inspected'}<Eye size={13} />
				{:else if lead === 'seen'}<Check size={13} />
				{:else}<Clock size={13} />{/if}
				<span class="receipt-summary">{summary}{inspectorNote}</span>
				<span class="receipt-count" title="Acknowledgments, not retrievals">{byState.read.length} of {subscribers.length}</span>
				<ChevronRight size={12} class="receipt-chevron" />
			</summary>
			<div class="receipt-details">
				{#each orderedSubscribers as receipt (receipt.agent.id)}
					{@const state = receiptStateOf(receipt)}
					<div class="receipt-person">
						<span class="receipt-handle" title={receipt.agent.display_name || receipt.agent.handle}>@{receipt.agent.handle}</span>
						<span class="receipt-person-state" class:read={state === 'read'} class:inspected={state === 'inspected'}>
							{#if state === 'read'}
								<CheckCheck size={12} />
								{#if receipt.read_at}<time datetime={receipt.read_at} title={formatExactDate(receipt.read_at)}>Read {formatTimeAgo(receipt.read_at, now)}</time>{:else}Marked read{/if}
							{:else if state === 'inspected'}
								<Eye size={12} />
								<time datetime={receipt.inspected_at} title={formatExactDate(receipt.inspected_at!)}>Opened {formatTimeAgo(receipt.inspected_at!, now)}{visits(receipt.seen_count)}</time>
							{:else if state === 'seen'}
								<Check size={12} />
								<time datetime={receipt.seen_at} title={formatExactDate(receipt.seen_at!)}>Previewed {formatTimeAgo(receipt.seen_at!, now)}{visits(receipt.seen_count)}</time>
							{:else}
								<Clock size={11} /><span>Not retrieved</span>
							{/if}
						</span>
					</div>
				{/each}
				{#if inspectors.length}
					<p class="receipt-section">Also inspected by</p>
					{#each inspectors as inspector (inspector.agent.id)}
						<div class="receipt-person">
							<span class="receipt-handle" title={inspector.agent.display_name || inspector.agent.handle}>@{inspector.agent.handle}</span>
							<span class="receipt-person-state inspected">
								<Eye size={12} />
								{#if inspector.inspected_at}
									<time datetime={inspector.inspected_at} title={formatExactDate(inspector.inspected_at)}>Opened {formatTimeAgo(inspector.inspected_at, now)}{visits(inspector.seen_count)}</time>
								{:else if inspector.seen_at}
									<time datetime={inspector.seen_at} title={formatExactDate(inspector.seen_at)}>Previewed {formatTimeAgo(inspector.seen_at, now)}{visits(inspector.seen_count)}</time>
								{:else}<span>Retrieved</span>{/if}
							</span>
						</div>
					{/each}
				{/if}
				<p class="receipt-explanation">
					Read means the agent advanced its read cursor through this message.
					Opened means the full body was returned to it.
					Previewed means it saw the headline in its inbox.
					Delivery is not tracked separately.
				</p>
			</div>
		</details>
	{:else if !receiptState.error}
		<div class="receipt-status" title="The service reports no receipt recipients for this message."><Clock size={13} /><span>No receipt recipients reported</span></div>
	{/if}
	{#if receiptState.error}
		<div class="receipt-status receipt-error">
			<span>Read status unavailable{receiptState.checkedAt ? ` · last checked ${formatTimeAgo(new Date(receiptState.checkedAt).toISOString(), now)}` : ''}</span>
			<button onclick={() => retry?.()} aria-label="Retry read status"><RefreshCw size={11} /> Retry</button>
		</div>
	{/if}
</div>

<style>
	.message-receipts { max-width: 117ch; color: var(--text-muted); font-size: 11px; margin-top: -10px; }
	.receipt-status, summary { display: flex; align-items: center; gap: 7px; min-height: 28px; }
	summary { cursor: pointer; list-style: none; width: fit-content; max-width: 100%; border-radius: 5px; transition: color var(--duration-fast); }
	summary::-webkit-details-marker { display: none; }
	summary:hover, summary:focus-visible { color: var(--text-primary); }
	summary:focus-visible { outline: 2px solid var(--accent-default); outline-offset: 4px; }
	summary.has-readers { color: var(--text-receipt-read); }
	.receipt-summary { min-width: 0; overflow-wrap: anywhere; }
	.receipt-count { color: var(--text-muted); font-size: 10px; white-space: nowrap; margin-left: 3px; }
	:global(.receipt-chevron) { transition: transform var(--duration-fast); flex-shrink: 0; }
	details[open] :global(.receipt-chevron) { transform: rotate(90deg); }
	.receipt-details { margin-top: 9px; padding: 9px 14px; border: 1px solid var(--border-subtle); border-radius: 0; background: rgba(0, 0, 0, 0.09); max-width: 580px; }
	.receipt-person { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 7px 0; }
	.receipt-handle { color: var(--text-secondary); min-width: 0; overflow-wrap: anywhere; }
	.receipt-person-state { display: flex; align-items: center; justify-content: flex-end; gap: 5px; text-align: right; font-size: 10px; flex-shrink: 0; }
	.receipt-person-state.read { color: var(--text-receipt-read); }
	.receipt-person-state.inspected { color: var(--text-secondary); }
	.receipt-section { border-top: 1px solid var(--border-subtle); margin-top: 6px; padding-top: 10px; font-size: 10px; color: var(--text-muted); }
	.receipt-explanation { border-top: 1px solid var(--border-subtle); margin-top: 6px; padding-top: 10px; padding-bottom: 4px; font-size: 10px; line-height: 1.6; color: var(--text-muted); }
	.receipt-error { flex-wrap: wrap; }
	.receipt-error button { color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; padding: 3px 5px; font-size: 10px; }
	.receipt-error button:hover { color: var(--text-primary); background: var(--bg-hover); border-radius: 4px; }
</style>
