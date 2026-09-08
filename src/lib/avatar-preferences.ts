export type AvatarInputs = Record<string, string>;

export interface AvatarRecipe {
	style: string;
	inputs?: AvatarInputs;
}

export function recipeForScope(records: AvatarPreferenceRecord[], scope: AvatarPreferenceScope, agentId: string, sessionRef?: string): AvatarRecipe {
	if (scope === 'default') return resolveAvatarRecipe(records, '', undefined).recipe;
	if (scope === 'agent') return resolveAvatarRecipe(records, agentId, undefined).recipe;
	return resolveAvatarRecipe(records, agentId, sessionRef).recipe;
}

export type AvatarPreferenceScope = 'default' | 'agent' | 'session';

export interface AvatarPreferenceRecord {
	scope: AvatarPreferenceScope;
	key: string;
	recipe: AvatarRecipe | null;
	updated_at: string;
}

export function resolveAvatarRecipe(
	records: AvatarPreferenceRecord[],
	agentId: string,
	sessionRef?: string,
	fallback: AvatarRecipe = { style: 'gorey' }
): { recipe: AvatarRecipe; source: AvatarPreferenceScope | 'fallback' } {
	const active = new Map<string, AvatarRecipe>();
	for (const record of records) record.recipe ? active.set(`${record.scope}:${record.key}`, record.recipe) : active.delete(`${record.scope}:${record.key}`);
	if (sessionRef) {
		const recipe = active.get(`session:${agentId}:${sessionRef}`);
		if (recipe) return { recipe, source: 'session' };
	}
	const agent = active.get(`agent:${agentId}`);
	if (agent) return { recipe: agent, source: 'agent' };
	const global = active.get('default:global');
	return global ? { recipe: global, source: 'default' } : { recipe: fallback, source: 'fallback' };
}
