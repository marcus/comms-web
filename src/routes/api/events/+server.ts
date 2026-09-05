import type { RequestHandler } from './$types';
import { commsFetch, type CommsMessage } from '$lib/server/comms';

export const GET: RequestHandler = ({ url }) => {
	let isClosed = false;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			let lastSeenId = '';

			const sendEvent = (event: string, data: any) => {
				if (isClosed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					isClosed = true;
				}
			};

			sendEvent('connected', { time: new Date().toISOString() });

			const interval = setInterval(async () => {
				if (isClosed) {
					clearInterval(interval);
					return;
				}
				try {
					const res = await commsFetch<{ items: CommsMessage[] }>('/v1/observe?limit=10');
					if (res?.items && res.items.length > 0) {
						const newest = res.items[0];
						if (lastSeenId && newest.id !== lastSeenId) {
							sendEvent('new_messages', { items: res.items });
						}
						lastSeenId = newest.id;
					}
				} catch {
					// Comms may be momentarily restarting or busy
				}
			}, 1200);

			return () => {
				isClosed = true;
				clearInterval(interval);
			};
		},
		cancel() {
			isClosed = true;
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};
