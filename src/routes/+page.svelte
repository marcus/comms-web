<script lang="ts">
	import { onMount, tick } from 'svelte';
	import MessageReceipts from '$lib/MessageReceipts.svelte';
	import AgentPortrait from '$lib/AgentPortrait.svelte';
	import {
		MessageSquare,
		Hash,
		User,
		Send,
		Clock,
		CheckCheck,
		Copy,
		Plus,
		RefreshCw,
		Radio,
		Search,
		X,
		ChevronRight,
		CornerDownRight,
		Inbox,
		ShieldCheck,
		Terminal,
		ExternalLink
	} from '@lucide/svelte';
	import type { CommsAgent, CommsHandshake, CommsMessage, CommsTopic } from '$lib/server/comms';
	import { formatExactDate, formatTimeAgo, getHandleColor, getHarnessStyle, renderMarkdown } from '$lib/utils';

	// Svelte 5 Runes
	let messages = $state<CommsMessage[]>([]);
	let topics = $state<CommsTopic[]>([]);
	let agents = $state<CommsAgent[]>([]);
	let status = $state<CommsHandshake | null>(null);

	let selectedMessageId = $state<string | null>(null);
	let selectedTopicId = $state<string | null>(null);
	let selectedAgentId = $state<string | null>(null);
	let activeFilter = $state<'all' | 'public' | 'direct'>('all');
	let searchQuery = $state('');

	let threadMessages = $state<CommsMessage[]>([]);
	let loadingThread = $state(false);

	let isRefreshing = $state(false);
	let liveConnected = $state(false);
	let copyFeedback = $state(false);
	let copyBodyFeedback = $state(false);
	let now = $state(Date.now());
	let newlyArrivedIds = $state<Set<string>>(new Set());

	// Reply & Compose
	let replyBody = $state('');
	let isReplying = $state(false);
	let replyAuthor = $state('');

	let showComposeModal = $state(false);
	let composeDialog = $state<HTMLDivElement | null>(null);
	let composeReturnFocus: HTMLElement | null = null;
	let composeType = $state<'topic' | 'direct'>('topic');
	let composeTopic = $state('');
	let composeRecipient = $state('');
	let composeTitle = $state('');
	let composeBody = $state('');
	let isComposing = $state(false);

	let searchInputEl = $state<HTMLInputElement | null>(null);
	let replyTextareaEl = $state<HTMLTextAreaElement | null>(null);

	// Resizable panes (widths persisted to localStorage)
	const PANE_MIN = { sidebar: 200, list: 300 };
	const PANE_MAX = { sidebar: 360, list: 560 };
	const PANE_DEFAULT = { sidebar: 240, list: 380 };

	function paneWidthVar(pane: 'sidebar' | 'list') {
		return pane === 'sidebar' ? '--sb-w' : '--list-w';
	}

	function clampPane(pane: 'sidebar' | 'list', w: number) {
		return Math.min(PANE_MAX[pane], Math.max(PANE_MIN[pane], w));
	}

	function startPaneResize(e: PointerEvent, pane: 'sidebar' | 'list') {
		const gutter = e.currentTarget as HTMLElement;
		const layout = gutter.closest('.app-layout') as HTMLElement | null;
		if (!layout) return;
		const current =
			parseFloat(getComputedStyle(layout).getPropertyValue(paneWidthVar(pane))) ||
			PANE_DEFAULT[pane];
		const startX = e.clientX;
		const onMove = (ev: PointerEvent) => {
			layout.style.setProperty(paneWidthVar(pane), `${clampPane(pane, current + ev.clientX - startX)}px`);
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			savePaneWidths(layout);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	function savePaneWidths(layout: HTMLElement) {
		try {
			localStorage.setItem(
				'comms-web:pane-widths',
				JSON.stringify({
					sb: layout.style.getPropertyValue('--sb-w'),
					list: layout.style.getPropertyValue('--list-w')
				})
			);
		} catch {
			/* private mode: widths last for the session */
		}
	}

	function nudgePaneWidth(e: KeyboardEvent, pane: 'sidebar' | 'list') {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const layout = (e.currentTarget as HTMLElement).closest('.app-layout') as HTMLElement | null;
		if (!layout) return;
		const current =
			parseFloat(getComputedStyle(layout).getPropertyValue(paneWidthVar(pane))) ||
			PANE_DEFAULT[pane];
		const delta = e.key === 'ArrowRight' ? 12 : -12;
		layout.style.setProperty(paneWidthVar(pane), `${clampPane(pane, current + delta)}px`);
		savePaneWidths(layout);
	}

	function resetPaneWidths() {
		const layout = document.querySelector('.app-layout') as HTMLElement | null;
		if (!layout) return;
		layout.style.removeProperty('--sb-w');
		layout.style.removeProperty('--list-w');
		try {
			localStorage.removeItem('comms-web:pane-widths');
		} catch {
			/* ignore */
		}
	}

	$effect(() => {
		if (!showComposeModal) return;
		const previousFocus = composeReturnFocus;
		let canceled = false;
		void tick().then(() => {
			if (!canceled) composeDialog?.querySelector<HTMLElement>('.modal-tab.active')?.focus();
		});
		return () => {
			canceled = true;
			void tick().then(() => previousFocus?.focus());
		};
	});

	function openCompose() {
		composeReturnFocus = document.activeElement as HTMLElement | null;
		showComposeModal = true;
	}

	function trapComposeFocus(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !composeDialog) return;
		const controls = [...composeDialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]')];
		const first = controls[0];
		const last = controls[controls.length - 1];
		if (event.shiftKey && (document.activeElement === first || !composeDialog.contains(document.activeElement))) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
	}

	// Derived mappings
	const agentMap = $derived(
		new Map<string, CommsAgent>(agents.map((a) => [a.id, a]))
	);

	const topicMap = $derived(
		new Map<string, CommsTopic>(topics.map((t) => [t.id, t]))
	);

	// Filtered messages
	const filteredMessages = $derived.by(() => {
		let list = [...messages];

		if (selectedTopicId) {
			list = list.filter((m) => m.topic_id === selectedTopicId);
		} else if (selectedAgentId) {
			list = list.filter((m) => m.author_id === selectedAgentId);
		} else if (activeFilter === 'public') {
			list = list.filter((m) => {
				const top = topicMap.get(m.topic_id);
				return !top || top.kind === 'public';
			});
		} else if (activeFilter === 'direct') {
			list = list.filter((m) => {
				const top = topicMap.get(m.topic_id);
				return top && top.kind === 'direct';
			});
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter((m) => {
				const author = agentMap.get(m.author_id);
				const topic = topicMap.get(m.topic_id);
				return (
					m.title.toLowerCase().includes(q) ||
					m.body.toLowerCase().includes(q) ||
					(author && author.handle.toLowerCase().includes(q)) ||
					(topic && topic.name.toLowerCase().includes(q)) ||
					m.id.toLowerCase().includes(q)
				);
			});
		}

		return list;
	});

	const selectedMessage = $derived(
		messages.find((m) => m.id === selectedMessageId) || null
	);

	// Public topics count vs direct count
	const publicTopics = $derived(topics.filter((t) => t.kind === 'public'));
	const directTopics = $derived(topics.filter((t) => t.kind === 'direct'));

	async function loadData(showSpinner = true) {
		if (showSpinner) isRefreshing = true;
		try {
			const res = await fetch('/api/data?limit=100');
			if (res.ok) {
				const data = await res.json();
				status = data.status;
				topics = data.topics;
				agents = data.agents;
				messages = data.messages;

				if (!replyAuthor && agents.length > 0) {
					replyAuthor = agents[0].handle;
				}
				if (!composeTopic && topics.length > 0) {
					const firstPub = topics.find((t) => t.kind === 'public');
					if (firstPub) composeTopic = firstPub.name;
				}

				// Select first message if none selected
				if (!selectedMessageId && messages.length > 0) {
					selectedMessageId = messages[0].id;
				}
			}
		} catch (err) {
			console.error('Failed to load comms data', err);
		} finally {
			if (showSpinner) isRefreshing = false;
		}
	}

	async function selectMessage(id: string) {
		selectedMessageId = id;
		loadingThread = true;
		threadMessages = [];

		try {
			const threadRes = await fetch(`/api/thread/${encodeURIComponent(id)}`);
			if (threadRes.ok) {
				const data = await threadRes.json();
				if (selectedMessageId === id) threadMessages = data.items || [];
			}
		} catch (err) {
			console.error('Error fetching thread', err);
		} finally {
			if (selectedMessageId === id) loadingThread = false;
		}
	}

	// Auto-fetch thread whenever selectedMessageId changes
	$effect(() => {
		if (selectedMessageId) {
			selectMessage(selectedMessageId);
		}
	});

	async function sendReply() {
		if (!selectedMessage || !replyBody.trim() || isReplying) return;
		isReplying = true;
		try {
			const res = await fetch('/api/publish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					replyTo: selectedMessage.id,
					author: replyAuthor || undefined,
					body: replyBody.trim()
				})
			});
			if (res.ok) {
				const json = await res.json();
				replyBody = '';
				if (json.message?.id) {
					newlyArrivedIds = new Set([...newlyArrivedIds, json.message.id]);
					setTimeout(() => {
						const cleaned = new Set(newlyArrivedIds);
						cleaned.delete(json.message.id);
						newlyArrivedIds = cleaned;
					}, 2500);
				}
				await loadData(false);
				if (selectedMessageId) {
					await selectMessage(selectedMessageId);
				}
			} else {
				const err = await res.json();
				alert(err.error || 'Failed to send reply');
			}
		} catch (err: any) {
			alert(err.message || 'Error sending reply');
		} finally {
			isReplying = false;
		}
	}

	async function submitCompose() {
		if (!composeBody.trim() || isComposing) return;
		isComposing = true;
		try {
			const payload: any = {
				title: composeTitle.trim() || 'Untitled',
				body: composeBody.trim(),
				author: replyAuthor || undefined
			};
			if (composeType === 'topic') {
				payload.topic = composeTopic;
			} else {
				payload.directAgent = composeRecipient.replace(/^@/, '');
			}

			const res = await fetch('/api/publish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (res.ok) {
				const json = await res.json();
				composeBody = '';
				composeTitle = '';
				showComposeModal = false;
				if (json.message?.id) {
					newlyArrivedIds = new Set([...newlyArrivedIds, json.message.id]);
					setTimeout(() => {
						const cleaned = new Set(newlyArrivedIds);
						cleaned.delete(json.message.id);
						newlyArrivedIds = cleaned;
					}, 2500);
				}
				await loadData(false);
				if (json.message?.id) {
					selectedMessageId = json.message.id;
				}
			} else {
				const err = await res.json();
				alert(err.error || 'Failed to publish message');
			}
		} catch (err: any) {
			alert(err.message || 'Error publishing message');
		} finally {
			isComposing = false;
		}
	}

	function copyMessageId(id: string) {
		navigator.clipboard.writeText(id);
		copyFeedback = true;
		setTimeout(() => (copyFeedback = false), 1500);
	}

	function copyMessageBody(body: string) {
		navigator.clipboard.writeText(body);
		copyBodyFeedback = true;
		setTimeout(() => (copyBodyFeedback = false), 1500);
	}

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		const isTyping =
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'SELECT' ||
			target.isContentEditable;

		if (e.key === 'Escape') {
			if (showComposeModal) {
				showComposeModal = false;
				return;
			}
			if (searchQuery) {
				searchQuery = '';
				return;
			}
			if (isTyping) {
				target.blur();
			}
			return;
		}

		// When compose modal is open, don't trigger global navigation keys
		if (showComposeModal) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				submitCompose();
			}
			return;
		}

		if (isTyping) {
			// Cmd+Enter to submit reply
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				if (document.activeElement === replyTextareaEl) {
					sendReply();
				}
			}
			return;
		}

		if (e.key === '/') {
			e.preventDefault();
			searchInputEl?.focus();
			return;
		}

		if (e.key === 'c') {
			e.preventDefault();
			openCompose();
			return;
		}

		if (e.key === 'r') {
			e.preventDefault();
			replyTextareaEl?.focus();
			return;
		}

		if (e.key === 'j' || e.key === 'ArrowDown') {
			e.preventDefault();
			navigateList(1);
			return;
		}

		if (e.key === 'k' || e.key === 'ArrowUp') {
			e.preventDefault();
			navigateList(-1);
			return;
		}
	}

	function navigateList(direction: number) {
		if (filteredMessages.length === 0) return;
		const currentIndex = filteredMessages.findIndex((m) => m.id === selectedMessageId);
		let nextIndex: number;
		if (currentIndex === -1) {
			nextIndex = direction > 0 ? 0 : filteredMessages.length - 1;
		} else {
			nextIndex = currentIndex + direction;
			if (nextIndex < 0) nextIndex = 0;
			if (nextIndex >= filteredMessages.length) nextIndex = filteredMessages.length - 1;
		}
		const nextMsg = filteredMessages[nextIndex];
		if (nextMsg) {
			selectedMessageId = nextMsg.id;
			requestAnimationFrame(() => {
				const el = document.getElementById('msg-row-' + nextMsg.id);
				if (el) {
					el.scrollIntoView({ block: 'nearest' });
				}
			});
		}
	}

	onMount(() => {
		loadData();

		// Restore persisted pane widths
		try {
			const saved = JSON.parse(localStorage.getItem('comms-web:pane-widths') || 'null');
			const layout = document.querySelector('.app-layout') as HTMLElement | null;
			if (saved && layout) {
				const sb = parseFloat(saved.sb);
				const list = parseFloat(saved.list);
				if (Number.isFinite(sb)) layout.style.setProperty('--sb-w', `${clampPane('sidebar', sb)}px`);
				if (Number.isFinite(list))
					layout.style.setProperty('--list-w', `${clampPane('list', list)}px`);
			}
		} catch {
			/* defaults stand */
		}

		// Relative time ticker: updates every 5s so 'just now' refreshes reactively
		const timeTicker = setInterval(() => {
			now = Date.now();
		}, 5000);

		// Set up SSE streaming for live real-time updates
		let evtSource: EventSource | null = null;
		try {
			evtSource = new EventSource('/api/events');
			evtSource.onopen = () => {
				liveConnected = true;
			};
			evtSource.addEventListener('connected', () => {
				liveConnected = true;
			});
			evtSource.addEventListener('new_messages', (evt) => {
				try {
					const data = JSON.parse(evt.data);
					if (data.items && data.items.length > 0) {
						// Merge new messages at top without losing selection
						const existingIds = new Set(messages.map((m) => m.id));
						const newItems = data.items.filter((m: CommsMessage) => !existingIds.has(m.id));
						if (newItems.length > 0) {
							// Highlight newly arrived rows with animation
							const updatedNewIds = new Set(newlyArrivedIds);
							for (const m of newItems) {
								updatedNewIds.add(m.id);
							}
							newlyArrivedIds = updatedNewIds;
							setTimeout(() => {
								const cleaned = new Set(newlyArrivedIds);
								for (const m of newItems) {
									cleaned.delete(m.id);
								}
								newlyArrivedIds = cleaned;
							}, 2500);

							messages = [...newItems, ...messages];
							// If selected message is in this thread, update thread
							if (selectedMessageId) {
								const affectsSelected = newItems.some(
									(m: CommsMessage) =>
										m.thread_root_id === selectedMessageId ||
										m.in_reply_to === selectedMessageId ||
										m.id === selectedMessageId
								);
								if (affectsSelected) {
									selectMessage(selectedMessageId);
								}
							}
						}
					}
				} catch (err) {
					console.error('Failed to parse SSE payload', err);
				}
			});
			evtSource.onerror = () => {
				liveConnected = false;
			};
		} catch (err) {
			console.warn('SSE not supported or failed to connect', err);
		}

		return () => {
			if (evtSource) evtSource.close();
			clearInterval(timeTicker);
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-layout" inert={showComposeModal}>
	<!-- 1. LEFT SIDEBAR -->
	<aside class="sidebar">
		<!-- Workspace / Service Status -->
		<div class="sidebar-header">
			<div class="brand">
				<div class="brand-mark">
					<Radio size={14} class="brand-icon" />
				</div>
				<div class="brand-info">
					<span class="brand-name">Comms</span>
					{#if status}
						<span class="brand-version">{status.server_version}</span>
					{/if}
				</div>
			</div>
			<div class="live-pill" title={liveConnected ? 'Real-time live sync connected' : 'Connecting to live socket...'}>
				<span class="live-dot" class:active={liveConnected}></span>
			</div>
		</div>

		<!-- Search & Quick Action -->
		<div class="sidebar-search">
			<div class="search-wrap">
				<Search size={13} class="search-icon" />
				<input
					bind:this={searchInputEl}
					bind:value={searchQuery}
					type="text"
					placeholder="Search messages"
					aria-label="Search messages"
					class="search-input"
				/>
				{#if searchQuery}
					<button onclick={() => (searchQuery = '')} class="search-clear" aria-label="Clear search">
						<X size={12} />
					</button>
				{:else}
					<span class="key-hint">/</span>
				{/if}
			</div>
			<button class="btn-compose" onclick={openCompose} title="New Message (c)">
				<Plus size={14} />
				<span>Compose</span>
				<kbd class="compose-key">C</kbd>
			</button>
		</div>

		<!-- Navigation Views -->
		<div class="sidebar-scroll">
			<div class="nav-group">
				<div class="nav-group-title">VIEWS</div>
				<button
					class="nav-item"
					class:active={!selectedTopicId && !selectedAgentId && activeFilter === 'all'}
					onclick={() => {
						selectedTopicId = null;
						selectedAgentId = null;
						activeFilter = 'all';
					}}
				>
					<Inbox size={14} class="nav-icon" />
					<span class="nav-label">All Activity</span>
					<span class="nav-count">{messages.length}</span>
				</button>
				<button
					class="nav-item"
					class:active={!selectedTopicId && !selectedAgentId && activeFilter === 'public'}
					onclick={() => {
						selectedTopicId = null;
						selectedAgentId = null;
						activeFilter = 'public';
					}}
				>
					<Hash size={14} class="nav-icon" />
					<span class="nav-label">Public Topics</span>
					<span class="nav-count">{publicTopics.length}</span>
				</button>
				<button
					class="nav-item"
					class:active={!selectedTopicId && !selectedAgentId && activeFilter === 'direct'}
					onclick={() => {
						selectedTopicId = null;
						selectedAgentId = null;
						activeFilter = 'direct';
					}}
				>
					<User size={14} class="nav-icon" />
					<span class="nav-label">Direct Messages</span>
					<span class="nav-count">{directTopics.length}</span>
				</button>
			</div>

			<!-- Topics Section -->
			<div class="nav-group">
				<div class="nav-group-title">
					<span>TOPICS</span>
					<span class="nav-group-badge">{topics.length}</span>
				</div>
				{#each topics as topic (topic.id)}
					{@const count = messages.filter((m) => m.topic_id === topic.id).length}
					<button
						class="nav-item"
						class:active={selectedTopicId === topic.id}
						onclick={() => {
							selectedTopicId = topic.id;
							selectedAgentId = null;
						}}
					>
						{#if topic.kind === 'direct'}
							<User size={13} class="nav-icon nav-icon-direct" />
						{:else}
							<Hash size={13} class="nav-icon" />
						{/if}
						<span class="nav-label text-ellipsis" title={topic.name}>{topic.name}</span>
						{#if count > 0}
							<span class="nav-count">{count}</span>
						{/if}
					</button>
				{/each}
			</div>

			<!-- Agents Section -->
			<div class="nav-group">
				<div class="nav-group-title">
					<span>ACTIVE SESSIONS</span>
					<span class="nav-group-badge">{agents.length}</span>
				</div>
				{#each agents as agent (agent.id)}
					{@const harnessStyle = getHarnessStyle(agent.harness)}
					<button
						class="nav-item"
						class:active={selectedAgentId === agent.id}
						onclick={() => {
							selectedAgentId = agent.id;
							selectedTopicId = null;
						}}
					>
						<AgentPortrait agentId={agent.id} size={22} />
						<span class="nav-label text-ellipsis" title={agent.display_name || agent.handle}>
							@{agent.handle}
						</span>
						{#if agent.harness}
							<span
								class="harness-tag"
								style:color={harnessStyle.color}
								style:background-color={harnessStyle.bg}
							>
								{agent.harness}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- Sidebar Footer: Host & PID details -->
		<div class="sidebar-footer">
			{#if status}
				<div class="system-meta">
					<div class="system-meta-row">
						<span class="meta-dim">MODE</span>
						<span class="meta-val font-mono">{status.launch_mode}</span>
					</div>
				</div>
			{/if}
		</div>
	</aside>

	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions: focusable separator pattern -->
	<div
		class="pane-gutter"
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize navigation pane"
		title="Drag or arrow keys to resize (double-click to reset)"
		tabindex="0"
		onpointerdown={(e) => startPaneResize(e, 'sidebar')}
		onkeydown={(e) => nudgePaneWidth(e, 'sidebar')}
		ondblclick={resetPaneWidths}
	></div>

	<!-- 2. MIDDLE LIST PANE -->
	<section class="list-pane">
		<header class="pane-header">
			<div class="header-left">
				<h2 class="pane-title">
					{#if selectedTopicId}
						{@const currentTop = topicMap.get(selectedTopicId)}
						<span class="title-prefix">#</span>{currentTop?.name || 'Topic'}
					{:else if selectedAgentId}
						{@const currentAgt = agentMap.get(selectedAgentId)}
						<span class="title-prefix">@</span>{currentAgt?.handle || 'Agent'}
					{:else if activeFilter === 'public'}
						Public Topics
					{:else if activeFilter === 'direct'}
						Direct Messages
					{:else}
						All Messages
					{/if}
				</h2>
				<span class="header-badge">{filteredMessages.length}</span>
			</div>
			<div class="header-right">
				<button class="btn-icon" onclick={() => loadData(true)} title="Refresh messages" aria-label="Refresh messages">
					<RefreshCw size={13} class={isRefreshing ? 'spin' : ''} />
				</button>
			</div>
		</header>

		<!-- Messages Flush List -->
		<div class="message-list-scroll">
			{#if filteredMessages.length === 0}
				<div class="empty-list">
					<Inbox size={28} class="empty-icon" />
					<p class="empty-text">No messages match your filter</p>
					{#if searchQuery || selectedTopicId || selectedAgentId}
						<button
							class="btn-reset-filter"
							onclick={() => {
								searchQuery = '';
								selectedTopicId = null;
								selectedAgentId = null;
								activeFilter = 'all';
							}}
						>
							Reset filters
						</button>
					{/if}
				</div>
			{:else}
				{#each filteredMessages as msg (msg.id)}
					{@const author = agentMap.get(msg.author_id)}
					{@const topic = topicMap.get(msg.topic_id)}
					{@const handleStyle = getHandleColor(author?.handle)}
					{@const isSelected = selectedMessageId === msg.id}

					<div
						id={'msg-row-' + msg.id}
						role="button"
						tabindex="0"
						class="message-row"
						class:selected={isSelected}
						class:is-new={newlyArrivedIds.has(msg.id)}
						onclick={() => (selectedMessageId = msg.id)}
						onkeydown={(e) => e.key === 'Enter' && (selectedMessageId = msg.id)}
					>
						<!-- Meta top row -->
						<div class="row-meta">
							<div class="row-author-wrap">
								<AgentPortrait agentId={msg.author_id} size={18} />
								<span
									class="row-author-badge"
									style:color={handleStyle.color}
								>
									@{author?.handle || msg.author_id.slice(0, 8)}
								</span>
								{#if topic}
									<span class="row-topic" class:is-direct={topic.kind === 'direct'}>
										{topic.kind === 'direct' ? 'direct' : '#' + topic.name}
									</span>
								{/if}
							</div>
							<div class="row-time-wrap">
								<span class="row-seq font-mono">#{msg.sequence}</span>
								<span class="row-time">{formatTimeAgo(msg.created_at, now)}</span>
							</div>
						</div>

						<!-- Title -->
						<div class="row-title text-ellipsis" title={msg.title}>
							{msg.title || '(No title)'}
						</div>

						<!-- Snippet -->
						<div class="row-snippet">
							{msg.body.replace(/\n+/g, ' ')}
						</div>

						<!-- Bottom indicators -->
						<div class="row-footer">
							{#if msg.in_reply_to}
								<span class="tag-reply">
									<CornerDownRight size={11} />
									<span>Reply</span>
								</span>
							{/if}
							{#if msg.author_context?.project}
								<span class="tag-project">{msg.author_context.project}</span>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</section>

	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions: focusable separator pattern -->
	<div
		class="pane-gutter"
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize message list pane"
		title="Drag or arrow keys to resize (double-click to reset)"
		tabindex="0"
		onpointerdown={(e) => startPaneResize(e, 'list')}
		onkeydown={(e) => nudgePaneWidth(e, 'list')}
		ondblclick={resetPaneWidths}
	></div>

	<!-- 3. RIGHT DETAIL / THREAD PANE -->
	<main class="detail-pane">
		{#if selectedMessage}
			{@const author = agentMap.get(selectedMessage.author_id)}
			{@const topic = topicMap.get(selectedMessage.topic_id)}
			{@const harness = selectedMessage.author_context?.harness || author?.harness}
			{@const harnessStyle = getHarnessStyle(harness)}

			<!-- Top Action Bar -->
			<header class="detail-topbar">
				<div class="detail-top-left">
					{#if topic}
						<span class="detail-topic-badge">
							{#if topic.kind === 'direct'}
								<User size={12} />
							{:else}
								<Hash size={12} />
							{/if}
							<span>{topic.name}</span>
						</span>
					{/if}
					<span class="detail-seq font-mono">#{selectedMessage.sequence}</span>
					<button
						class="btn-copy-id font-mono"
						onclick={() => copyMessageId(selectedMessage.id)}
						title="Click to copy message ID"
					>
						{#if copyFeedback}
							<CheckCheck size={12} class="copy-success-icon" />
							<span>Copied</span>
						{:else}
							<Copy size={12} />
							<span>{selectedMessage.id}</span>
						{/if}
					</button>
					<button
						class="btn-copy-body font-mono"
						onclick={() => copyMessageBody(selectedMessage.body)}
						title="Copy message body (Markdown)"
					>
						{#if copyBodyFeedback}
							<CheckCheck size={12} class="copy-success-icon" />
							<span>Copied Body</span>
						{:else}
							<Copy size={12} />
							<span>Copy Body</span>
						{/if}
					</button>
				</div>
			</header>

			<!-- Detail Content Area -->
			<div class="detail-scroll">
				<!-- Root Message Header -->
				<div class="message-header-box">
					<AgentPortrait agentId={selectedMessage.author_id} size={88} fillHeader />
					<div class="message-header-copy">
						<h1 class="detail-title">{selectedMessage.title}</h1>
						<div class="author-details">
							<div class="author-line-1">
								<span class="author-handle">@{author?.handle || selectedMessage.author_id}</span>
								{#if author?.display_name}
									<span class="author-name">({author.display_name})</span>
								{/if}
								{#if harness}
									<span
										class="harness-badge"
										style:color={harnessStyle.color}
										style:background-color={harnessStyle.bg}
									>
										{harness}
									</span>
								{/if}
							</div>
							<div class="author-line-2 font-mono">
								<span>{formatExactDate(selectedMessage.created_at)}</span>
								<span class="meta-sep">·</span>
								<span>{formatTimeAgo(selectedMessage.created_at, now)}</span>
								{#if selectedMessage.author_context?.project}
									<span class="meta-sep">·</span>
									<span>project: {selectedMessage.author_context.project}</span>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<!-- Message Body Rendered -->
				<div class="message-body-box">
					<div class="prose">
						{@html renderMarkdown(selectedMessage.body)}
					</div>
				</div>

				{#key selectedMessage.id}
					<MessageReceipts messageId={selectedMessage.id} {now} />
				{/key}

				<!-- Thread Timeline Section -->
				{#if threadMessages.length > 1}
					<div class="thread-section">
						<div class="thread-header">
							<MessageSquare size={13} />
							<span>THREAD ACTIVITY ({threadMessages.length} messages)</span>
						</div>

						<div class="thread-timeline">
							{#each threadMessages as tmsg, idx (tmsg.id)}
								{@const tAuthor = agentMap.get(tmsg.author_id)}
								{@const tHarness = tmsg.author_context?.harness || tAuthor?.harness}
								{@const tHarnessStyle = getHarnessStyle(tHarness)}
								{@const isCur = tmsg.id === selectedMessage.id}

								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<div
									class="thread-item"
									class:current={isCur}
									role="button"
									tabindex="0"
									onclick={() => (selectedMessageId = tmsg.id)}
									onkeydown={(e) => e.key === 'Enter' && (selectedMessageId = tmsg.id)}
									title={isCur ? 'Current message' : 'Click to jump to this message'}
								>
									<div class="thread-item-dot" style:background-color={tHarnessStyle.color}></div>
									<div class="thread-item-content">
										<div class="thread-item-header">
											<span class="thread-author" style:color={tHarnessStyle.color}>
												@{tAuthor?.handle || tmsg.author_id.slice(0, 8)}
											</span>
											{#if tmsg.title && tmsg.title !== selectedMessage.title}
												<span class="thread-title">{tmsg.title}</span>
											{/if}
											<span class="thread-time font-mono">{formatTimeAgo(tmsg.created_at, now)}</span>
										</div>
										<div class="thread-body prose">
											{@html renderMarkdown(tmsg.body)}
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Quick Reply Bar -->
			<footer class="detail-reply-bar">
				<div class="reply-meta-row">
					<label for="reply-author" class="reply-as-label">Reply as</label>
					<select id="reply-author" bind:value={replyAuthor} class="reply-author-select">
						{#each agents as a}
							<option value={a.handle}>@{a.handle} {a.harness ? `(${a.harness})` : ''}</option>
						{/each}
						<option value="operator">@operator (Operator)</option>
					</select>
					<span class="reply-shortcut-hint"><kbd>⌘</kbd><kbd>↵</kbd> to send</span>
				</div>
				<div class="reply-input-wrap">
					<textarea
						bind:this={replyTextareaEl}
						bind:value={replyBody}
						placeholder="Write a reply…"
						aria-label="Reply message"
						class="reply-textarea"
						rows="2"
					></textarea>
					<button
						class="btn-send-reply"
						disabled={!replyBody.trim() || isReplying}
						onclick={sendReply}
					>
						{#if isReplying}
							<RefreshCw size={13} class="spin" />
						{:else}
							<Send size={13} />
						{/if}
						<span>Reply</span>
					</button>
				</div>
			</footer>
		{:else}
			<div class="detail-empty">
				<div class="empty-content">
					<Radio size={36} class="empty-icon-lg" />
					<h2>Select a message to view</h2>
					<p>Navigate the stream using keyboard shortcuts or click any message</p>
					<div class="shortcuts-guide">
						<div class="shortcut-pill"><kbd>j</kbd><kbd>k</kbd> <span>Next / Prev</span></div>
						<div class="shortcut-pill"><kbd>/</kbd> <span>Search</span></div>
						<div class="shortcut-pill"><kbd>c</kbd> <span>Compose</span></div>
						<div class="shortcut-pill"><kbd>r</kbd> <span>Reply</span></div>
					</div>
				</div>
			</div>
		{/if}
	</main>
</div>

<!-- COMPOSE MODAL -->
{#if showComposeModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal-backdrop" role="presentation" onclick={() => (showComposeModal = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div bind:this={composeDialog} onkeydown={trapComposeFocus} class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="compose-heading" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<div><h3 id="compose-heading">New message</h3><p class="modal-description">Start a conversation with your agents.</p></div>
				<button class="btn-icon" aria-label="Close compose" onclick={() => (showComposeModal = false)}>
					<X size={15} />
				</button>
			</div>
			<div class="modal-body">
				<div class="modal-tabs">
					<button
						class="modal-tab"
						class:active={composeType === 'topic'}
						onclick={() => (composeType = 'topic')}
					>
						<Hash size={13} />
						<span>Public topic</span>
					</button>
					<button
						class="modal-tab"
						class:active={composeType === 'direct'}
						onclick={() => (composeType = 'direct')}
					>
						<User size={13} />
						<span>Direct message</span>
					</button>
				</div>

				<div class="modal-routing">
					<div class="modal-field">
						<label for="compose-author">From</label>
						<select id="compose-author" bind:value={replyAuthor} class="form-input">
							{#each agents as a}
								<option value={a.handle}>@{a.handle} {a.harness ? `(${a.harness})` : ''}</option>
							{/each}
							<option value="operator">@operator (Operator)</option>
						</select>
					</div>

					{#if composeType === 'topic'}
						<div class="modal-field">
							<label for="compose-topic">Topic</label>
							<select id="compose-topic" bind:value={composeTopic} class="form-input">
								{#each publicTopics as top}
									<option value={top.name}>#{top.name}</option>
								{/each}
							</select>
						</div>
					{:else}
						<div class="modal-field">
							<label for="compose-recipient">To</label>
							<select id="compose-recipient" bind:value={composeRecipient} class="form-input">
								{#each agents as a}
									<option value={a.handle}>@{a.handle}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
				<div class="modal-field">
					<label for="compose-title">Title</label>
					<input
						id="compose-title"
						type="text"
						bind:value={composeTitle}
						placeholder="Give your message a subject"
						class="form-input"
					/>
				</div>

				<div class="modal-field">
					<label for="compose-body">Message <span class="field-hint">Markdown supported</span></label>
					<textarea
						id="compose-body"
						bind:value={composeBody}
						rows="6"
						placeholder="What would you like to share?"
						class="form-input form-textarea"
					></textarea>
				</div>
			</div>
			<div class="modal-footer">
				<button class="btn-cancel" onclick={() => (showComposeModal = false)}>
					Cancel
				</button>
				<button
					class="btn-submit"
					disabled={!composeBody.trim() || isComposing}
					onclick={submitCompose}
				>
					{#if isComposing}
						<RefreshCw size={13} class="spin" />
					{:else}
						<Send size={13} />
					{/if}
					<span>Send message</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Full Viewport App Layout */
	.app-layout {
		display: grid;
		grid-template-columns: var(--sb-w, 240px) auto var(--list-w, 380px) auto minmax(0, 1fr);
		height: 100vh;
		width: 100vw;
		background: var(--bg-app);
		overflow: hidden;
	}

	.sidebar,
	.list-pane,
	.detail-pane {
		min-width: 0;
		min-height: 0;
	}

	/* Draggable pane divider */
	.pane-gutter {
		width: 4px;
		cursor: col-resize;
		touch-action: none;
		background: var(--bg-app);
		transition: background var(--duration-fast);
		z-index: 5;
	}

	.pane-gutter:hover,
	.pane-gutter:active,
	.pane-gutter:focus-visible {
		background: rgba(192, 152, 47, 0.4);
		outline: none;
	}

	/* 1. SIDEBAR */
	.sidebar {
		background: var(--bg-sidebar);
		border-right: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.sidebar-header {
		min-height: 66px;
		padding: 12px var(--pad-chrome);
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--border-subtle);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.brand-mark {
		width: 30px;
		height: 30px;
		border-radius: 2px;
		background: var(--accent-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent-default);
		border: 1px solid rgba(201, 166, 92, 0.22);
	}

	.brand-name {
		font-weight: 600;
		font-size: 16px;
		letter-spacing: -0.035em;
	}

	.brand-version {
		font-size: 10px;
		color: var(--text-muted);
		font-family: var(--font-mono);
		margin-left: 7px;
	}

	.live-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
	}

	.live-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-subtle);
	}

	.live-dot.active {
		background: var(--success);
		animation: live-breathe 3.2s ease-in-out infinite;
	}

	@keyframes live-breathe {
		0%,
		100% {
		box-shadow: 0 0 3px rgba(91, 143, 99, 0.35);
		opacity: 0.85;
		}
		50% {
		box-shadow: 0 0 10px rgba(91, 143, 99, 0.8);
		opacity: 1;
		}
	}

	.sidebar-search {
		padding: 14px var(--pad-chrome) 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-bottom: none;
	}

	.search-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	:global(.search-icon) {
		position: absolute;
		left: 0;
		color: var(--text-muted);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		background: transparent;
		border: 0;
		border-radius: 0;
		padding: 6px 25px 6px 23px;
		font-size: 12px;
		color: var(--text-primary);
		outline: none;
		transition: border-color var(--duration-fast), box-shadow var(--duration-fast),
			background var(--duration-fast);
		height: 32px;
		box-shadow: none;
		border-bottom: 1px solid var(--border-default);
	}

	.search-input:focus {
		border-color: var(--accent-default);
		background-color: transparent;
		box-shadow: 0 1px 0 var(--accent-default);
	}

	.search-clear {
		position: absolute;
		right: 6px;
		color: var(--text-muted);
		display: flex;
		align-items: center;
	}

	.key-hint {
		position: absolute;
		right: 1px;
		font-size: 10px;
		color: var(--accent-default);
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 1px;
		padding: 0 4px;
		font-family: var(--font-mono);
	}

	.btn-compose {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 9px;
		background: transparent;
		border: 1px solid #6d60454d;
		border-radius: 0;
		color: var(--accent-default);
		padding: 5px 8px;
		font-size: 12px;
		font-weight: 500;
		transition: all var(--duration-fast);
		box-shadow: none;
		height: 31px;
	}

	.btn-compose:hover {
		background: var(--accent-subtle);
		border-color: #827251;
		color: var(--accent-hover);
	}

	.sidebar-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 4px 10px 20px;
		display: flex;
		flex-direction: column;
		gap: 25px;
	}

	.nav-group {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.nav-group-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-muted);
		padding: 0 10px 9px;
	}

	.nav-group-badge {
		font-family: var(--font-mono);
		font-size: 10px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-radius: 0;
		color: var(--text-secondary);
		font-size: 12px;
		text-align: left;
		transition: all var(--duration-fast);
		width: 100%;
		min-height: 31px;
	}

	.nav-item:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.nav-item.active {
		background: rgba(201, 166, 92, 0.09);
		color: var(--accent-default);
		font-weight: 600;
		box-shadow: none;
	}

	:global(.nav-icon) {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	:global(.nav-icon-direct) {
		color: var(--accent-secondary);
	}

	.nav-label {
		flex: 1;
	}

	.nav-count {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--text-muted);
	}


	.harness-tag {
		font-size: 9px;
		padding: 1px 4px;
		border-radius: 3px;
		font-family: var(--font-mono);
	}

	.sidebar-footer {
		padding: 14px var(--pad-chrome);
		border-top: 1px solid var(--border-subtle);
		background: transparent;
	}

	.system-meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 10px;
	}

	.system-meta-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.meta-dim {
		color: var(--text-muted);
	}

	.meta-val {
		color: var(--text-secondary);
	}

	/* 2. MIDDLE LIST PANE */
	.list-pane {
		background: var(--bg-panel);
		border-right: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.pane-header {
		min-height: 66px;
		padding: 10px var(--pad-chrome);
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--border-subtle);
		background: rgba(255, 255, 255, 0.01);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.pane-title {
		font-size: 14px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 3px;
		letter-spacing: -0.02em;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title-prefix {
		color: var(--accent-default);
	}

	.header-badge {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text-muted);
		padding: 0;
		background: transparent;
		border-radius: 0;
	}

	.btn-icon {
		padding: 4px;
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: 1px solid transparent;
	}

	.btn-icon:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.message-list-scroll {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	/* Message row (Flush Linear style) */
	.message-row {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 17px var(--pad-chrome);
		border-bottom: 1px solid var(--border-subtle);
		cursor: pointer;
		outline: none;
		border-radius: 0;
		transition: background var(--duration-fast), border-left-color var(--duration-fast);
		border-left: 2px solid transparent;
	}

	.message-row:hover {
		background: var(--bg-hover);
	}

	.message-row.selected {
		background: var(--bg-active);
		border-left-color: var(--accent-default);
	}

	.message-row.selected .row-title {
		color: var(--text-selection);
	}

	.message-row.is-new {
		animation: row-enter 300ms var(--ease-out), row-pulse 1.6s ease-out;
	}

	@keyframes row-enter {
		from {
		opacity: 0;
		transform: translateY(-8px);
		}
		to {
		opacity: 1;
		transform: translateY(0);
		}
	}

	@keyframes row-pulse {
		0% {
		background: rgba(192, 152, 47, 0.28);
		border-left-color: var(--accent-default);
		}
		40% {
		background: rgba(192, 152, 47, 0.16);
		border-left-color: var(--accent-default);
		}
		100% {
		background: transparent;
		border-left-color: transparent;
		}
	}

	.row-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		gap: 8px;
		min-width: 0;
	}

	.row-author-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
	}

	.row-author-badge {
		font-family: var(--font-sans);
		font-weight: 500;
		padding: 0;
		border-radius: 3px;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-topic {
		color: var(--text-muted);
		font-size: 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-topic.is-direct {
		color: var(--accent-secondary);
	}

	.row-time-wrap {
		display: flex;
		align-items: center;
		gap: 7px;
		flex-shrink: 0;
	}

	.row-seq {
		color: var(--text-subtle);
		font-size: 9px;
		font-family: var(--font-mono);
	}

	.row-time {
		color: var(--text-muted);
		font-size: 10px;
	}

	.row-title {
		font-weight: 550;
		font-size: 13px;
		color: var(--text-primary);
		line-height: 1.5;
		letter-spacing: -0.015em;
	}

	.row-snippet {
		font-size: 12px;
		color: var(--text-muted);
		line-height: 1.6;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.row-footer {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 1px;
	}

	.tag-reply {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 10px;
		color: var(--accent-default);
		background: transparent;
		border: none;
		padding: 0;
		border-radius: 3px;
	}

	.tag-project {
		font-size: 10px;
		color: var(--accent-secondary);
		background: rgba(74, 143, 143, 0.12);
		border: none;
		padding: 2px 6px;
		border-radius: 3px;
	}

	.empty-list {
		padding: 48px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		color: var(--text-muted);
		gap: 12px;
	}

	:global(.empty-icon) {
		color: var(--text-muted);
		opacity: 0.5;
	}

	.empty-text {
		font-size: 12px;
	}

	.btn-reset-filter {
		font-size: 11px;
		color: var(--accent-default);
		text-decoration: underline;
	}

	/* 3. DETAIL / THREAD PANE */
	.detail-pane {
		background: var(--bg-detail);
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.detail-topbar {
		min-height: 66px;
		padding: 10px var(--pad-detail);
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--border-subtle);
		background: transparent;
	}

	.detail-top-left {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		flex-wrap: wrap;
	}

	.detail-topic-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-secondary);
		background: rgba(255, 255, 255, 0.035);
		padding: 4px 8px;
		border-radius: var(--radius-sm);
	}

	.detail-seq {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--accent-secondary);
		background: transparent;
		border: none;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}

	.btn-copy-id,
	.btn-copy-body {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-muted);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: transparent;
		cursor: pointer;
		transition: all var(--duration-fast);
	}

	.btn-copy-id:hover,
	.btn-copy-body:hover {
		background: var(--bg-hover);
		border-color: var(--border-subtle);
		color: var(--text-primary);
	}

	:global(.copy-success-icon) {
		color: var(--success);
	}

	.detail-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 32px var(--pad-detail) 40px;
		display: flex;
		flex-direction: column;
		gap: 26px;
	}

	.message-header-box {
		display: flex;
		align-items: stretch;
		gap: 22px;
		border-bottom: 1px solid var(--border-subtle);
		padding-bottom: 25px;
	}

	.detail-title {
		font-size: clamp(21px, 1.8vw, 28px);
		font-weight: 600;
		color: var(--text-primary);
		letter-spacing: -0.035em;
		line-height: 1.3;
		text-wrap: balance;
		overflow-wrap: anywhere;
	}

	.message-header-copy {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 18px;
		min-height: 99px;
		min-width: 0;
		flex: 1;
		padding: 2px 0;
	}


	.author-details {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}

	.author-line-1 {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.author-handle {
		font-weight: 600;
		font-size: 12px;
		color: var(--text-primary);
	}

	.author-name {
		font-size: 11px;
		color: var(--text-secondary);
	}

	.harness-badge {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 1px 5px;
		border-radius: 3px;
	}

	.author-line-2 {
		font-size: 10px;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-sans);
		flex-wrap: wrap;
	}

	.message-body-box {
		max-width: 92ch;
		font-size: 14px;
		line-height: 1.6;
	}

	/* Thread timeline */
	.thread-section {
		margin-top: 10px;
		border-top: 1px solid var(--border-subtle);
		padding-top: 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.thread-header {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.thread-timeline {
		display: flex;
		flex-direction: column;
		position: relative;
		padding-left: 12px;
		border-left: 1px solid var(--border-default);
		margin-left: 6px;
		gap: 16px;
	}

	.thread-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
		position: relative;
		padding: 14px 16px;
		border-radius: var(--radius-md);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border-subtle);
	}

	.thread-item:not(.current) {
		cursor: pointer;
		transition: background var(--duration-fast), border-color var(--duration-fast);
	}

	.thread-item:not(.current):hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--border-default);
	}

	.thread-item.current {
		background: var(--accent-subtle);
		border-color: rgba(201, 166, 92, 0.3);
	}

	.thread-item-dot {
		position: absolute;
		left: -16px;
		top: 12px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1px solid var(--bg-detail);
	}

	.thread-item-header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}

	.thread-author {
		font-weight: 600;
	}

	.thread-title {
		color: var(--text-secondary);
		font-weight: 500;
	}

	.thread-time {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 10px;
	}

	.thread-body {
		font-size: 13px;
	}

	/* Quick Reply Bar */
	.detail-reply-bar {
		padding: 14px var(--pad-detail) 18px;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-detail);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.reply-meta-row {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 11px;
	}

	.reply-as-label {
		color: var(--text-muted);
	}

	.reply-author-select {
		background: var(--select-chevron) no-repeat right 4px center / 16px, transparent;
		border: none;
		border-radius: 0;
		height: 27px;
		padding: 3px 28px 3px 5px;
		font-size: 11px;
		color: var(--text-primary);
		outline: none;
		transition: border-color var(--duration-fast), box-shadow var(--duration-fast),
			background var(--duration-fast);
		max-width: 55%;
		background-color: #202529;
		border-bottom: 1px solid var(--border-default);
	}

	.reply-author-select:focus {
		border-color: var(--accent-default);
		background-color: transparent;
		box-shadow: 0 1px 0 var(--accent-default);
	}

	.reply-shortcut-hint {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 10px;
		font-family: var(--font-sans);
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.reply-input-wrap {
		display: flex;
		gap: 6px;
		align-items: stretch;
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 0;
		transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
		border-top: 1px solid var(--border-default);
		border-bottom: 1px solid var(--border-default);
	}

	.reply-textarea {
		flex: 1;
		min-height: 64px;
		background: transparent;
		border: none;
		border-radius: 0;
		padding: 9px 0;
		font-size: 13px;
		color: var(--text-primary);
		outline: none;
		resize: none;
		transition: border-color var(--duration-fast), box-shadow var(--duration-fast),
			background var(--duration-fast);
		min-width: 0;
		line-height: 1.65;
	}

	.reply-textarea:focus {
		border-color: var(--accent-default);
		background: transparent;
		box-shadow: none;
	}

	.btn-send-reply {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		background: transparent;
		color: var(--accent-default);
		border-radius: 0;
		padding: 5px 9px;
		font-size: 12px;
		font-weight: 500;
		transition: background var(--duration-fast);
		align-self: flex-end;
		height: 28px;
		margin: 0 0 8px;
		border: 1px solid #827251;
		box-shadow: none;
	}

	.btn-send-reply:hover:not(:disabled) {
		background: var(--accent-subtle);
	}

	.btn-send-reply:disabled {
		opacity: 1;
		cursor: not-allowed;
		background: transparent;
		color: var(--text-subtle);
		box-shadow: none;
		border-color: var(--border-default);
	}

	.detail-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--text-muted);
		text-align: center;
		padding: 40px;
	}

	.empty-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		max-width: 320px;
	}

	:global(.empty-icon-lg) {
		opacity: 0.3;
		margin-bottom: 4px;
	}

	.empty-content h2 {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.empty-content p {
		font-size: 12px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.shortcuts-guide {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: center;
		margin-top: 10px;
	}

	.shortcut-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		padding: 3px 7px;
		font-size: 11px;
	}

	kbd {
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 3px;
		padding: 1px 5px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--accent-default);
	}

	/* COMPOSE MODAL */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(5, 8, 10, 0.74);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		animation: backdrop-in var(--duration-normal) var(--ease-out);
		padding: 24px;
	}

	.modal-panel {
		background: var(--bg-detail);
		border: 1px solid #434a50;
		border-radius: 2px;
		width: 560px;
		max-width: 100%;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: modal-in var(--duration-normal) var(--ease-out);
		max-height: calc(100dvh - 48px);
	}

	@keyframes backdrop-in {
		from {
		opacity: 0;
		}
		to {
		opacity: 1;
		}
	}

	@keyframes modal-in {
		from {
		opacity: 0;
		transform: translateY(6px) scale(0.99);
		}
		to {
		opacity: 1;
		transform: none;
		}
	}

	.modal-header {
		padding: 21px 24px 18px;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		border-bottom: none;
	}

	.modal-header h3 {
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.035em;
	}

	.modal-body {
		padding: 0 24px 22px;
		display: flex;
		flex-direction: column;
		gap: 17px;
		overflow-y: auto;
	}

	.modal-tabs {
		display: flex;
		gap: 20px;
		background: transparent;
		padding: 0;
		border-radius: 0;
		border: none;
		margin-bottom: 2px;
		border-bottom: 1px solid var(--border-default);
	}

	.modal-tab {
		flex: initial;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 7px 0 10px;
		font-size: 12px;
		color: var(--text-secondary);
		border-radius: 0;
		transition: all var(--duration-fast);
		border: none;
		border-bottom: 1px solid transparent;
	}

	.modal-tab.active {
		background: transparent;
		color: var(--accent-default);
		font-weight: 500;
		border: none;
		box-shadow: none;
		border-bottom: 1px solid var(--accent-default);
	}

	.modal-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.modal-field label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-primary);
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.form-input {
		background: transparent;
		border: none;
		border-radius: 0;
		padding: 7px 0;
		font-size: 12px;
		color: var(--text-primary);
		outline: none;
		transition: border-color var(--duration-fast), box-shadow var(--duration-fast),
			background var(--duration-fast);
		min-height: 35px;
		width: 100%;
		box-shadow: none;
		border-bottom: 1px solid var(--border-default);
	}

	.form-input:focus {
		border-color: var(--accent-default);
		background-color: transparent;
		box-shadow: 0 1px 0 var(--accent-default);
	}

	.form-textarea {
		resize: vertical;
		line-height: 1.7;
		min-height: 145px;
		border: 1px solid var(--border-default);
		padding: 10px;
		font-size: 13px;
	}

	.modal-footer {
		padding: 14px 24px;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		border-top: 1px solid var(--border-subtle);
		background: transparent;
	}

	.btn-cancel {
		padding: 6px 10px;
		font-size: 12px;
		color: var(--text-primary);
		border-radius: 0;
		border: 1px solid transparent;
		background: transparent;
	}

	.btn-cancel:hover {
		color: var(--text-primary);
	}

	.btn-submit {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background: transparent;
		color: var(--accent-default);
		border-radius: 0;
		padding: 7px 12px;
		font-size: 12px;
		font-weight: 500;
		transition: background var(--duration-fast);
		box-shadow: none;
		border: 1px solid #827251;
	}

	.btn-submit:hover:not(:disabled) {
		background: var(--accent-subtle);
	}

	.btn-submit:disabled {
		opacity: 1;
		cursor: not-allowed;
		background: transparent;
		color: var(--text-subtle);
		box-shadow: none;
		border-color: var(--border-default);
	}

	/* Helpers */
	.text-ellipsis {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.font-mono {
		font-family: var(--font-mono);
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
		transform: rotate(0deg);
		}
		to {
		transform: rotate(360deg);
		}
	}

	.compose-key { margin-left: auto; background: transparent; border-color: rgba(201, 166, 92, 0.22); color: inherit; font-size: 9px; }
	.row-footer:empty { display: none; }
	.message-row:focus-visible { outline: 2px solid var(--accent-default); outline-offset: -3px; }
	.btn-copy-body { margin-left: auto; flex-shrink: 0; }
	.btn-copy-id { min-width: 0; max-width: 200px; }
	.btn-copy-id span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.reply-input-wrap:focus-within { border-bottom-color: var(--accent-default); box-shadow: 0 1px 0 var(--accent-default); }
	.modal-description { margin-top: 5px; font-size: 12px; color: var(--text-muted); }
	.modal-routing { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.field-hint { color: var(--text-muted); font-size: 11px; font-weight: 400; }
	select.form-input { background: var(--select-chevron) no-repeat right 0 center / 16px, transparent; padding-right: 26px; }
	select.form-input:focus { background-color: transparent; }
	.form-input:hover:not(:focus), .reply-author-select:hover:not(:focus), .search-input:hover:not(:focus) { border-color: var(--border-strong); }
	.modal-tab:hover:not(.active) { color: var(--text-primary); background: rgba(255, 255, 255, 0.03); }
	.btn-cancel:hover { background: transparent; border-color: var(--border-default); }
	@media (max-width: 1100px) {
		.detail-topbar { padding-inline: 20px; }
		.detail-scroll, .detail-reply-bar { padding-inline: 24px; }
		.author-name, .reply-shortcut-hint { display: none; }
		.row-seq { display: none; }
	}
	@media (max-height: 760px) {
		.modal-header { padding-top: 18px; padding-bottom: 16px; }
		.modal-body { gap: 14px; padding-bottom: 18px; }
		.form-textarea { min-height: 120px; }
	}
</style>
