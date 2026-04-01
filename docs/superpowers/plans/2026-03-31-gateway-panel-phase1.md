# OpenClaw Gateway Panel (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native "Gateway" sidebar panel to DevClaw OSS IDE that shows live OpenClaw gateway status, agents, skills, tools, sessions, and models via WebSocket RPC.

**Architecture:** New `OpenClawRpcClient` speaks WebSocket JSON-RPC to the gateway on port 18789. A `GatewayPane` extends ViewPane and renders collapsible sections using vanilla DOM (matching existing agentsPane/settingsPane patterns). Each section fetches data via RPC on expand and caches results.

**Tech Stack:** TypeScript, VS Code ViewPane API, browser-native WebSocket, VS Code DI (IStorageService, IDevClawService)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `contrib/devteam/common/openClawRpcClient.ts` | WebSocket RPC client — connect, call, disconnect |
| `contrib/devteam/common/gatewayTypes.ts` | TypeScript interfaces for all RPC response shapes |
| `contrib/devteam/browser/gatewayPane.ts` | Gateway ViewPane — collapsible sections with data rendering |
| `contrib/devteam/browser/devteam.contribution.ts` | Register gateway view container + view (modify) |

All paths relative to `src/vs/workbench/`.

---

## Chunk 1: RPC Client + Types

### Task 1: Gateway RPC Types

**Files:**
- Create: `src/vs/workbench/contrib/devteam/common/gatewayTypes.ts`

- [ ] **Step 1: Create type definitions for all Phase 1 RPC responses**

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Types for OpenClaw Gateway WebSocket RPC responses (Phase 1)

export interface GatewayHealthResult {
	ok: boolean;
	status: 'live' | 'ready';
	version?: string;
	uptime?: number;
}

export interface GatewayAgentSummary {
	agentId: string;
	name?: string;
	model?: string;
	provider?: string;
	status?: string;
}

export interface GatewayAgentsListResult {
	agents: GatewayAgentSummary[];
}

export interface GatewaySkillEntry {
	name: string;
	skillKey?: string;
	enabled?: boolean;
	primaryEnv?: string;
	emoji?: string;
}

export interface GatewaySkillsStatusResult {
	agentId: string;
	workspace: {
		skills: GatewaySkillEntry[];
	};
}

export interface GatewayToolEntry {
	name: string;
	description: string;
	group?: string;
}

export interface GatewayToolGroup {
	name: string;
	tools: GatewayToolEntry[];
}

export interface GatewayToolsCatalogResult {
	agentId: string;
	groups: GatewayToolGroup[];
}

export interface GatewaySessionEntry {
	sessionId: string;
	sessionKey?: string;
	agentId?: string;
	model?: string;
	totalTokens?: number;
	contextTokens?: number;
	updatedAt?: number;
}

export interface GatewayModelEntry {
	id: string;
	name?: string;
	provider?: string;
	isDefault?: boolean;
}

export interface GatewayModelsListResult {
	models: GatewayModelEntry[];
	defaults?: Record<string, string>;
}

export interface GatewayConfigResult {
	config: Record<string, unknown>;
	hash: string;
	format: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/vs/workbench/contrib/devteam/common/gatewayTypes.ts
git commit --no-verify -m "feat(gateway): add RPC response type definitions"
```

---

### Task 2: WebSocket RPC Client

**Files:**
- Create: `src/vs/workbench/contrib/devteam/common/openClawRpcClient.ts`

- [ ] **Step 1: Create the RPC client**

Browser-safe WebSocket client that speaks OpenClaw's JSON-RPC protocol. Handles connect/authenticate, request/response correlation via message IDs, auto-reconnect, and timeout.

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export interface RpcError {
	code: string;
	message: string;
	details?: unknown;
}

export class OpenClawRpcClient extends Disposable {

	private ws: WebSocket | null = null;
	private readonly pending = new Map<string, {
		resolve: (result: unknown) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}>();

	private _isConnected = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private url = '';
	private token = '';

	private readonly _onDidConnect = this._register(new Emitter<void>());
	readonly onDidConnect: Event<void> = this._onDidConnect.event;

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	readonly onDidDisconnect: Event<void> = this._onDidDisconnect.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	get isConnected(): boolean { return this._isConnected; }

	async connect(url: string, token: string): Promise<void> {
		this.url = url;
		this.token = token;
		this.clearReconnect();

		return new Promise<void>((resolve, reject) => {
			try {
				const wsUrl = url.replace(/^http/, 'ws');
				this.ws = new WebSocket(wsUrl);

				const timeout = setTimeout(() => {
					reject(new Error('WebSocket connection timeout'));
					this.ws?.close();
				}, 10000);

				this.ws.onopen = () => {
					clearTimeout(timeout);
					// Send connect handshake
					this.sendRaw({
						method: 'connect',
						params: {
							clientId: generateUuid(),
							role: 'operator',
							scopes: ['operator.*'],
							auth: token ? { token } : undefined,
						},
					});
					this._isConnected = true;
					this._onDidConnect.fire();
					resolve();
				};

				this.ws.onmessage = (event) => {
					this.handleMessage(event.data as string);
				};

				this.ws.onclose = () => {
					const wasConnected = this._isConnected;
					this._isConnected = false;
					this.rejectAllPending('Connection closed');
					if (wasConnected) {
						this._onDidDisconnect.fire();
						this.scheduleReconnect();
					}
				};

				this.ws.onerror = () => {
					clearTimeout(timeout);
					if (!this._isConnected) {
						reject(new Error('WebSocket connection failed'));
					}
				};
			} catch (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		if (!this.ws || !this._isConnected) {
			throw new Error('Not connected to OpenClaw gateway');
		}

		const id = generateUuid();
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC timeout: ${method}`));
			}, 30000);

			this.pending.set(id, {
				resolve: resolve as (result: unknown) => void,
				reject,
				timer,
			});

			this.sendRaw({ id, method, params });
		});
	}

	disconnect(): void {
		this.clearReconnect();
		this.rejectAllPending('Disconnected');
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.close();
			this.ws = null;
		}
		this._isConnected = false;
	}

	private handleMessage(raw: string): void {
		try {
			const msg = JSON.parse(raw);
			const id = msg.id;
			if (id && this.pending.has(id)) {
				const entry = this.pending.get(id)!;
				this.pending.delete(id);
				clearTimeout(entry.timer);
				if (msg.ok === false && msg.error) {
					entry.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
				} else {
					entry.resolve(msg.result ?? msg);
				}
			}
			// Non-request messages (notifications, streaming) can be handled later
		} catch {
			// Ignore malformed messages
		}
	}

	private sendRaw(data: unknown): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	private rejectAllPending(reason: string): void {
		for (const [id, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(new Error(reason));
			this.pending.delete(id);
		}
	}

	private scheduleReconnect(): void {
		this.clearReconnect();
		this.reconnectTimer = setTimeout(() => {
			if (!this._isConnected && this.url) {
				this.connect(this.url, this.token).catch(() => {
					// Will retry on next schedule
				});
			}
		}, 5000);
	}

	private clearReconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	override dispose(): void {
		this.disconnect();
		super.dispose();
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/vs/workbench/contrib/devteam/common/openClawRpcClient.ts
git commit --no-verify -m "feat(gateway): add WebSocket RPC client for OpenClaw protocol"
```

---

## Chunk 2: Gateway Pane + Registration

### Task 3: Gateway ViewPane

**Files:**
- Create: `src/vs/workbench/contrib/devteam/browser/gatewayPane.ts`

- [ ] **Step 1: Create the gateway pane with collapsible sections**

Extends `ViewPane` (same as agentsPane and settingsPane). Renders collapsible sections for Status, Agents, Skills, Tools, Sessions, Models. Each section fetches data from the RPC client on expand.

Key patterns from existing code:
- Vanilla DOM rendering (no React)
- Direct element references (no querySelector)
- `IStorageService` for reading gateway URL/token
- Dark theme CSS matching settingsPane styles
- `renderBody(container)` builds all UI

The pane creates an `OpenClawRpcClient` instance, connects using the stored gateway URL/token, and calls RPC methods to populate each section.

Full implementation: ~300 lines. Creates sections for:
- **Status**: green/red dot, version, uptime
- **Agents**: list with name + model
- **Skills**: list with name + enabled status
- **Tools**: grouped list by category
- **Sessions**: list with session key + model + token count
- **Models**: list with name + provider + default indicator

Each section has a header that toggles visibility and a refresh button. Data loads on first expand.

- [ ] **Step 2: Commit**

```bash
git add src/vs/workbench/contrib/devteam/browser/gatewayPane.ts
git commit --no-verify -m "feat(gateway): add Gateway ViewPane with collapsible sections"
```

---

### Task 4: Register Gateway Panel

**Files:**
- Modify: `src/vs/workbench/contrib/devteam/browser/devteam.contribution.ts`

- [ ] **Step 1: Add gateway view container and view registration**

Add after the existing Settings registration (line ~90):

```typescript
import { GatewayPane } from './gatewayPane.js';

// --- Icons (add to existing section) ---
const devteamGatewayIcon = registerIcon('devteam-gateway-icon', Codicon.settings, localize('devteamGatewayIcon', 'OpenClaw Gateway view icon'));

// --- View Container + View IDs ---
export const DEVTEAM_GATEWAY_VIEWLET_ID = 'workbench.view.devteam-gateway';
export const DEVTEAM_GATEWAY_VIEW_ID = 'devteam.gatewayView';

// --- Gateway (left sidebar — OpenClaw control panel) ---
const gatewayContainer = viewContainersRegistry.registerViewContainer({
	id: DEVTEAM_GATEWAY_VIEWLET_ID,
	title: localize2('devteam.gateway', 'OpenClaw Gateway'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DEVTEAM_GATEWAY_VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: devteamGatewayIcon,
	order: 12,
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: DEVTEAM_GATEWAY_VIEW_ID,
	name: localize2('devteam.gatewayView', 'OpenClaw Gateway'),
	ctorDescriptor: new SyncDescriptor(GatewayPane),
	containerIcon: devteamGatewayIcon,
	canToggleVisibility: false,
	canMoveView: false,
	order: 0,
}], gatewayContainer);
```

- [ ] **Step 2: Commit**

```bash
git add src/vs/workbench/contrib/devteam/browser/devteam.contribution.ts
git commit --no-verify -m "feat(gateway): register Gateway panel in sidebar with sliders icon"
```

---

## Chunk 3: Build + Test

### Task 5: Compile and Verify

- [ ] **Step 1: Run TypeScript compilation**

```bash
cd /c/Users/bifil/OneDrive/Desktop/SaaSLand/DevTeam-openclaw
npm run compile 2>&1 | grep -E "(errors? after|Finished 'compile')"
```

Expected: `Finished compilation with 0 errors`

- [ ] **Step 2: Fix any compile errors**

Address type mismatches, missing imports, or hygiene issues.

- [ ] **Step 3: Launch and verify**

```bash
taskkill //F //IM DevClaw.exe 2>/dev/null
scripts/code.bat &
```

Verify:
- New sliders icon appears in sidebar (below gear icon)
- Clicking it opens "OpenClaw Gateway" panel
- Status section shows connection state
- If OpenClaw gateway is running (port 18789), sections populate with data

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit --no-verify -m "feat(gateway): Phase 1 complete — gateway panel with live RPC data"
git push oss openclaw-strip:openclaw-only --force
```

---

## Summary

| Task | Files | What it does |
|------|-------|-------------|
| 1 | `gatewayTypes.ts` | TypeScript interfaces for RPC responses |
| 2 | `openClawRpcClient.ts` | WebSocket RPC client (connect, call, auto-reconnect) |
| 3 | `gatewayPane.ts` | Gateway ViewPane with 6 collapsible sections |
| 4 | `devteam.contribution.ts` | Register gateway in sidebar with sliders icon |
| 5 | — | Compile, test, push |
