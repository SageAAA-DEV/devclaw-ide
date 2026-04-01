/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA / DevClaw Contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';

export interface McpToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface McpToolResult {
	content: unknown;
	isError?: boolean;
}

export interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export class McpClaudeCodeClient {

	private process: cp.ChildProcess | null = null;
	private requestId = 0;
	private readonly pendingRequests: Map<number, {
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
	}> = new Map();
	private buffer = '';
	private _running = false;

	get running(): boolean {
		return this._running;
	}

	async startBridge(): Promise<void> {
		if (this.process) {
			return;
		}

		return new Promise((resolve, reject) => {
			try {
				this.process = cp.spawn('claude', ['mcp', 'serve'], {
					stdio: ['pipe', 'pipe', 'pipe'],
					shell: false,
				});

				this.process.stdout?.on('data', (data: Buffer) => {
					this.buffer += data.toString();
					this.processBuffer();
				});

				this.process.stderr?.on('data', (data: Buffer) => {
					console.error('[MCP Bridge stderr]', data.toString());
				});

				this.process.on('error', (err) => {
					this._running = false;
					this.process = null;
					reject(err);
				});

				this.process.on('exit', (code) => {
					this._running = false;
					this.process = null;
					// Reject all pending requests
					for (const [, req] of this.pendingRequests) {
						req.reject(new Error(`MCP bridge exited with code ${code}`));
					}
					this.pendingRequests.clear();
				});

				this._running = true;

				// Give the process a moment to start
				setTimeout(() => resolve(), 500);
			} catch (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	async listTools(): Promise<McpTool[]> {
		const result = await this.sendRequest('tools/list', {});
		return (result as { tools: McpTool[] }).tools || [];
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
		const result = await this.sendRequest('tools/call', { name, arguments: args });
		return result as McpToolResult;
	}

	async stopBridge(): Promise<void> {
		if (!this.process) {
			return;
		}

		const proc = this.process;
		this.process = null;
		this._running = false;

		// SIGTERM first
		proc.kill('SIGTERM');

		// SIGKILL after 5s if still alive
		const killTimer = setTimeout(() => {
			try {
				proc.kill('SIGKILL');
			} catch {
				// Already dead
			}
		}, 5000);

		return new Promise((resolve) => {
			proc.on('exit', () => {
				clearTimeout(killTimer);
				resolve();
			});

			// If already dead
			if (proc.exitCode !== null) {
				clearTimeout(killTimer);
				resolve();
			}
		});
	}

	private sendRequest(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.process?.stdin?.writable) {
				reject(new Error('MCP bridge not running'));
				return;
			}

			const id = ++this.requestId;
			const request = {
				jsonrpc: '2.0',
				id,
				method,
				params,
			};

			this.pendingRequests.set(id, { resolve, reject });
			this.process.stdin.write(JSON.stringify(request) + '\n');

			// Timeout after 30s
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`MCP request ${method} timed out`));
				}
			}, 30000);
		});
	}

	private processBuffer(): void {
		const lines = this.buffer.split('\n');
		this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}
			try {
				const msg = JSON.parse(line);
				if (msg.id && this.pendingRequests.has(msg.id)) {
					const req = this.pendingRequests.get(msg.id)!;
					this.pendingRequests.delete(msg.id);
					if (msg.error) {
						req.reject(new Error(msg.error.message || 'MCP error'));
					} else {
						req.resolve(msg.result);
					}
				}
			} catch {
				// Non-JSON line, ignore
			}
		}
	}

	dispose(): void {
		this.stopBridge();
	}
}
