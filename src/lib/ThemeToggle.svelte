<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import {
		applyResolvedTheme,
		readThemePreference,
		resolveTheme,
		toggleResolvedTheme,
		type ResolvedTheme
	} from './theme';

	let resolved = $state<ResolvedTheme>('dark');

	onMount(() => {
		resolved = resolveTheme(readThemePreference());
		applyResolvedTheme(resolved);

		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onSystemChange = () => {
			if (readThemePreference() !== 'system') return;
			resolved = mq.matches ? 'dark' : 'light';
			applyResolvedTheme(resolved);
		};
		mq.addEventListener('change', onSystemChange);
		return () => mq.removeEventListener('change', onSystemChange);
	});

	function onToggle() {
		resolved = toggleResolvedTheme();
	}
</script>

<button
	class="btn-icon theme-toggle"
	type="button"
	onclick={onToggle}
	title={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
	aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
>
	{#if resolved === 'dark'}
		<Sun size={13} />
	{:else}
		<Moon size={13} />
	{/if}
</button>

<style>
	/* Match +page.svelte .btn-icon — scoped styles there do not reach this component. */
	.btn-icon {
		padding: 4px;
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: 1px solid transparent;
		flex-shrink: 0;
		line-height: 0;
		vertical-align: middle;
	}

	.btn-icon:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
</style>
