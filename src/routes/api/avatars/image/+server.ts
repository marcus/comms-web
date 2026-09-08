import type { RequestHandler } from './$types';
import { resolveAvatarRecipe } from '$lib/avatar-preferences';
import { readAvatarPreferences } from '$lib/server/avatar-preferences';
import { renderAvatar } from '$lib/server/avatars';

export const GET: RequestHandler = async ({ url }) => {
	const agentId = url.searchParams.get('agent_id') || '';
	if (!agentId) return new Response('agent_id is required', { status: 400 });
	const sessionRef = url.searchParams.get('session_ref') || undefined;
	const resolved = resolveAvatarRecipe(await readAvatarPreferences(), agentId, sessionRef);
	const previewStyle = url.searchParams.get('preview_style');
	const recipe = previewStyle ? { style: previewStyle, inputs: Object.fromEntries([...url.searchParams].filter(([key]) => key.startsWith('input.')).map(([key, value]) => [key.slice(6), value])) } : resolved.recipe;
	const source = previewStyle ? 'preview' : resolved.source;
	const rendered = await renderAvatar(agentId, recipe);
	return new Response(rendered.bytes.buffer.slice(rendered.bytes.byteOffset, rendered.bytes.byteOffset + rendered.bytes.byteLength) as ArrayBuffer, { headers: { 'Content-Type': rendered.contentType, 'Cache-Control': 'private, no-cache', 'X-Avatar-Source': source, 'X-Avatar-Fallback': String(rendered.fallback) } });
};
