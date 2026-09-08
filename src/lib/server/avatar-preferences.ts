import { appendFile, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AvatarPreferenceRecord, AvatarPreferenceScope, AvatarRecipe } from '$lib/avatar-preferences';

let writeQueue = Promise.resolve();

export function avatarPreferencesPath(): string {
	return process.env.COMMS_WEB_AVATAR_PREFERENCES || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'comms-web', 'avatar-preferences.jsonl');
}

export async function readAvatarPreferences(): Promise<AvatarPreferenceRecord[]> {
	let text: string;
	try { text = await readFile(avatarPreferencesPath(), 'utf8'); } catch (error: any) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
	const latest = new Map<string, AvatarPreferenceRecord>();
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		const record = JSON.parse(line) as AvatarPreferenceRecord;
		latest.set(`${record.scope}:${record.key}`, record);
	}
	return [...latest.values()];
}

export function writeAvatarPreference(scope: AvatarPreferenceScope, key: string, recipe: AvatarRecipe | null): Promise<void> {
	const record: AvatarPreferenceRecord = { scope, key, recipe, updated_at: new Date().toISOString() };
	writeQueue = writeQueue.catch(() => undefined).then(async () => {
		const file = avatarPreferencesPath();
		await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
	});
	return writeQueue;
}
