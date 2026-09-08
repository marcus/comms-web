import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { agentPortrait } from '../agent-portrait.ts';
import type { AvatarRecipe } from '../avatar-preferences.ts';

const execFileAsync = promisify(execFile);
const cache = new Map<string, { bytes: Uint8Array; contentType: string }>();
const renders = new Map<string, Promise<{ bytes: Uint8Array; contentType: string }>>();
let ensurePromise: Promise<string> | null = null;
let knownService: { endpoint: string; build: string; checkedAt: number } | null = null;
let unavailableUntil = 0;

export interface AvatarInputDescriptor { default: string; mixed_value?: string; values: { value: string; label: string; swatch?: string }[] }
export interface AvatarStyle { id: string; name: string; native_width: number; native_height: number; inputs?: Record<string, AvatarInputDescriptor> }

export function renderQuery(seed: string, recipe: AvatarRecipe): URLSearchParams {
	const query = new URLSearchParams({ seed, style: recipe.style, format: 'svg' });
	for (const [name, value] of Object.entries(recipe.inputs || {}).sort(([a], [b]) => a.localeCompare(b))) {
		query.set(name, value);
	}
	return query;
}

function configuredEndpoint(): string | null { return process.env.AVATARS_ENDPOINT?.replace(/\/$/, '') || null; }

async function ensureEndpoint(): Promise<string> {
	const configured = configuredEndpoint();
	if (configured) return configured;
	if (!ensurePromise) ensurePromise = (async () => {
		const executable = process.env.AVATARS_BIN || 'avatars';
		const { stdout } = await execFileAsync(executable, ['service', 'ensure', '--json'], { timeout: 10_000 });
		const result = JSON.parse(stdout);
		const endpoint = result.endpoint || result.data?.endpoint;
		if (!endpoint) throw new Error('avatars service ensure returned no endpoint');
		return String(endpoint).replace(/\/$/, '');
	})().finally(() => { ensurePromise = null; });
	return ensurePromise;
}

async function serviceFetch(pathname: string): Promise<Response> {
	const endpoint = await ensureEndpoint();
	return fetch(`${endpoint}${pathname}`, { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json, image/svg+xml' } });
}

export async function getAvatarCatalog(): Promise<{ styles: AvatarStyle[]; formats: string[] }> {
	const response = await serviceFetch('/api/v1/styles');
	if (!response.ok) throw new Error(`Avatars catalog failed: HTTP ${response.status}`);
	return response.json();
}

export async function renderAvatar(seed: string, recipe: AvatarRecipe): Promise<{ bytes: Uint8Array; contentType: string; fallback: boolean }> {
	const fallback = () => ({ bytes: new TextEncoder().encode(agentPortrait(seed)), contentType: 'image/svg+xml', fallback: true });
	if (Date.now() < unavailableUntil) return fallback();
	try {
		let service = knownService;
		if (!service || Date.now() - service.checkedAt > 30_000) {
			const endpoint = await ensureEndpoint();
			const healthResponse = await fetch(`${endpoint}/api/v1/health`, { signal: AbortSignal.timeout(8_000) });
			if (!healthResponse.ok) throw new Error(`Avatars health failed: HTTP ${healthResponse.status}`);
			const health = await healthResponse.json();
			service = knownService = { endpoint, build: `${health.version || 'unknown'}:${health.commit || 'unknown'}`, checkedAt: Date.now() };
		}
		const query = renderQuery(seed, recipe);
		const key = `${service.build}:${query.toString()}`;
		const hit = cache.get(key);
		if (hit) { cache.delete(key); cache.set(key, hit); return { ...hit, fallback: false }; }
		let pending = renders.get(key);
		if (!pending) {
			pending = (async () => { const response = await fetch(`${service.endpoint}/api/v1/render?${query}`, { signal: AbortSignal.timeout(8_000) }); if (!response.ok) throw new Error(`Avatars render failed: HTTP ${response.status}`); return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'image/svg+xml' }; })().finally(() => renders.delete(key));
			renders.set(key, pending);
		}
		const value = await pending;
		cache.set(key, value);
		if (cache.size > 256) cache.delete(cache.keys().next().value!);
		return { ...value, fallback: false };
	} catch {
		unavailableUntil = Date.now() + 2_000;
		return fallback();
	}
}
