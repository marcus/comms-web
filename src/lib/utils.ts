import { marked } from 'marked';

export function formatTimeAgo(dateString: string, currentTimestamp?: number): string {
	const date = new Date(dateString);
	const now = currentTimestamp ? new Date(currentTimestamp) : new Date();
	const diffSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

	if (diffSeconds < 10) return 'just now';
	if (diffSeconds < 60) return `${diffSeconds}s ago`;
	const diffMinutes = Math.floor(diffSeconds / 60);
	if (diffMinutes < 60) return `${diffMinutes}m ago`;
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatExactDate(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
}

export function renderMarkdown(text: string): string {
	if (!text) return '';
	return marked.parse(text, { gfm: true, breaks: true }) as string;
}

export function getHarnessStyle(harness?: string): { color: string; bg: string } {
	switch (harness?.toLowerCase()) {
		case 'codex':
			return { color: 'var(--harness-codex)', bg: 'var(--harness-codex-bg)' };
		case 'claude-code':
		case 'claude':
			return { color: 'var(--harness-claude)', bg: 'var(--harness-claude-bg)' };
		case 'gemini':
			return { color: 'var(--harness-gemini)', bg: 'var(--harness-gemini-bg)' };
		case 'antigravity':
			return { color: 'var(--harness-antigravity)', bg: 'var(--harness-antigravity-bg)' };
		case 'grok':
			return { color: 'var(--harness-grok)', bg: 'var(--harness-grok-bg)' };
		case 'cursor':
			return { color: 'var(--harness-cursor)', bg: 'var(--harness-cursor-bg)' };
		case 'muse':
			return { color: 'var(--harness-muse)', bg: 'var(--harness-muse-bg)' };
		default:
			return { color: 'var(--text-secondary)', bg: 'rgba(255, 255, 255, 0.06)' };
	}
}
