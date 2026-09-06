import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { commsFetch, type CommsReceipt } from '$lib/server/comms';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const { id } = params;
		const receipts = await commsFetch<CommsReceipt[]>(
			`/v1/messages/${encodeURIComponent(id)}/receipts`
		);
		return json({
			receipts: receipts || []
		}, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err: any) {
		return json({ error: err?.message || 'Failed to fetch receipts' }, { status: 500 });
	}
};
