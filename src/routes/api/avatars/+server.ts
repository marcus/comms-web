import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveAvatarRecipe, type AvatarPreferenceScope, type AvatarRecipe } from '$lib/avatar-preferences';
import { getAvatarCatalog } from '$lib/server/avatars';
import { readAvatarPreferences, writeAvatarPreference } from '$lib/server/avatar-preferences';
import { mutationIsSameOrigin } from '$lib/server/request-origin';

const scopes = new Set<AvatarPreferenceScope>(['default', 'agent', 'session']);
function target(scope: AvatarPreferenceScope, key?: string, agentId?: string) { return scope === 'default' ? 'global' : scope === 'session' ? `${agentId?.trim() || ''}:${key?.trim() || ''}` : key?.trim() || ''; }

export const GET: RequestHandler = async ({ url }) => {
	const agentId = url.searchParams.get('agent_id') || '';
	const sessionRef = url.searchParams.get('session_ref') || undefined;
	const records = await readAvatarPreferences();
	const effective = resolveAvatarRecipe(records, agentId, sessionRef);
	try { return json({ ...effective, records, ...(await getAvatarCatalog()), available: true }); }
	catch { return json({ ...effective, records, styles: [], formats: ['svg'], available: false }); }
};

export const PUT: RequestHandler = async ({ request, url }) => {
	if (!mutationIsSameOrigin(request, url.origin)) return json({ error: 'Cross-origin avatar changes are not allowed' }, { status: 403 });
	const body = await request.json() as { scope?: AvatarPreferenceScope; key?: string; agent_id?: string; recipe?: AvatarRecipe };
	if (!body || Array.isArray(body) || typeof body !== 'object' || !body.recipe || Array.isArray(body.recipe) || typeof body.recipe !== 'object') return json({ error: 'invalid avatar preference' }, { status: 400 });
	if (!body.scope || !scopes.has(body.scope) || !body.recipe?.style) return json({ error: 'scope and recipe.style are required' }, { status: 400 });
	if (typeof body.recipe.style !== 'string' || body.recipe.style.length > 80 || (body.recipe.inputs && (Array.isArray(body.recipe.inputs) || typeof body.recipe.inputs !== 'object'))) return json({ error: 'invalid avatar recipe' }, { status: 400 });
	if ([body.key, body.agent_id].some((value) => value !== undefined && (typeof value !== 'string' || value.length > 500))) return json({ error: 'invalid preference identity' }, { status: 400 });
	const key = target(body.scope, body.key, body.agent_id);
	if (!key) return json({ error: 'key is required for agent and session scopes' }, { status: 400 });
	const catalog = await getAvatarCatalog();
	const style = catalog.styles.find((item) => item.id === body.recipe!.style);
	if (!style) return json({ error: `Unknown avatar style: ${body.recipe.style}` }, { status: 400 });
	for (const [name, value] of Object.entries(body.recipe.inputs || {})) {
		if (name.length > 80 || typeof value !== 'string' || value.length > 200) return json({ error: 'invalid avatar input' }, { status: 400 });
		if (!style.inputs?.[name]?.values.some((option) => option.value === value)) return json({ error: `Unsupported ${name} value: ${value}` }, { status: 400 });
	}
	await writeAvatarPreference(body.scope, key, body.recipe);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url, request }) => {
	if (!mutationIsSameOrigin(request, url.origin)) return json({ error: 'Cross-origin avatar changes are not allowed' }, { status: 403 });
	const scope = url.searchParams.get('scope') as AvatarPreferenceScope;
	if (!scopes.has(scope)) return json({ error: 'valid scope is required' }, { status: 400 });
	const key = target(scope, url.searchParams.get('key') || undefined, url.searchParams.get('agent_id') || undefined);
	if (!key) return json({ error: 'key is required for agent and session scopes' }, { status: 400 });
	await writeAvatarPreference(scope, key, null);
	return json({ ok: true });
};
