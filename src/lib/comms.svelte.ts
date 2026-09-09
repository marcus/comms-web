/**
 * Client-side state for the Comms inbox.
 *
 * One rune-backed store shared by every component. Components read and write
 * fields directly (`comms.selectedMessageId = id`), and call the async methods
 * for anything that talks to the API. Nothing in here touches the DOM except
 * the element refs used for keyboard focus.
 */
import type { CommsAgent, CommsHandshake, CommsMessage, CommsTopic } from '$lib/server/comms';

export type ActivityFilter = 'all' | 'public' | 'direct';
export type ComposeType = 'topic' | 'direct';

const NEW_HIGHLIGHT_MS = 2500;
const TIME_TICK_MS = 5000;

class CommsStore {
	// Server data
	messages = $state<CommsMessage[]>([]);
	topics = $state<CommsTopic[]>([]);
	agents = $state<CommsAgent[]>([]);
	status = $state<CommsHandshake | null>(null);

	// Selection & filters
	selectedMessageId = $state<string | null>(null);
	selectedTopicId = $state<string | null>(null);
	selectedAgentId = $state<string | null>(null);
	activeFilter = $state<ActivityFilter>('all');
	searchQuery = $state('');

	// Detail
	threadMessages = $state<CommsMessage[]>([]);
	loadingThread = $state(false);

	// Connection & transient UI
	isRefreshing = $state(false);
	liveConnected = $state(false);
	now = $state(Date.now());
	newlyArrivedIds = $state<Set<string>>(new Set());
	error = $state<string | null>(null);

	// Reply
	replyBody = $state('');
	replyAuthor = $state('');
	isReplying = $state(false);

	// Compose
	showComposeModal = $state(false);
	composeType = $state<ComposeType>('topic');
	composeTopic = $state('');
	composeRecipient = $state('');
	composeTitle = $state('');
	composeBody = $state('');
	isComposing = $state(false);

	// Focus targets
	searchInputEl = $state<HTMLInputElement | null>(null);
	replyTextareaEl = $state<HTMLTextAreaElement | null>(null);

	// Derived
	agentMap = $derived(new Map<string, CommsAgent>(this.agents.map((a) => [a.id, a])));
	topicMap = $derived(new Map<string, CommsTopic>(this.topics.map((t) => [t.id, t])));
	publicTopics = $derived(this.topics.filter((t) => t.kind === 'public'));
	directTopics = $derived(this.topics.filter((t) => t.kind === 'direct'));
	selectedMessage = $derived(this.messages.find((m) => m.id === this.selectedMessageId) ?? null);

	/** Messages per topic id, computed once per messages change. */
	topicCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const m of this.messages) counts.set(m.topic_id, (counts.get(m.topic_id) ?? 0) + 1);
		return counts;
	});

	filteredMessages = $derived.by(() => {
		let list = this.messages;

		if (this.selectedTopicId) {
			list = list.filter((m) => m.topic_id === this.selectedTopicId);
		} else if (this.selectedAgentId) {
			list = list.filter((m) => m.author_id === this.selectedAgentId);
		} else if (this.activeFilter === 'public') {
			list = list.filter((m) => {
				const top = this.topicMap.get(m.topic_id);
				return !top || top.kind === 'public';
			});
		} else if (this.activeFilter === 'direct') {
			list = list.filter((m) => this.topicMap.get(m.topic_id)?.kind === 'direct');
		}

		const q = this.searchQuery.trim().toLowerCase();
		if (q) {
			list = list.filter((m) => {
				const author = this.agentMap.get(m.author_id);
				const topic = this.topicMap.get(m.topic_id);
				return (
					m.title.toLowerCase().includes(q) ||
					m.body.toLowerCase().includes(q) ||
					(author?.handle.toLowerCase().includes(q) ?? false) ||
					(topic?.name.toLowerCase().includes(q) ?? false) ||
					m.id.toLowerCase().includes(q)
				);
			});
		}

		return list;
	});

	/** Human-readable label for the current list view. */
	viewTitle = $derived.by(() => {
		if (this.selectedTopicId) return { prefix: '#', text: this.topicMap.get(this.selectedTopicId)?.name ?? 'Topic' };
		if (this.selectedAgentId) return { prefix: '@', text: this.agentMap.get(this.selectedAgentId)?.handle ?? 'Agent' };
		if (this.activeFilter === 'public') return { prefix: '', text: 'Public Topics' };
		if (this.activeFilter === 'direct') return { prefix: '', text: 'Direct Messages' };
		return { prefix: '', text: 'All Messages' };
	});

	hasActiveFilter = $derived(
		!!this.searchQuery || !!this.selectedTopicId || !!this.selectedAgentId || this.activeFilter !== 'all'
	);

	// ---- Navigation -------------------------------------------------------

	setFilter(filter: ActivityFilter) {
		this.selectedTopicId = null;
		this.selectedAgentId = null;
		this.activeFilter = filter;
	}

	selectTopic(id: string) {
		this.selectedTopicId = id;
		this.selectedAgentId = null;
	}

	selectAgent(id: string) {
		this.selectedAgentId = id;
		this.selectedTopicId = null;
	}

	resetFilters() {
		this.searchQuery = '';
		this.setFilter('all');
	}

	navigateList(direction: 1 | -1) {
		const list = this.filteredMessages;
		if (list.length === 0) return;
		const currentIndex = list.findIndex((m) => m.id === this.selectedMessageId);
		let nextIndex =
			currentIndex === -1 ? (direction > 0 ? 0 : list.length - 1) : currentIndex + direction;
		nextIndex = Math.min(Math.max(nextIndex, 0), list.length - 1);
		const next = list[nextIndex];
		if (!next) return;
		this.selectedMessageId = next.id;
		requestAnimationFrame(() => {
			document.getElementById('msg-row-' + next.id)?.scrollIntoView({ block: 'nearest' });
		});
	}

	// ---- Data -------------------------------------------------------------

	async loadData(showSpinner = true) {
		if (showSpinner) this.isRefreshing = true;
		try {
			const res = await fetch('/api/data?limit=100');
			if (!res.ok) return;
			const data = await res.json();
			this.status = data.status;
			this.topics = data.topics;
			this.agents = data.agents;
			this.messages = data.messages;

			if (!this.replyAuthor && this.agents.length > 0) this.replyAuthor = this.agents[0].handle;
			if (!this.composeTopic) {
				const firstPublic = this.topics.find((t) => t.kind === 'public');
				if (firstPublic) this.composeTopic = firstPublic.name;
			}
			if (!this.selectedMessageId && this.messages.length > 0) {
				this.selectedMessageId = this.messages[0].id;
			}
		} catch (err) {
			console.error('Failed to load comms data', err);
		} finally {
			if (showSpinner) this.isRefreshing = false;
		}
	}

	async selectMessage(id: string) {
		this.selectedMessageId = id;
		this.loadingThread = true;
		this.threadMessages = [];
		try {
			// Receipts are owned by MessageReceipts, which polls them on its own
			// cadence; fetching them here as well would duplicate that watcher.
			const threadRes = await fetch(`/api/thread/${encodeURIComponent(id)}`);
			if (threadRes.ok) this.threadMessages = (await threadRes.json()).items ?? [];
		} catch (err) {
			console.error('Error fetching thread', err);
		} finally {
			this.loadingThread = false;
		}
	}

	/** Flag ids as newly arrived for the row-entry animation, then clear them. */
	markNew(ids: string[]) {
		if (ids.length === 0) return;
		this.newlyArrivedIds = new Set([...this.newlyArrivedIds, ...ids]);
		setTimeout(() => {
			const cleaned = new Set(this.newlyArrivedIds);
			for (const id of ids) cleaned.delete(id);
			this.newlyArrivedIds = cleaned;
		}, NEW_HIGHLIGHT_MS);
	}

	/** Merge messages pushed over SSE, newest first. Returns the ids actually added. */
	ingest(items: CommsMessage[]): string[] {
		const existing = new Set(this.messages.map((m) => m.id));
		const fresh = items.filter((m) => !existing.has(m.id));
		if (fresh.length === 0) return [];
		this.markNew(fresh.map((m) => m.id));
		this.messages = [...fresh, ...this.messages];

		const sel = this.selectedMessageId;
		if (sel && fresh.some((m) => m.thread_root_id === sel || m.in_reply_to === sel || m.id === sel)) {
			this.selectMessage(sel);
		}
		return fresh.map((m) => m.id);
	}

	private async publish(payload: Record<string, unknown>): Promise<CommsMessage | null> {
		const res = await fetch('/api/publish', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || `Publish failed (${res.status})`);
		}
		const json = await res.json();
		return json.message ?? null;
	}

	async sendReply() {
		const target = this.selectedMessage;
		if (!target || !this.replyBody.trim() || this.isReplying) return;
		this.isReplying = true;
		this.error = null;
		try {
			const msg = await this.publish({
				replyTo: target.id,
				author: this.replyAuthor || undefined,
				body: this.replyBody.trim()
			});
			this.replyBody = '';
			if (msg?.id) this.markNew([msg.id]);
			await this.loadData(false);
			if (this.selectedMessageId) await this.selectMessage(this.selectedMessageId);
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Error sending reply';
		} finally {
			this.isReplying = false;
		}
	}

	async submitCompose() {
		if (!this.composeBody.trim() || this.isComposing) return;
		this.isComposing = true;
		this.error = null;
		try {
			const payload: Record<string, unknown> = {
				title: this.composeTitle.trim() || 'Untitled',
				body: this.composeBody.trim(),
				author: this.replyAuthor || undefined
			};
			if (this.composeType === 'topic') payload.topic = this.composeTopic;
			else payload.directAgent = this.composeRecipient.replace(/^@/, '');

			const msg = await this.publish(payload);
			this.composeBody = '';
			this.composeTitle = '';
			this.showComposeModal = false;
			if (msg?.id) this.markNew([msg.id]);
			await this.loadData(false);
			if (msg?.id) this.selectedMessageId = msg.id;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Error publishing message';
		} finally {
			this.isComposing = false;
		}
	}

	// ---- Live connection --------------------------------------------------

	/** Open the SSE stream and the relative-time ticker. Returns a cleanup fn. */
	connect(): () => void {
		const ticker = setInterval(() => (this.now = Date.now()), TIME_TICK_MS);

		let source: EventSource | null = null;
		try {
			source = new EventSource('/api/events');
			source.onopen = () => (this.liveConnected = true);
			source.addEventListener('connected', () => (this.liveConnected = true));
			source.addEventListener('new_messages', (evt) => {
				try {
					const data = JSON.parse((evt as MessageEvent).data);
					if (Array.isArray(data.items)) this.ingest(data.items);
				} catch (err) {
					console.error('Failed to parse SSE payload', err);
				}
			});
			source.onerror = () => (this.liveConnected = false);
		} catch (err) {
			console.warn('SSE not supported or failed to connect', err);
		}

		return () => {
			source?.close();
			clearInterval(ticker);
		};
	}
}

export const comms = new CommsStore();
