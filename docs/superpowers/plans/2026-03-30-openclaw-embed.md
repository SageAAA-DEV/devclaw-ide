# OpenClaw Inside — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed OpenClaw as a persistent daemon inside DevTeam IDE — one binary, always-on AI agent, BYOK.

**Architecture:** OpenClaw ships bundled in `resources/openclaw/`, installed to `~/.openclaw/engine/` as a system service on first launch. IDE connects via `OpenClawClient` (OpenAI-compatible HTTP). Shared `IBackendClient` interface lets `DevClawService` swap between OpenClaw (default) and CTRL-A Cloud. First-launch wizard collects BYOK key and starts the daemon.

**Tech Stack:** TypeScript, Electron (Code-OSS fork), Node.js child_process, OpenAI Chat Completions API format, Windows Task Scheduler / macOS launchd / Linux systemd

**Spec:** `docs/superpowers/specs/2026-03-30-openclaw-embed-design.md`

---

## Chunk 1: Foundation Layer (backendClient + openClawClient + ctrlAClient update)

These have no dependencies on each other or on existing modified files. Can be built in parallel.

### Task 1: Create IBackendClient shared interface

**Files:**
- Create: `src/vs/workbench/contrib/devteam/common/backendClient.ts`

- [ ] **Step 1: Create the interface file**

```typescript
/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE — Backend Client Interface
 *  Shared contract for OpenClaw and CTRL-A client implementations.
 *--------------------------------------------------------------------------------------------*/

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface ChatResponse {
	response: string;
	agentId: string;
	conversationId: string;
	toolCalls?: ToolCallResult[];
	sentiment?: { type: string; intensity: number };
}

export interface ToolCallResult {
	name: string;
	result: unknown;
}

export interface AgentInfo {
	id: string;
	name: string;
	role: string;
	vertical: string;
	status: string;
	description?: string;
}

/**
 * Shared interface for IDE ↔ AI backend communication.
 * Both OpenClawClient and CtrlAClient implement this.
 */
export interface IBackendClient {
	chat(agentId: string, message: string, conversationId?: string): Promise<ChatResponse>;
	chatStream(agentId: string, message: string, onChunk: (text: string) => void): Promise<string>;
	getHealth(): Promise<{ status: string; version: string }>;
	listAgents(): Promise<AgentInfo[]>;
	isConnected(): boolean;
	dispose(): void;
}
```

- [ ] **Step 2: Verify build**

Run: `cd "C:/Users/bifil/OneDrive/Desktop/SaaSLand/DevTeam-ide-main" && npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors from `backendClient.ts`

- [ ] **Step 3: Commit**

```bash
git add src/vs/workbench/contrib/devteam/common/backendClient.ts
git commit -m "feat: add IBackendClient shared interface for dual-backend support"
```

---

### Task 2: Update CtrlAClient to implement IBackendClient

**Files:**
- Modify: `src/vs/workbench/contrib/devteam/common/ctrlAClient.ts`

- [ ] **Step 1: Add import and implements clause**

At the top of `ctrlAClient.ts`, add:
```typescript
import { IBackendClient } from './backendClient.js';
```

Remove the local `ChatMessage`, `ChatResponse`, `ToolCallResult`, `AgentInfo` interfaces (lines 11-36) and import them from `backendClient.ts` instead:
```typescript
import { IBackendClient, ChatMessage, ChatResponse, ToolCallResult, AgentInfo } from './backendClient.js';
```

Change the class declaration (line 48):
```typescript
export class CtrlAClient implements IBackendClient {
```

Keep the `CtrlAConfig`, `StreamEventType`, `StreamEvent`, and all WebSocket methods — these are CTRL-A-specific and not part of `IBackendClient`.

- [ ] **Step 2: Verify build compiles**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/vs/workbench/contrib/devteam/common/ctrlAClient.ts
git commit -m "refactor: CtrlAClient implements IBackendClient, shared types moved to backendClient.ts"
```

---

### Task 3: Create OpenClawClient

**Files:**
- Create: `src/vs/workbench/contrib/devteam/common/openClawClient.ts`

- [ ] **Step 1: Create the OpenClaw client**

```typescript
/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE — OpenClaw Client
 *  HTTP client for the embedded OpenClaw daemon (OpenAI-compatible format).
 *--------------------------------------------------------------------------------------------*/

import { IBackendClient, ChatResponse, AgentInfo } from './backendClient.js';

export interface OpenClawConfig {
	baseUrl: string;   // e.g. http://127.0.0.1:18789
	token: string;     // Bearer token for gateway auth
}

export class OpenClawClient implements IBackendClient {

	private _connected = false;
	private _conversationId: string | undefined;

	constructor(private config: OpenClawConfig) { }

	// --- Configuration ---

	updateConfig(config: Partial<OpenClawConfig>): void {
		this.config = { ...this.config, ...config };
	}

	getConfig(): Readonly<OpenClawConfig> {
		return this.config;
	}

	// --- REST API (OpenAI-compatible) ---

	async chat(agentId: string, message: string, conversationId?: string): Promise<ChatResponse> {
		const cid = conversationId || this._conversationId || crypto.randomUUID();
		this._conversationId = cid;

		const body = {
			model: `openclaw:${agentId}`,
			messages: [
				{ role: 'user' as const, content: message },
			],
			user: cid,
		};

		const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(`OpenClaw API error: ${res.status} ${res.statusText}`);
		}

		const data = await res.json();
		const content = data.choices?.[0]?.message?.content || 'No response from agent.';

		return {
			response: content,
			agentId,
			conversationId: cid,
		};
	}

	async chatStream(agentId: string, message: string, onChunk: (text: string) => void): Promise<string> {
		const cid = this._conversationId || crypto.randomUUID();
		this._conversationId = cid;

		const body = {
			model: `openclaw:${agentId}`,
			messages: [
				{ role: 'user' as const, content: message },
			],
			stream: true,
			user: cid,
		};

		const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(`OpenClaw API error: ${res.status} ${res.statusText}`);
		}

		if (!res.body) {
			const data = await res.json();
			const content = data.choices?.[0]?.message?.content || '';
			onChunk(content);
			return content;
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let fullResponse = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			const chunk = decoder.decode(value, { stream: true });
			const lines = chunk.split('\n');
			for (const line of lines) {
				if (line.startsWith('data: ')) {
					const data = line.slice(6).trim();
					if (data === '[DONE]') {
						continue;
					}
					try {
						const parsed = JSON.parse(data);
						const text = parsed.choices?.[0]?.delta?.content || '';
						if (text) {
							fullResponse += text;
							onChunk(text);
						}
					} catch {
						// Skip malformed SSE lines
					}
				}
			}
		}

		return fullResponse;
	}

	async listAgents(): Promise<AgentInfo[]> {
		// OpenClaw doesn't have an agent discovery endpoint.
		// Agent roster is managed client-side via persona definitions.
		return [
			{ id: 'ctrl-a', name: 'CTRL-A', role: 'Router', vertical: 'general', status: 'active' },
			{ id: 'devin', name: 'Devin', role: 'Lead Engineer', vertical: 'engineering', status: 'active' },
			{ id: 'scout', name: 'Scout', role: 'Researcher', vertical: 'research', status: 'active' },
			{ id: 'sage', name: 'Sage', role: 'Code Reviewer', vertical: 'quality', status: 'active' },
			{ id: 'ink', name: 'Ink', role: 'Technical Writer', vertical: 'docs', status: 'active' },
		];
	}

	async getHealth(): Promise<{ status: string; version: string }> {
		const res = await fetch(`${this.config.baseUrl}/health`, {
			headers: this.headers(),
		});
		if (!res.ok) {
			throw new Error(`OpenClaw health check failed: ${res.status}`);
		}
		// OpenClaw /health returns plain text or simple JSON
		try {
			const data = await res.json();
			return { status: 'ok', version: data.version || 'unknown' };
		} catch {
			return { status: 'ok', version: 'unknown' };
		}
	}

	isConnected(): boolean {
		return this._connected;
	}

	setConnected(value: boolean): void {
		this._connected = value;
	}

	resetConversation(): void {
		this._conversationId = undefined;
	}

	dispose(): void {
		this._connected = false;
	}

	// --- Internal ---

	private headers(): Record<string, string> {
		const h: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this.config.token) {
			h['Authorization'] = `Bearer ${this.config.token}`;
		}
		return h;
	}
}
```

- [ ] **Step 2: Verify build**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/vs/workbench/contrib/devteam/common/openClawClient.ts
git commit -m "feat: add OpenClawClient — OpenAI-compatible HTTP client for embedded daemon"
```

---

## Chunk 2: Daemon Manager + IPC Bridge

The daemon manager runs in Node (Electron main process). Browser-side code (wizard, settings, service) cannot import it directly — VS Code enforces browser/node separation. We need an IPC service interface.

### Task 4a: Create IOpenClawDaemonService interface (browser-safe)

**Files:**
- Create: `src/vs/platform/openclaw/common/openclawDaemon.ts`

This file lives in `common/` so both browser and node layers can import it.

- [ ] **Step 1: Create the service interface**

```typescript
/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE — OpenClaw Daemon Service Interface
 *  Browser-safe interface for managing the embedded OpenClaw daemon.
 *  Implementation lives in node/; browser code uses this via DI.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

export interface IOpenClawDaemonConfig {
	port: number;
	token: string;
	provider?: string;
	anthropicKey?: string;
	openaiKey?: string;
	minimaxKey?: string;
	openrouterKey?: string;
}

export const IOpenClawDaemonService = createDecorator<IOpenClawDaemonService>('openClawDaemonService');

export interface IOpenClawDaemonService {
	readonly _serviceBrand: undefined;

	readonly isReady: boolean;
	readonly onReady: Event<void>;
	readonly onError: Event<string>;

	install(): Promise<IOpenClawDaemonConfig>;
	start(): Promise<boolean>;
	stop(): Promise<void>;
	updateKeys(keys: Partial<Pick<IOpenClawDaemonConfig, 'anthropicKey' | 'openaiKey' | 'minimaxKey' | 'openrouterKey' | 'provider'>>): Promise<void>;
	upgrade(): Promise<boolean>;

	getPort(): number;
	getToken(): string;
	getBaseUrl(): string;
}
```

- [ ] **Step 2: Commit**

```bash
mkdir -p src/vs/platform/openclaw/common
git add src/vs/platform/openclaw/common/openclawDaemon.ts
git commit -m "feat: add IOpenClawDaemonService interface (browser-safe)"
```

### Task 4: Create OpenClaw Daemon Manager

**Files:**
- Create: `src/vs/platform/openclaw/node/openclawDaemonManager.ts`

**Important context:** This file runs in Electron's main (Node.js) process, not the browser renderer. It has access to `child_process`, `fs`, `path`, `net`, and `os` modules.

- [ ] **Step 1: Create directory**

```bash
mkdir -p "C:/Users/bifil/OneDrive/Desktop/SaaSLand/DevTeam-ide-main/src/vs/platform/openclaw/node"
```

- [ ] **Step 2: Create the daemon manager**

```typescript
/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE — OpenClaw Daemon Manager
 *  Manages the lifecycle of the embedded OpenClaw gateway daemon.
 *  Runs in Electron's main (Node.js) process.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'fs';
import { createServer } from 'net';
import { join } from 'path';
import { homedir } from 'os';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../instantiation/common/extensions.js';
import { IOpenClawDaemonService, IOpenClawDaemonConfig } from '../common/openclawDaemon.js';

export class OpenClawDaemonManager extends Disposable implements IOpenClawDaemonService {

	declare readonly _serviceBrand: undefined;

	private process: ChildProcess | null = null;
	private _isReady = false;
	private _config: IOpenClawDaemonConfig | null = null;

	private readonly _onReady = this._register(new Emitter<void>());
	readonly onReady: Event<void> = this._onReady.event;

	private readonly _onError = this._register(new Emitter<string>());
	readonly onError: Event<string> = this._onError.event;

	private readonly openclawHome = join(homedir(), '.openclaw');
	private readonly engineDir = join(this.openclawHome, 'engine');
	private readonly configPath = join(this.openclawHome, 'config.json');
	private readonly logsDir = join(this.openclawHome, 'logs');

	get isReady(): boolean { return this._isReady; }
	get config(): IOpenClawDaemonConfig | null { return this._config; }

	/**
	 * Get the bundled OpenClaw path inside the IDE resources.
	 * In dev mode this is relative to the repo root; in production it's in the app resources.
	 */
	private getBundledPath(): string {
		// Check common locations
		const candidates = [
			join(process.resourcesPath || '', 'openclaw'),
			join(__dirname, '..', '..', '..', '..', '..', 'resources', 'openclaw'),
		];
		for (const candidate of candidates) {
			if (existsSync(join(candidate, 'openclaw.mjs')) || existsSync(join(candidate, 'package.json'))) {
				return candidate;
			}
		}
		return candidates[0]; // fallback
	}

	/**
	 * Install OpenClaw from the bundled resources to the persistent engine directory.
	 * Generates a token and selects a port if this is a fresh install.
	 */
	async install(): Promise<IOpenClawDaemonConfig> {
		// Create directories
		for (const dir of [this.openclawHome, this.engineDir, this.logsDir]) {
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
		}

		// Copy bundled OpenClaw to engine dir
		const bundledPath = this.getBundledPath();
		if (existsSync(bundledPath)) {
			cpSync(bundledPath, this.engineDir, { recursive: true, force: true });
		}

		// Load or create config
		let config: OpenClawDaemonConfig;
		if (existsSync(this.configPath)) {
			config = JSON.parse(readFileSync(this.configPath, 'utf-8'));
		} else {
			const port = await this.findFreePort(18789);
			const token = this.generateToken();
			config = { port, token };
		}

		this.saveConfig(config);
		this._config = config;
		return config;
	}

	/**
	 * Start the OpenClaw daemon if it's not already running.
	 * Polls /health until ready or timeout (30s).
	 */
	async start(): Promise<boolean> {
		// Load config
		if (!this._config) {
			if (existsSync(this.configPath)) {
				this._config = JSON.parse(readFileSync(this.configPath, 'utf-8'));
			} else {
				throw new Error('OpenClaw not installed. Run install() first.');
			}
		}

		// Check if already running
		if (await this.checkHealth()) {
			this._isReady = true;
			this._onReady.fire();
			return true;
		}

		// Start the daemon
		const entrypoint = join(this.engineDir, 'openclaw.mjs');
		if (!existsSync(entrypoint)) {
			this._onError.fire(`OpenClaw entrypoint not found at ${entrypoint}`);
			return false;
		}

		const env: Record<string, string> = {
			...process.env as Record<string, string>,
			OPENCLAW_GATEWAY_TOKEN: this._config.token,
			OPENCLAW_CONFIG_DIR: this.openclawHome,
		};

		// Pass BYOK keys
		if (this._config.anthropicKey) { env.ANTHROPIC_API_KEY = this._config.anthropicKey; }
		if (this._config.openaiKey) { env.OPENAI_API_KEY = this._config.openaiKey; }
		if (this._config.minimaxKey) { env.MINIMAX_API_KEY = this._config.minimaxKey; }
		if (this._config.openrouterKey) { env.OPENROUTER_API_KEY = this._config.openrouterKey; }

		this.process = spawn(process.execPath, [entrypoint, 'gateway', '--bind', '127.0.0.1', '--port', String(this._config.port)], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: true, // Daemon outlives IDE
		});

		// Unref so the IDE can exit without waiting for the daemon
		this.process.unref();

		// Log stdout/stderr to files
		const { createWriteStream } = await import('fs');
		const stdoutLog = createWriteStream(join(this.logsDir, 'stdout.log'), { flags: 'a' });
		const stderrLog = createWriteStream(join(this.logsDir, 'stderr.log'), { flags: 'a' });
		this.process.stdout?.pipe(stdoutLog);
		this.process.stderr?.pipe(stderrLog);

		this.process.on('exit', (code) => {
			if (code !== 0 && code !== null) {
				this._onError.fire(`OpenClaw exited with code ${code}`);
			}
			this._isReady = false;
			this.process = null;
		});

		// Wait for health check (30s timeout, 1s polls)
		return this.waitForReady(30000);
	}

	/**
	 * Stop the daemon gracefully.
	 */
	async stop(): Promise<void> {
		if (this.process) {
			this.process.kill('SIGTERM');
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					this.process?.kill('SIGKILL');
					resolve();
				}, 3000);
				this.process?.on('exit', () => {
					clearTimeout(timeout);
					resolve();
				});
			});
			this.process = null;
		}
		this._isReady = false;
	}

	/**
	 * Update BYOK keys in config and restart the daemon to pick them up.
	 */
	async updateKeys(keys: Partial<Pick<IOpenClawDaemonConfig, 'anthropicKey' | 'openaiKey' | 'minimaxKey' | 'openrouterKey' | 'provider'>>): Promise<void> {
		if (!this._config) { return; }
		Object.assign(this._config, keys);
		this.saveConfig(this._config);

		// Restart to pick up new env vars
		await this.stop();
		await this.start();
	}

	/**
	 * Check if newer OpenClaw is bundled and upgrade if so.
	 */
	async upgrade(): Promise<boolean> {
		const bundledPath = this.getBundledPath();
		const bundledPkg = join(bundledPath, 'package.json');
		const installedPkg = join(this.engineDir, 'package.json');

		if (!existsSync(bundledPkg) || !existsSync(installedPkg)) {
			return false;
		}

		try {
			const bundledVersion = JSON.parse(readFileSync(bundledPkg, 'utf-8')).version;
			const installedVersion = JSON.parse(readFileSync(installedPkg, 'utf-8')).version;

			if (bundledVersion !== installedVersion) {
				await this.stop();
				cpSync(bundledPath, this.engineDir, { recursive: true, force: true });
				await this.start();
				return true;
			}
		} catch {
			// Skip upgrade on error
		}
		return false;
	}

	getPort(): number {
		return this._config?.port || 18789;
	}

	getToken(): string {
		return this._config?.token || '';
	}

	getBaseUrl(): string {
		return `http://127.0.0.1:${this.getPort()}`;
	}

	// --- Internal ---

	private async checkHealth(): Promise<boolean> {
		if (!this._config) { return false; }
		try {
			const res = await fetch(`http://127.0.0.1:${this._config.port}/health`, {
				signal: AbortSignal.timeout(2000),
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	private async waitForReady(timeoutMs: number): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (await this.checkHealth()) {
				this._isReady = true;
				this._onReady.fire();
				return true;
			}
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
		this._onError.fire(`OpenClaw failed to start within ${timeoutMs / 1000}s. Check logs at ${this.logsDir}`);
		return false;
	}

	private async findFreePort(preferred: number): Promise<number> {
		// Try preferred port first, then scan range
		const candidates = [preferred, ...Array.from({ length: 100 }, (_, i) => preferred + 1 + i)];
		for (const port of candidates) {
			if (await this.isPortFree(port)) {
				return port;
			}
		}
		// Fallback: let OS pick
		return new Promise((resolve, reject) => {
			const server = createServer();
			server.listen(0, '127.0.0.1', () => {
				const addr = server.address();
				const port = typeof addr === 'object' && addr ? addr.port : 0;
				server.close(() => resolve(port));
			});
			server.on('error', reject);
		});
	}

	private isPortFree(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = createServer();
			server.listen(port, '127.0.0.1', () => {
				server.close(() => resolve(true));
			});
			server.on('error', () => resolve(false));
		});
	}

	private generateToken(): string {
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let token = 'ocl_';
		for (let i = 0; i < 32; i++) {
			token += chars[Math.floor(Math.random() * chars.length)];
		}
		return token;
	}

	private saveConfig(config: IOpenClawDaemonConfig): void {
		writeFileSync(this.configPath, JSON.stringify(config, null, 2));
	}

	override dispose(): void {
		// NOTE: Do NOT stop the daemon on dispose — it's meant to outlive the IDE.
		// Only clean up the process reference.
		this.process = null;
		super.dispose();
	}
}

registerSingleton(IOpenClawDaemonService, OpenClawDaemonManager, InstantiationType.Delayed);
```

- [ ] **Step 3: Verify build**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/vs/platform/openclaw/node/openclawDaemonManager.ts
git commit -m "feat: add OpenClaw daemon manager — install, start, health check, upgrade"
```

---

## Chunk 3: Service Layer + Settings Updates

### Task 5: Update DevClawService for dual-backend support

**Files:**
- Modify: `src/vs/workbench/contrib/devteam/browser/devclawService.ts`

- [ ] **Step 1: Rewrite devclawService.ts**

Key changes:
- Import `IBackendClient` from `backendClient.ts`
- Import `OpenClawClient` from `openClawClient.ts`
- `getClient()` returns `IBackendClient` instead of `CtrlAClient`
- Read `devteam.backend` from storage (default: `'openclaw'`)
- Conditional WebSocket (CTRL-A only)
- `reconnect()` rebuilds the correct client based on current backend setting

Full replacement for `devclawService.ts`:

```typescript
/*---------------------------------------------------------------------------------------------
 *  DevClaw - Shared Service
 *  Central service bridging Chat, Agents, and Settings panes.
 *  Supports dual backends: OpenClaw (default, embedded) and CTRL-A Cloud (optional).
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IBackendClient, ChatResponse } from '../common/backendClient.js';
import { CtrlAClient, type StreamEvent } from '../common/ctrlAClient.js';
import { OpenClawClient } from '../common/openClawClient.js';

export type BackendType = 'openclaw' | 'ctrl-a';

export const IDevClawService = createDecorator<IDevClawService>('devClawService');

export interface IDevClawService {
	readonly _serviceBrand: undefined;

	// State
	readonly selectedAgentId: string;
	readonly isConnected: boolean;
	readonly backendType: BackendType;

	// Events
	readonly onAgentSelected: Event<string>;
	readonly onStreamEvent: Event<StreamEvent>;
	readonly onConnectionChanged: Event<boolean>;
	readonly onChatMessage: Event<{ role: 'user' | 'assistant' | 'system'; content: string; agentId?: string }>;

	// Actions
	selectAgent(agentId: string): void;
	sendMessage(message: string): Promise<ChatResponse | null>;
	sendMessageStream(message: string, onChunk: (text: string) => void): Promise<string | null>;
	sendMessageWithContext(message: string, context: string, filePath?: string): Promise<ChatResponse | null>;
	reconnect(): void;
	getClient(): IBackendClient;
}

export class DevClawService extends Disposable implements IDevClawService {

	declare readonly _serviceBrand: undefined;

	private client: IBackendClient;
	private ctrlAClient: CtrlAClient | null = null; // kept for WebSocket if CTRL-A backend
	private _selectedAgentId = 'ctrl-a';
	private _isConnected = false;
	private _backendType: BackendType = 'openclaw';

	private readonly _onAgentSelected = this._register(new Emitter<string>());
	readonly onAgentSelected: Event<string> = this._onAgentSelected.event;

	private readonly _onStreamEvent = this._register(new Emitter<StreamEvent>());
	readonly onStreamEvent: Event<StreamEvent> = this._onStreamEvent.event;

	private readonly _onConnectionChanged = this._register(new Emitter<boolean>());
	readonly onConnectionChanged: Event<boolean> = this._onConnectionChanged.event;

	private readonly _onChatMessage = this._register(new Emitter<{ role: 'user' | 'assistant' | 'system'; content: string; agentId?: string }>());
	readonly onChatMessage: Event<{ role: 'user' | 'assistant' | 'system'; content: string; agentId?: string }> = this._onChatMessage.event;

	get selectedAgentId(): string { return this._selectedAgentId; }
	get isConnected(): boolean { return this._isConnected; }
	get backendType(): BackendType { return this._backendType; }

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this._backendType = (this.storageService.get('devteam.backend', StorageScope.APPLICATION, 'openclaw') as BackendType) || 'openclaw';
		this.client = this.createClient();

		// Auto-connect
		this.tryConnect();
	}

	private createClient(): IBackendClient {
		if (this._backendType === 'openclaw') {
			// Read OpenClaw config from ~/.openclaw/config.json via storage
			// The daemon manager writes port+token there; settings pane reads and stores them
			const port = this.storageService.get('devteam.openclaw.port', StorageScope.APPLICATION, '18789');
			const token = this.storageService.get('devteam.openclaw.token', StorageScope.APPLICATION, '');
			return new OpenClawClient({
				baseUrl: `http://127.0.0.1:${port}`,
				token,
			});
		} else {
			const url = this.storageService.get('devteam.ctrlA.url', StorageScope.APPLICATION, '');
			const apiKey = this.storageService.get('devteam.ctrlA.apiKey', StorageScope.APPLICATION, '');
			const ctrlA = new CtrlAClient({
				baseUrl: url || 'http://localhost:3000',
				apiKey: apiKey || '',
			});
			this.ctrlAClient = ctrlA;

			// Wire up WebSocket events (CTRL-A only)
			ctrlA.onAll((event) => {
				this._onStreamEvent.fire(event);
			});

			return ctrlA;
		}
	}

	selectAgent(agentId: string): void {
		this._selectedAgentId = agentId;
		this._onAgentSelected.fire(agentId);

		// Tell CTRL-A via WebSocket (CTRL-A backend only)
		if (this._isConnected && this.ctrlAClient) {
			this.ctrlAClient.selectAgent(agentId);
		}
	}

	async sendMessage(message: string): Promise<ChatResponse | null> {
		this._onChatMessage.fire({ role: 'user', content: message });

		if (!this._isConnected) {
			const backendName = this._backendType === 'openclaw' ? 'OpenClaw' : 'CTRL-A';
			this._onChatMessage.fire({
				role: 'system',
				content: `Not connected to ${backendName}. Configure your connection in DevClaw Settings.`,
			});
			return null;
		}

		try {
			const response = await this.client.chat(this._selectedAgentId, message);
			this._onChatMessage.fire({
				role: 'assistant',
				content: response.response,
				agentId: this._selectedAgentId,
			});
			return response;
		} catch (err) {
			this._onChatMessage.fire({
				role: 'system',
				content: `Error: ${err instanceof Error ? err.message : String(err)}`,
			});
			return null;
		}
	}

	async sendMessageStream(message: string, onChunk: (text: string) => void): Promise<string | null> {
		this._onChatMessage.fire({ role: 'user', content: message });

		if (!this._isConnected) {
			const backendName = this._backendType === 'openclaw' ? 'OpenClaw' : 'CTRL-A';
			this._onChatMessage.fire({
				role: 'system',
				content: `Not connected to ${backendName}. Configure your connection in DevClaw Settings.`,
			});
			return null;
		}

		try {
			const response = await this.client.chatStream(this._selectedAgentId, message, onChunk);
			this._onChatMessage.fire({
				role: 'assistant',
				content: response,
				agentId: this._selectedAgentId,
			});
			return response;
		} catch (err) {
			this._onChatMessage.fire({
				role: 'system',
				content: `Error: ${err instanceof Error ? err.message : String(err)}`,
			});
			return null;
		}
	}

	async sendMessageWithContext(message: string, context: string, filePath?: string): Promise<ChatResponse | null> {
		const fullMessage = filePath
			? `${message}\n\nFile: ${filePath}\n\`\`\`\n${context}\n\`\`\``
			: `${message}\n\n\`\`\`\n${context}\n\`\`\``;

		return this.sendMessage(fullMessage);
	}

	reconnect(): void {
		// Dispose old client
		this.client.dispose();
		this.ctrlAClient = null;

		// Re-read backend type
		this._backendType = (this.storageService.get('devteam.backend', StorageScope.APPLICATION, 'openclaw') as BackendType) || 'openclaw';
		this.client = this.createClient();
		this.tryConnect();
	}

	getClient(): IBackendClient {
		return this.client;
	}

	private async tryConnect(): Promise<void> {
		try {
			await this.client.getHealth();
			this._isConnected = true;
			this._onConnectionChanged.fire(true);

			// Also connect WebSocket for CTRL-A
			if (this.ctrlAClient) {
				this.ctrlAClient.connectWs();
			}
		} catch {
			this._isConnected = false;
			this._onConnectionChanged.fire(false);
		}
	}

	override dispose(): void {
		this.client.dispose();
		super.dispose();
	}
}

registerSingleton(IDevClawService, DevClawService, InstantiationType.Delayed);
```

- [ ] **Step 2: Verify build**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/vs/workbench/contrib/devteam/browser/devclawService.ts
git commit -m "feat: DevClawService dual-backend — OpenClaw (default) + CTRL-A Cloud"
```

---

### Task 6: Update devclawAgents.ts for OpenClaw routing

**Files:**
- Modify: `src/vs/workbench/contrib/devteam/browser/devclawAgents.ts`

- [ ] **Step 1: Update handleRequest to support both backends**

The key change is in `handleRequest()` (line 354). Currently it reads `devteam.ctrlA.url` and always POSTs to `/api/chat`. We need it to check the backend type and route accordingly.

Changes to make:

1. Add import at top:
```typescript
import { IDevClawService } from './devclawService.js';
```

2. Add `IDevClawService` to constructor DI:
```typescript
constructor(
	@IChatAgentService private readonly chatAgentService: IChatAgentService,
	@IStorageService private readonly storageService: IStorageService,
	@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	@IEditorService private readonly editorService: IEditorService,
	@IFileService private readonly fileService: IFileService,
	@IDevClawService private readonly devClawService: IDevClawService,
) {
```

3. **Replace the "not connected" guard (lines 360-378).** The existing code checks `if (!url)` which breaks OpenClaw mode. Replace with:

```typescript
const backend = this.devClawService.backendType;

// Connection guard — backend-aware
if (!this.devClawService.isConnected) {
	const backendName = backend === 'openclaw' ? 'OpenClaw' : 'CTRL-A';
	progress([{
		kind: 'markdownContent',
		content: new MarkdownString(
			`**${def.fullName}** is ready.\n\n` +
			`> ${persona}\n\n` +
			`---\n\n` +
			`${backendName} is not connected. Configure your connection in **DevClaw Settings** (gear icon in the sidebar).`
		),
	}]);
	return { metadata: {} };
}
```

4. **Replace the fetch block (lines 384-490)** with backend-aware routing:

```typescript
try {
	const localContext = await this.gatherLocalContext(message);
	const roleContext = persona ? `[Respond as ${def.fullName}: ${persona}]\n\n` : '';
	const capabilities = `[DEVCLAW IDE CAPABILITIES: ...]\n\n`; // keep existing
	const fullMessage = roleContext + capabilities + message + localContext;

	let streamedResponse = '';

	if (backend === 'openclaw') {
		// Route through IBackendClient (OpenClawClient)
		const client = this.devClawService.getClient();
		const response = await client.chat('ctrl-a', fullMessage);
		streamedResponse = response.response;
	} else {
		// CTRL-A path — existing fetch logic (lines 401-458)
		const url = this.storageService.get('devteam.ctrlA.url', StorageScope.APPLICATION, '');
		const apiKey = this.storageService.get('devteam.ctrlA.apiKey', StorageScope.APPLICATION, '');
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (apiKey) { headers['x-app-key'] = apiKey; }

		const controller = new AbortController();
		token.onCancellationRequested(() => controller.abort());

		const res = await fetch(`${url}/api/chat`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ message: fullMessage, agentId: 'ctrl-a' }),
			signal: controller.signal,
		});

		if (!res.ok) {
			let errorDetail = `${res.status} ${res.statusText}`;
			try {
				const errBody = await res.json();
				errorDetail = errBody.error || errorDetail;
			} catch { /* use status text */ }
			progress([{ kind: 'markdownContent', content: new MarkdownString(`**CTRL-A Error:** ${errorDetail}`) }]);
			return { metadata: {} };
		}

		const data = await res.json();

		// Show thinking (existing)
		if (data.thinking) { /* ... keep existing thinking block code ... */ }
		// Show tool calls (existing)
		if (data.toolCalls?.length > 0) { /* ... keep existing tool calls code ... */ }

		streamedResponse = data.response || data.message || 'No response from agent.';
	}

	// Show main response
	progress([{ kind: 'markdownContent', content: new MarkdownString(streamedResponse) }]);

	// Auto-apply code blocks (shared, both backends)
	const createdFiles = await this.autoApplyCodeBlocks(streamedResponse);
	if (createdFiles.length > 0) { /* ... keep existing file creation code ... */ }

	return { metadata: {} };
} catch (err) {
	// ... keep existing error handling
}
```

- [ ] **Step 2: Verify build**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/vs/workbench/contrib/devteam/browser/devclawAgents.ts
git commit -m "feat: devclawAgents routes through OpenClaw or CTRL-A based on backend config"
```

---

### Task 7: Update devclawAgent.ts (Node-side) for dual backend

**Files:**
- Modify: `src/vs/platform/agentHost/node/devclaw/devclawAgent.ts`

- [ ] **Step 1: Add OpenClaw support to _getConfig and sendMessage**

Changes:
1. Update `DevClawConfig` interface:
```typescript
interface DevClawConfig {
	backend: 'openclaw' | 'ctrl-a';
	// OpenClaw
	openclawUrl: string;
	openclawToken: string;
	// CTRL-A
	baseUrl: string;
	appKey: string;
}
```

2. Update `_getConfig()`:
```typescript
private _getConfig(): DevClawConfig {
	const backend = (process.env['DEVCLAW_BACKEND'] || 'openclaw') as 'openclaw' | 'ctrl-a';
	return {
		backend,
		openclawUrl: `http://127.0.0.1:${process.env['DEVCLAW_OPENCLAW_PORT'] || '18789'}`,
		openclawToken: process.env['DEVCLAW_OPENCLAW_TOKEN'] || '',
		baseUrl: process.env['DEVCLAW_CTRL_A_URL'] || 'http://localhost:3000',
		appKey: process.env['DEVCLAW_CTRL_A_APP_KEY'] || '',
	};
}
```

3. In `sendMessage()`, after building `fullMessage` (line 145), branch based on `config.backend`:
   - If `'openclaw'`: POST to `${config.openclawUrl}/v1/chat/completions` with Bearer token, OpenAI message format. Parse `choices[0].message.content`.
   - If `'ctrl-a'`: existing behavior (POST to `/api/chat` with `x-app-key`).

4. Update error messages to reference the correct backend name.

- [ ] **Step 2: Verify build**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/vs/platform/agentHost/node/devclaw/devclawAgent.ts
git commit -m "feat: devclawAgent (node-side) supports OpenClaw + CTRL-A via env vars"
```

---

## Chunk 4: UI — Settings Pane + Welcome Wizard + Registration

### Task 8: Update Settings Pane for dual backend

**Files:**
- Modify: `src/vs/workbench/contrib/devteam/browser/settingsPane.ts`

- [ ] **Step 1: Redesign settings pane layout**

Replace the `renderBody()` method (lines 55-113) with:

1. **Backend Section** (top):
   - Toggle: "OpenClaw" (default) | "CTRL-A Cloud"
   - Saves `devteam.backend` to storage

2. **OpenClaw Section** (shown when backend=openclaw):
   - Daemon status: "Running" / "Stopped" with colored indicator
   - Provider dropdown: Anthropic, OpenAI, MiniMax, OpenRouter
   - API Key input (password)
   - Restart button

3. **CTRL-A Section** (shown when backend=ctrl-a):
   - Server URL input
   - API Key input
   - Test Connection button (existing)

4. **Keep existing stubs** (Git, Database, MCP)

The mode toggle (cloud/local) at line 81 gets replaced by the backend toggle. The BYOK section merges into the OpenClaw section.

When backend changes: call `this.devClawService.reconnect()` to rebuild the client.

- [ ] **Step 2: Verify build**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/vs/workbench/contrib/devteam/browser/settingsPane.ts
git commit -m "feat: settings pane — backend toggle, OpenClaw daemon status, provider selection"
```

---

### Task 9: Create Welcome Wizard

**Files:**
- Create: `src/vs/workbench/contrib/devteam/browser/welcomeWizard.ts`

- [ ] **Step 1: Create the wizard**

```typescript
/*---------------------------------------------------------------------------------------------
 *  DevTeam IDE — Welcome Wizard
 *  First-launch overlay: collect BYOK key, start OpenClaw daemon.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IOpenClawDaemonService } from '../../../../platform/openclaw/common/openclawDaemon.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatViewId } from '../../chat/browser/chat.js';

const WIZARD_COMPLETE_KEY = 'devteam.wizardComplete';

const PROVIDERS = [
	{ id: 'anthropic', name: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
	{ id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
	{ id: 'minimax', name: 'MiniMax', placeholder: 'eyJ...' },
	{ id: 'openrouter', name: 'OpenRouter', placeholder: 'sk-or-...' },
] as const;

export class WelcomeWizardContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'devclaw.welcomeWizard';

	private overlay: HTMLElement | null = null;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IOpenClawDaemonService private readonly daemonService: IOpenClawDaemonService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
		super();

		// Only show if wizard hasn't been completed
		const complete = this.storageService.getBoolean(WIZARD_COMPLETE_KEY, StorageScope.APPLICATION, false);
		if (!complete) {
			// Delay slightly so the workbench has rendered
			setTimeout(() => this.show(), 500);
		}
	}

	private show(): void {
		this.overlay = document.createElement('div');
		this.overlay.className = 'devteam-wizard-overlay';

		const card = document.createElement('div');
		card.className = 'devteam-wizard-card';

		// Header
		const header = document.createElement('h1');
		header.className = 'devteam-wizard-header';
		header.textContent = 'Welcome to DevTeam';
		card.appendChild(header);

		const subtitle = document.createElement('p');
		subtitle.className = 'devteam-wizard-subtitle';
		subtitle.textContent = 'Your AI agent is ready. Add an API key to get started.';
		card.appendChild(subtitle);

		// Provider dropdown
		const providerRow = document.createElement('div');
		providerRow.className = 'devteam-wizard-row';
		const providerLabel = document.createElement('label');
		providerLabel.textContent = 'Provider';
		providerLabel.className = 'devteam-wizard-label';
		const providerSelect = document.createElement('select');
		providerSelect.className = 'devteam-wizard-select';
		for (const p of PROVIDERS) {
			const opt = document.createElement('option');
			opt.value = p.id;
			opt.textContent = p.name;
			providerSelect.appendChild(opt);
		}
		providerRow.appendChild(providerLabel);
		providerRow.appendChild(providerSelect);
		card.appendChild(providerRow);

		// API key input
		const keyRow = document.createElement('div');
		keyRow.className = 'devteam-wizard-row';
		const keyLabel = document.createElement('label');
		keyLabel.textContent = 'API Key';
		keyLabel.className = 'devteam-wizard-label';
		const keyInput = document.createElement('input');
		keyInput.type = 'password';
		keyInput.className = 'devteam-wizard-input';
		keyInput.placeholder = PROVIDERS[0].placeholder;
		keyRow.appendChild(keyLabel);
		keyRow.appendChild(keyInput);
		card.appendChild(keyRow);

		// Update placeholder on provider change
		providerSelect.addEventListener('change', () => {
			const provider = PROVIDERS.find(p => p.id === providerSelect.value);
			if (provider) { keyInput.placeholder = provider.placeholder; }
		});

		// Status area
		const status = document.createElement('div');
		status.className = 'devteam-wizard-status';
		card.appendChild(status);

		// Start button
		const startBtn = document.createElement('button');
		startBtn.className = 'devteam-wizard-btn-start';
		startBtn.textContent = 'Start';
		startBtn.addEventListener('click', () => this.handleStart(providerSelect.value, keyInput.value, startBtn, status));
		card.appendChild(startBtn);

		// Advanced settings link
		const advLink = document.createElement('a');
		advLink.className = 'devteam-wizard-link';
		advLink.textContent = 'Advanced settings';
		advLink.href = '#';
		advLink.addEventListener('click', (e) => {
			e.preventDefault();
			this.dismiss();
			// Open settings pane
			this.viewsService.openView('devteam.settingsView', true);
		});
		card.appendChild(advLink);

		// Styles
		const style = document.createElement('style');
		style.textContent = WIZARD_STYLES;
		this.overlay.appendChild(style);
		this.overlay.appendChild(card);
		document.body.appendChild(this.overlay);
	}

	private async handleStart(providerId: string, apiKey: string, btn: HTMLButtonElement, status: HTMLElement): Promise<void> {
		if (!apiKey.trim()) {
			status.textContent = 'Please enter an API key.';
			status.className = 'devteam-wizard-status error';
			return;
		}

		btn.disabled = true;
		btn.textContent = 'Starting your agent...';
		status.textContent = '';
		status.className = 'devteam-wizard-status';

		// Save key config
		const keyMap: Record<string, string> = {
			anthropic: 'anthropicKey',
			openai: 'openaiKey',
			minimax: 'minimaxKey',
			openrouter: 'openrouterKey',
		};

		try {
			// Install + start daemon with the provided key
			const config = await this.daemonService.install();

			// Update keys
			await this.daemonService.updateKeys({
				provider: providerId,
				[keyMap[providerId]]: apiKey,
			});

			// Save port + token to IDE storage (for DevClawService to read)
			this.storageService.store('devteam.openclaw.port', String(config.port), StorageScope.APPLICATION, StorageTarget.USER);
			this.storageService.store('devteam.openclaw.token', config.token, StorageScope.APPLICATION, StorageTarget.USER);
			this.storageService.store('devteam.backend', 'openclaw', StorageScope.APPLICATION, StorageTarget.USER);

			// Start daemon
			const started = await this.daemonService.start();
			if (!started) {
				status.textContent = 'Agent failed to start. Check ~/.openclaw/logs/ for details.';
				status.className = 'devteam-wizard-status error';
				btn.disabled = false;
				btn.textContent = 'Retry';
				return;
			}

			// Success! Mark wizard complete, dismiss, open chat
			this.storageService.store(WIZARD_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.USER);
			this.dismiss();
			await this.viewsService.openView(ChatViewId, true);
		} catch (err) {
			status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
			status.className = 'devteam-wizard-status error';
			btn.disabled = false;
			btn.textContent = 'Retry';
		}
	}

	private dismiss(): void {
		if (this.overlay) {
			this.overlay.remove();
			this.overlay = null;
		}
	}

	override dispose(): void {
		this.dismiss();
		super.dispose();
	}
}

const WIZARD_STYLES = `
	.devteam-wizard-overlay {
		position: fixed;
		inset: 0;
		z-index: 100000;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
	}
	.devteam-wizard-card {
		background: #0d0d1a;
		border: 1px solid #2a2a3e;
		border-radius: 12px;
		padding: 40px;
		max-width: 420px;
		width: 100%;
		text-align: center;
	}
	.devteam-wizard-header {
		color: #00d4ff;
		font-size: 22px;
		margin: 0 0 8px 0;
	}
	.devteam-wizard-subtitle {
		color: #808080;
		font-size: 13px;
		margin: 0 0 24px 0;
	}
	.devteam-wizard-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 16px;
		text-align: left;
	}
	.devteam-wizard-label {
		color: #808080;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.3px;
	}
	.devteam-wizard-select,
	.devteam-wizard-input {
		background: #1a1a2e;
		border: 1px solid #2a2a3e;
		border-radius: 4px;
		padding: 10px 12px;
		color: #e0e0e0;
		font-family: inherit;
		font-size: 13px;
		outline: none;
	}
	.devteam-wizard-select:focus,
	.devteam-wizard-input:focus {
		border-color: #00d4ff;
	}
	.devteam-wizard-btn-start {
		width: 100%;
		padding: 12px;
		background: #00d4ff;
		border: none;
		border-radius: 6px;
		color: #0d0d1a;
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		margin-top: 8px;
		transition: opacity 0.15s;
	}
	.devteam-wizard-btn-start:hover { opacity: 0.9; }
	.devteam-wizard-btn-start:disabled { opacity: 0.5; cursor: wait; }
	.devteam-wizard-status {
		font-size: 12px;
		min-height: 20px;
		margin: 8px 0;
		color: #808080;
	}
	.devteam-wizard-status.error { color: #f44336; }
	.devteam-wizard-link {
		display: inline-block;
		margin-top: 16px;
		color: #555;
		font-size: 12px;
		text-decoration: none;
	}
	.devteam-wizard-link:hover { color: #00d4ff; }
`;
```

- [ ] **Step 2: Verify build**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/vs/workbench/contrib/devteam/browser/welcomeWizard.ts
git commit -m "feat: first-launch wizard — BYOK key entry + daemon startup"
```

---

### Task 10: Update devteam.contribution.ts — register wizard + daemon

**Files:**
- Modify: `src/vs/workbench/contrib/devteam/browser/devteam.contribution.ts`

- [ ] **Step 1: Add wizard registration**

Add import and registration for the welcome wizard:
```typescript
import { WelcomeWizardContribution } from './welcomeWizard.js';
registerWorkbenchContribution2('devclaw.welcomeWizard', WelcomeWizardContribution, WorkbenchPhase.AfterRestored);
```

- [ ] **Step 2: Verify build**

Run: `npx gulp compile --max-old-space-size=8192 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/vs/workbench/contrib/devteam/browser/devteam.contribution.ts
git commit -m "feat: register welcome wizard contribution"
```

---

## Chunk 5: Bundle OpenClaw + Integration Test

### Task 11: Bundle OpenClaw into resources

**Files:**
- Create: `resources/openclaw/` (copied from `F:\lenovo backup\devStuff\openclaw-main`)

- [ ] **Step 1: Copy OpenClaw into the IDE resources**

```bash
cp -r "F:/lenovo backup/devStuff/openclaw-main" "C:/Users/bifil/OneDrive/Desktop/SaaSLand/DevTeam-ide-main/resources/openclaw"
```

- [ ] **Step 2: Add to .gitignore if too large, or commit key files**

Check size first:
```bash
du -sh "C:/Users/bifil/OneDrive/Desktop/SaaSLand/DevTeam-ide-main/resources/openclaw"
```

If too large for git (>100MB with node_modules): add `resources/openclaw/node_modules` to `.gitignore` and only commit the source. The build process will need to `npm install` in the resources dir.

- [ ] **Step 3: Verify OpenClaw can be started manually**

```bash
cd "C:/Users/bifil/OneDrive/Desktop/SaaSLand/DevTeam-ide-main/resources/openclaw"
node openclaw.mjs gateway --bind 127.0.0.1 --port 18800 2>&1 | head -10
```

Expected: Gateway starts and listens on port 18800

- [ ] **Step 4: Commit**

```bash
git add resources/openclaw/
git commit -m "feat: bundle OpenClaw v2026.3.30 in IDE resources"
```

---

### Task 12: Integration test — full flow

- [ ] **Step 1: Build the IDE**

```bash
cd "C:/Users/bifil/OneDrive/Desktop/SaaSLand/DevTeam-ide-main"
npx gulp compile --max-old-space-size=8192
```

Expected: Clean build, no errors

- [ ] **Step 2: Launch IDE and verify wizard appears**

```bash
./scripts/code.bat
```

Expected: IDE opens, wizard overlay shows "Welcome to DevTeam"

- [ ] **Step 3: Enter API key in wizard, click Start**

Expected: "Starting your agent..." → daemon starts → wizard closes → chat panel opens

- [ ] **Step 4: Send a chat message**

Type a message in the chat panel addressed to any agent.

Expected: Streaming response from OpenClaw via the embedded daemon

- [ ] **Step 5: Close IDE, verify daemon persists**

Close the IDE window. Check that the OpenClaw process is still running:
```bash
curl http://127.0.0.1:18789/health
```

Expected: Health check returns OK

- [ ] **Step 6: Reopen IDE, verify it reconnects**

Relaunch the IDE. Chat should work immediately without wizard.

- [ ] **Step 7: Test CTRL-A Cloud toggle**

Switch to CTRL-A Cloud in settings. Enter CTRL-A URL + key. Send a message.

Expected: Routes through CTRL-A instead of OpenClaw.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: OpenClaw Inside — v1 complete, embedded daemon + dual backend"
```

---

## Parallelization Guide

For agents executing this plan, here's what can run in parallel:

| Wave | Tasks | Dependencies |
|------|-------|-------------|
| 1 | Task 1, Task 3, Task 4a, Task 4 | None — all independent new files |
| 2 | Task 2 | Task 1 (needs backendClient.ts) |
| 3 | Task 5, Task 6, Task 7 | Tasks 1-3 (needs both clients + interface) |
| 4 | Task 8, Task 9, Task 10 | Task 4a + Task 5 (wizard needs daemon service + updated service) |
| 5 | Task 11, Task 12 | All previous tasks |

**Maximum parallelism:** 4 agents in Wave 1, then sequential waves.

## Notes for Implementers

- **Windows signals:** `SIGTERM`/`SIGKILL` behave differently on Windows. `process.kill('SIGTERM')` kills immediately (no graceful shutdown). `SIGKILL` may throw. The `stop()` timeout handles this.
- **Daemon logs:** With `detached: true` + `unref()`, piped log streams may close when IDE exits. The daemon's own logging (OpenClaw's internal logger) is the reliable source. The piped logs are for IDE-open debugging only.
- **System service registration** (Task Scheduler / launchd / systemd) is deferred to v1.1. For v1, `detached: true` keeps the daemon alive after IDE close, but it won't auto-start on reboot. This is acceptable for demo.
