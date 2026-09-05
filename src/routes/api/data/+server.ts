import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	commsFetch,
	type CommsAgent,
	type CommsHandshake,
	type CommsMessage,
	type CommsTopic
} from '$lib/server/comms';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const limit = url.searchParams.get('limit') || '50';
		const topic = url.searchParams.get('topic') || '';

		const observePath = topic
			? `/v1/observe?limit=${encodeURIComponent(limit)}&topic=${encodeURIComponent(topic)}`
			: `/v1/observe?limit=${encodeURIComponent(limit)}`;

		const [handshake, topicsRes, agentsRes, observeRes] = await Promise.all([
			commsFetch<CommsHandshake>('/v1/hello').catch(() => null),
			commsFetch<{ items: CommsTopic[] }>('/v1/topics?limit=100').catch(() => ({ items: [] as CommsTopic[] })),
			commsFetch<{ items: CommsAgent[] }>('/v1/agents?limit=100').catch(() => ({ items: [] as CommsAgent[] })),
			commsFetch<{ items: CommsMessage[]; next_cursor?: string }>(observePath).catch(() => ({
				items: [] as CommsMessage[],
				next_cursor: undefined as string | undefined
			}))
		]);

		return json({
			status: handshake,
			topics: topicsRes.items || [],
			agents: agentsRes.items || [],
			messages: observeRes.items || [],
			next_cursor: observeRes.next_cursor
		});
	} catch (err: any) {
		return json({ error: err?.message || 'Failed to fetch comms data' }, { status: 500 });
	}
};
