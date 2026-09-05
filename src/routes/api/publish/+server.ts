import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { commsFetch, type CommsMessage } from '$lib/server/comms';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const data = await request.json();
		const { topic, author, title, body, replyTo, directAgent } = data;

		if (!body || !body.trim()) {
			return json({ error: 'Body is required' }, { status: 400 });
		}

		let res: CommsMessage;

		if (replyTo) {
			res = await commsFetch<CommsMessage>(
				`/v1/messages/${encodeURIComponent(replyTo)}/replies`,
				{
					method: 'POST',
					body: {
						title: title || undefined,
						body: body.trim()
					},
					agent: author
				}
			);
		} else if (directAgent) {
			res = await commsFetch<CommsMessage>(`/v1/direct-messages`, {
				method: 'POST',
				body: {
					recipient: directAgent,
					title: title || 'Direct message',
					body: body.trim()
				},
				agent: author
			});
		} else if (topic) {
			res = await commsFetch<CommsMessage>(`/v1/messages`, {
				method: 'POST',
				body: {
					topic,
					title: title || 'Message',
					body: body.trim()
				},
				agent: author
			});
		} else {
			return json({ error: 'Topic, replyTo, or directAgent is required' }, { status: 400 });
		}

		return json({ message: res });
	} catch (err: any) {
		return json({ error: err?.message || 'Publish failed' }, { status: 500 });
	}
};
