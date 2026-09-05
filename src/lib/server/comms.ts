import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export interface CommsAgent {
	id: string;
	handle: string;
	display_name?: string;
	purpose?: string;
	harness?: string;
	project?: string;
	session_ref?: string;
	created_at: string;
	updated_at: string;
	last_seen_at?: string;
	retired_at?: string;
}

export interface CommsTopic {
	id: string;
	name: string;
	kind: 'public' | 'direct';
	description?: string;
	next_sequence: number;
	created_at: string;
	updated_at: string;
	archived_at?: string;
}

export interface CommsMessage {
	id: string;
	topic_id: string;
	sequence: number;
	author_id: string;
	author_context?: {
		harness?: string;
		project?: string;
		session_ref?: string;
	};
	title: string;
	body: string;
	in_reply_to?: string;
	thread_root_id?: string;
	created_at: string;
	expires_at?: string;
	metadata_json?: string;
}

export interface CommsHandshake {
	store_id: string;
	protocol_version: number;
	schema_version: number;
	server_version: string;
	server_instance_id: string;
	pid: number;
	started_at: string;
	launch_mode: string;
	commit: string;
	socket_path: string;
	database_path: string;
	capabilities: string[];
}

export interface CommsReceipt {
	agent: CommsAgent;
	state: 'read' | 'unread';
	read_at?: string;
}

export function getSocketPath(): string {
	if (process.env.COMMS_SOCKET) {
		return process.env.COMMS_SOCKET;
	}
	if (process.env.XDG_RUNTIME_DIR) {
		return path.join(process.env.XDG_RUNTIME_DIR, 'comms', 'comms.sock');
	}
	const stateDir =
		process.env.COMMS_STATE_DIR ||
		(process.env.XDG_STATE_HOME
			? path.join(process.env.XDG_STATE_HOME, 'comms')
			: path.join(os.homedir(), '.local', 'state', 'comms'));
	return path.join(stateDir, 'comms.sock');
}

export async function commsFetch<T>(
	endpoint: string,
	options: { method?: string; body?: any; agent?: string } = {}
): Promise<T> {
	const socketPath = getSocketPath();
	const method = options.method || 'GET';
	const postData = options.body ? JSON.stringify(options.body) : null;

	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = {
			Accept: 'application/json'
		};
		if (postData) {
			headers['Content-Type'] = 'application/json';
			headers['Content-Length'] = Buffer.byteLength(postData).toString();
		}
		if (options.agent) {
			headers['X-Comms-Agent-ID'] = options.agent;
		}

		const req = http.request(
			{
				socketPath,
				path: endpoint.startsWith('/') ? endpoint : `/${endpoint}`,
				method,
				headers
			},
			(res) => {
				let data = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => (data += chunk));
				res.on('end', () => {
					try {
						const parsed = JSON.parse(data);
						if (res.statusCode && res.statusCode >= 400) {
							reject(new Error(parsed?.error?.message || `HTTP ${res.statusCode}: ${data}`));
						} else {
							resolve(parsed.data !== undefined ? parsed.data : parsed);
						}
					} catch {
						if (res.statusCode && res.statusCode >= 400) {
							reject(new Error(`HTTP ${res.statusCode}: ${data}`));
						} else {
							reject(new Error(`Failed to parse response: ${data}`));
						}
					}
				});
			}
		);

		req.on('error', (err) => {
			reject(err);
		});

		if (postData) {
			req.write(postData);
		}
		req.end();
	});
}
