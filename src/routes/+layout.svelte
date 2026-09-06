<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { applyResolvedTheme, readThemePreference, resolveTheme } from '$lib/theme';

	let { children } = $props();

	onMount(() => {
		applyResolvedTheme(resolveTheme(readThemePreference()));
	});
</script>

{@render children()}
