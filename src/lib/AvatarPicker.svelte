<script lang="ts">
	import { Settings2, X } from '@lucide/svelte';
	import type { AvatarInputDescriptor, AvatarStyle } from '$lib/server/avatars';
	import type { AvatarPreferenceRecord, AvatarPreferenceScope, AvatarRecipe } from '$lib/avatar-preferences';
	let { agentId, sessionRef, size = 88 }: { agentId: string; sessionRef?: string; size?: number } = $props();
	let open = $state(false), saving = $state(false), revision = $state(0);
	let styles = $state<AvatarStyle[]>([]), records = $state<AvatarPreferenceRecord[]>([]);
	let recipe = $state<AvatarRecipe>({ style: 'gorey' }), source = $state('fallback');
	let scope = $state<AvatarPreferenceScope>('agent');
	const imageUrl = $derived(`/api/avatars/image?agent_id=${encodeURIComponent(agentId)}${sessionRef ? `&session_ref=${encodeURIComponent(sessionRef)}` : ''}&v=${revision}`);
	const selectedStyle = $derived(styles.find((style) => style.id === recipe.style));
	async function load() { const q = new URLSearchParams({ agent_id: agentId }); if (sessionRef) q.set('session_ref', sessionRef); const response = await fetch(`/api/avatars?${q}`); if (!response.ok) return; const data = await response.json(); styles = data.styles || []; records = data.records || []; recipe = data.recipe; source = data.source; }
	function preview(style: AvatarStyle) { recipe = { style: style.id, inputs: Object.fromEntries(Object.entries(style.inputs || {}).map(([name, descriptor]) => [name, descriptor.default])) }; }
	function previewUrl(style: AvatarStyle) { const q = new URLSearchParams({ agent_id: agentId, preview_style: style.id }); for (const [name, descriptor] of Object.entries(style.inputs || {})) q.set(`input.${name}`, descriptor.default); return `/api/avatars/image?${q}`; }
	function key() { return scope === 'default' ? undefined : scope === 'agent' ? agentId : sessionRef; }
	function hasOverride() { const recordKey = scope === 'default' ? 'global' : scope === 'session' ? `${agentId}:${sessionRef}` : key(); return records.some((record) => record.scope === scope && record.key === recordKey && record.recipe); }
	async function save() { saving = true; await fetch('/api/avatars', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, key: key(), agent_id: agentId, recipe }) }); await load(); revision++; saving = false; }
	async function reset() { const q = new URLSearchParams({ scope, agent_id: agentId }); if (key()) q.set('key', key()!); await fetch(`/api/avatars?${q}`, { method: 'DELETE' }); await load(); revision++; }
	function setInput(name: string, event: Event) { recipe = { ...recipe, inputs: { ...(recipe.inputs || {}), [name]: (event.currentTarget as HTMLSelectElement).value } }; }
</script>
<span class="picker" style:width={`${size}px`} style:height={`${size}px`}>
	<img src={imageUrl} alt="" />
	<button class="open" onclick={(e) => { e.stopPropagation(); open = true; void load(); }} aria-label="Choose avatar style"><Settings2 size={17} /></button>
	{#if open}<div class="backdrop" role="presentation" onclick={(e) => { e.stopPropagation(); open = false; }}></div>
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role, a11y_click_events_have_key_events -->
	<section class="flyout" role="dialog" aria-label="Avatar style" onclick={(e) => e.stopPropagation()}>
		<header><div><strong>Avatar</strong><small>{source === 'fallback' ? 'Gorey default' : `Inherited from ${source}`}</small></div><button onclick={() => open = false} aria-label="Close"><X size={15} /></button></header>
		<label>Apply to<select bind:value={scope}><option value="default">Everyone by default</option><option value="agent">This agent</option>{#if sessionRef}<option value="session">This session</option>{/if}</select></label>
		<div class="styles">{#each styles as style (style.id)}<button class:selected={recipe.style === style.id} onclick={() => preview(style)} title={style.name}><img src={previewUrl(style)} alt="" /><span>{style.name}</span></button>{/each}</div>
		{#each Object.entries(selectedStyle?.inputs || {}) as [name, descriptor]}<label>{name}<select value={recipe.inputs?.[name] || (descriptor as AvatarInputDescriptor).default} onchange={(event) => setInput(name, event)}>{#each (descriptor as AvatarInputDescriptor).values as option}<option value={option.value}>{option.label}</option>{/each}</select></label>{/each}
		<footer>{#if hasOverride()}<button class="reset" onclick={reset}>Use inherited</button>{/if}<button class="save" disabled={saving || (scope === 'session' && !sessionRef)} onclick={save}>{saving ? 'Saving…' : 'Save'}</button></footer>
	</section>{/if}
</span>
<style>
	.picker{display:inline-block;flex-shrink:0;position:relative;border:1px solid #bbb49a55;background:#d6d0bb;border-radius:50%}.picker>img{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover}.open{position:absolute;inset:0;border-radius:50%;opacity:0;background:#24231db8;color:#fff;display:grid;place-items:center}.picker:hover>.open,.open:focus-visible{opacity:1}.backdrop{position:fixed;inset:0;z-index:90}.flyout{position:absolute;z-index:91;top:calc(100% + 8px);left:0;width:280px;padding:12px;background:var(--bg-sidebar);border:1px solid var(--border-default);box-shadow:0 12px 36px #0005;color:var(--text-primary)}header,footer{display:flex;align-items:center;justify-content:space-between;gap:8px}header{margin-bottom:12px}header div{display:flex;flex-direction:column}small{color:var(--text-muted);font-size:10px}label{display:grid;gap:4px;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em}select{background:var(--bg-app);color:var(--text-primary);border:1px solid var(--border-default);padding:6px;font-size:11px}.styles{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:10px 0}.styles button{border:1px solid var(--border-subtle);padding:4px;color:var(--text-secondary);font-size:9px;overflow:hidden}.styles button.selected{border-color:var(--accent-default);color:var(--accent-default)}.styles img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:50%;display:block;margin-bottom:3px}footer{margin-top:12px;justify-content:flex-end}.save,.reset{padding:5px 9px;border:1px solid var(--border-default);font-size:11px}.save{background:var(--accent-default);color:#201e18}.reset{margin-right:auto;color:var(--text-muted)}
</style>
