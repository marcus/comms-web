<script lang="ts">
	let { agentId, sessionRef, size = 24, fillHeader = false }: { agentId: string; sessionRef?: string; size?: number; fillHeader?: boolean } = $props();
	const portrait = $derived(`/api/avatars/image?agent_id=${encodeURIComponent(agentId)}${sessionRef ? `&session_ref=${encodeURIComponent(sessionRef)}` : ''}`);
</script>

<span class="agent-portrait" class:fill-header={fillHeader} style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
	<img src={portrait} alt="" />
</span>

<style>
	.agent-portrait {
		display: inline-block;
		flex-shrink: 0;
		overflow: hidden;
		border: 1px solid #bbb49a55;
		background: #d6d0bb;
		border-radius: 50%;
	}
	.agent-portrait img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.fill-header {
		position: relative;
		align-self: center;
	}
	.fill-header img {
		position: absolute;
		inset: 0;
	}
</style>
