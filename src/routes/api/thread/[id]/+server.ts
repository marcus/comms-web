import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { commsFetch, type CommsMessage } from '$lib/server/comms';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const { id } = params;
		const threadRes = await commsFetch<{ items: CommsMessage[] }>(
			`/v1/messages/${encodeURIComponent(id)}/thread?limit=100`
		);
		return json({
			items: threadRes.items || []
		});
	} catch (err: any) {
		return json({ error: err?.message || 'Failed to fetch thread' }, { status: 500 });
	}
};
