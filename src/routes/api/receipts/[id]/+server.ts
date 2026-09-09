import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { commsFetch, type CommsReceiptReport } from '$lib/server/comms';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const { id } = params;
		const report = await commsFetch<CommsReceiptReport>(
			`/v1/messages/${encodeURIComponent(id)}/receipts`
		);
		return json(
			{
				subscribers: report?.subscribers ?? [],
				inspectors: report?.inspectors ?? []
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (err: any) {
		return json({ error: err?.message || 'Failed to fetch receipts' }, { status: 500 });
	}
};
