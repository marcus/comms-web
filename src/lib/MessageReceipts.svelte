<script lang="ts">
	import { CheckCheck, ChevronRight, Clock, RefreshCw } from '@lucide/svelte';
	import { watchMessageReceipts, type ReceiptState } from './receipts';
	import { formatExactDate, formatTimeAgo } from './utils';

	let { messageId, now }: { messageId: string; now: number } = $props();
	let receiptState = $state<ReceiptState>({ receipts: null, loading: true, error: false, checkedAt: null });
	let retry = $state<(() => Promise<void>) | null>(null);
	const readers = $derived(receiptState.receipts?.filter((receipt) => receipt.state === 'read') ?? []);
	const orderedReceipts = $derived([...(receiptState.receipts ?? [])].sort((a, b) => Number(b.state === 'read') - Number(a.state === 'read')));
	const names = $derived(readers.slice(0, 2).map((receipt) => `@${receipt.agent.handle}`).join(', '));

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

<div class="message-receipts" aria-label="Message read acknowledgments">
	{#if receiptState.loading}
		<div class="receipt-status"><Clock size={13} /><span>Checking read status…</span></div>
	{:else if receiptState.receipts?.length}
		<details>
			<summary class:has-readers={readers.length > 0}>
				{#if readers.length}<CheckCheck size={14} />{:else}<Clock size={13} />{/if}
				<span class="receipt-summary">
					{#if readers.length}
						{receiptState.error ? 'Last known readers:' : 'Read by'} {names}{readers.length > 2 ? ` +${readers.length - 2}` : ''}
					{:else}
						{receiptState.error ? 'No reads at last check' : 'No read acknowledgments yet'}
					{/if}
				</span>
				<span class="receipt-count">{readers.length} of {receiptState.receipts.length}</span>
				<ChevronRight size={12} class="receipt-chevron" />
			</summary>
			<div class="receipt-details">
				{#each orderedReceipts as receipt (receipt.agent.id)}
					<div class="receipt-person">
						<span class="receipt-handle" title={receipt.agent.display_name || receipt.agent.handle}>@{receipt.agent.handle}</span>
						<span class="receipt-person-state" class:read={receipt.state === 'read'}>
							{#if receipt.state === 'read'}
								<CheckCheck size={12} />
								{#if receipt.read_at}<time datetime={receipt.read_at} title={formatExactDate(receipt.read_at)}>Read {formatTimeAgo(receipt.read_at, now)}</time>{:else}Marked read{/if}
							{:else}<Clock size={11} /><span>Not marked read</span>{/if}
						</span>
					</div>
				{/each}
				<p class="receipt-explanation">A read acknowledgment means the agent marked messages read through this point. Delivery is not tracked separately.</p>
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
	summary.has-readers { color: #9baea2; }
	.receipt-summary { min-width: 0; overflow-wrap: anywhere; }
	.receipt-count { color: var(--text-muted); font-size: 10px; white-space: nowrap; margin-left: 3px; }
	:global(.receipt-chevron) { transition: transform var(--duration-fast); flex-shrink: 0; }
	details[open] :global(.receipt-chevron) { transform: rotate(90deg); }
	.receipt-details { margin-top: 9px; padding: 9px 14px; border: 1px solid var(--border-subtle); border-radius: 0; background: rgba(0, 0, 0, 0.09); max-width: 580px; }
	.receipt-person { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 7px 0; }
	.receipt-handle { color: var(--text-secondary); min-width: 0; overflow-wrap: anywhere; }
	.receipt-person-state { display: flex; align-items: center; justify-content: flex-end; gap: 5px; text-align: right; font-size: 10px; flex-shrink: 0; }
	.receipt-person-state.read { color: #9baea2; }
	.receipt-explanation { border-top: 1px solid var(--border-subtle); margin-top: 6px; padding-top: 10px; padding-bottom: 4px; font-size: 10px; line-height: 1.6; color: var(--text-muted); }
	.receipt-error { flex-wrap: wrap; }
	.receipt-error button { color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; padding: 3px 5px; font-size: 10px; }
	.receipt-error button:hover { color: var(--text-primary); background: var(--bg-hover); border-radius: 4px; }
</style>
