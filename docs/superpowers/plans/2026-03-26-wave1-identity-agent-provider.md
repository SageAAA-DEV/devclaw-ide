# Wave 1: Identity, Branding & Agent Provider — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all Copilot SDK dependencies, rebrand to SageAAA/DevClaw, and replace the CopilotAgent with a DevClawAgent backed by the CTRL-A REST API.

**Architecture:** The AgentService is provider-agnostic — it dispatches to registered IAgent implementations. We delete the 3 Copilot files, create 3 DevClaw files implementing the same IAgent interface, and swap the registration. Build system copilot references are removed. Package/product JSON are rebranded.

**Tech Stack:** TypeScript, VS Code extension API, Node.js (http/https for REST in utility process), existing CTRL-A REST API

**Spec:** `docs/superpowers/specs/2026-03-26-wave1-identity-agent-provider-design.md`

---

## Chunk 1: Identity & Branding

### Task 1: Rebrand package.json files

**Files:**
- Modify: `package.json:5-8` (author, repo, bugs)
- Modify: `package.json:84-85` (remove copilot deps)
- Modify: `remote/package.json:7-8` (remove copilot deps)

- [ ] **Step 1: Update root package.json author and repo**

Change author from Microsoft Corporation to SageAAA, Inc. Change repository and bugs URLs.

```json
"author": {
  "name": "SageAAA, Inc."
},
```

```json
"repository": {
  "type": "git",
  "url": "https://github.com/sageaaa/devclaw.git"
},
"bugs": {
  "url": "https://github.com/sageaaa/devclaw/issues"
},
```

- [ ] **Step 2: Remove @github/copilot deps from root package.json**

Remove these two lines from `dependencies`:
```
"@github/copilot": "^1.0.4-0",
"@github/copilot-sdk": "^0.1.32",
```

- [ ] **Step 3: Remove @github/copilot deps from remote/package.json**

Remove these two lines from `dependencies`:
```
"@github/copilot": "^1.0.4-0",
"@github/copilot-sdk": "^0.1.32",
```

- [ ] **Step 4: Commit**

```bash
git add package.json remote/package.json
git commit -m "chore: rebrand to SageAAA, remove @github/copilot dependencies"
```

---

### Task 2: Add Copilot extension blocking to product.json

**Files:**
- Modify: `product.json` (add cannotImportExtensions after urlProtocol line)

- [ ] **Step 1: Add cannotImportExtensions to product.json**

Add after the `"enableTelemetry": false,` line:

```json
"cannotImportExtensions": [
    "github.copilot",
    "github.copilot-chat"
],
```

- [ ] **Step 2: Commit**

```bash
git add product.json
git commit -m "chore: block Copilot extension imports"
```

---

## Chunk 2: Build System Cleanup

### Task 3: Delete Copilot build files

**Files:**
- Delete: `build/lib/copilot.ts`
- Delete: `build/azure-pipelines/common/checkCopilotChatCompatibility.ts`

- [ ] **Step 1: Delete copilot build files**

```bash
rm build/lib/copilot.ts
rm build/azure-pipelines/common/checkCopilotChatCompatibility.ts
```

- [ ] **Step 2: Commit**

```bash
git add -u build/lib/copilot.ts build/azure-pipelines/common/checkCopilotChatCompatibility.ts
git commit -m "chore: delete copilot build scripts"
```

---

### Task 4: Clean copilot references from gulpfiles and build scripts

**Files:**
- Modify: `build/gulpfile.vscode.ts:34,441,448,685-696,725`
- Modify: `build/gulpfile.reh.ts:37,347,466-469,522`
- Modify: `build/darwin/create-universal-app.ts:60-63,71-78,88`
- Modify: `build/darwin/verify-macho.ts:30-36`
- Modify: `build/npm/postinstall.ts:292-302`
- Modify: `build/.moduleignore:192-215`

- [ ] **Step 1: Clean build/gulpfile.vscode.ts**

Remove the import on line 34:
```typescript
import { getCopilotExcludeFilter, copyCopilotNativeDeps } from './lib/copilot.ts';
```

Remove the `.pipe(filter(getCopilotExcludeFilter(platform, arch)))` call on line 441.

Remove the glob pattern `'**/@github/copilot-*/**'` from any exclude arrays (line 448).

Remove the entire `copyCopilotNativeDepsTask` function (lines 685-696 approx).

Remove the `copyCopilotNativeDepsTask(platform, arch, destinationFolderName)` call from the task pipeline (line 725).

- [ ] **Step 2: Clean build/gulpfile.reh.ts**

Same pattern — remove the import (line 37), the filter pipe (line 347), the `copyCopilotNativeDepsTaskREH` function (lines 466-469), and the task pipeline call (line 522).

- [ ] **Step 3: Clean build/darwin/create-universal-app.ts**

Remove the copilot-specific `crossCopyPlatformDir` calls (lines 60-63).

Remove all copilot glob patterns from the `filesToSkip` array (lines 71-78).

Remove copilot entries from the `x64ArchFiles` glob string (line 88).

- [ ] **Step 4: Clean build/darwin/verify-macho.ts**

Remove all 6 copilot glob patterns from the allowlist (lines 30-36).

- [ ] **Step 5: Clean build/npm/postinstall.ts**

Remove the entire `@github/copilot-sdk` ESM patch block (lines 292-302 approx).

- [ ] **Step 6: Clean build/.moduleignore**

Remove all lines from `# @github/copilot` comment through the last `copilot-sdk` entry (lines 192-215).

- [ ] **Step 7: Verify build compiles**

```bash
cd build && npm run typecheck
```

Expected: No errors related to copilot imports.

- [ ] **Step 8: Commit**

```bash
git add build/
git commit -m "chore: remove all copilot references from build system"
```

---

## Chunk 3: Delete Copilot Agent, Create DevClaw Agent

### Task 5: Delete Copilot agent files

**Files:**
- Delete: `src/vs/platform/agentHost/node/copilot/copilotAgent.ts`
- Delete: `src/vs/platform/agentHost/node/copilot/copilotSessionWrapper.ts`
- Delete: `src/vs/platform/agentHost/node/copilot/copilotToolDisplay.ts`

- [ ] **Step 1: Delete the copilot directory**

```bash
rm -rf src/vs/platform/agentHost/node/copilot/
```

- [ ] **Step 2: Commit**

```bash
git add -u src/vs/platform/agentHost/node/copilot/
git commit -m "chore: delete CopilotAgent implementation"
```

---

### Task 6: Create DevClaw tool display

**Files:**
- Create: `src/vs/platform/agentHost/node/devclaw/devclawToolDisplay.ts`

- [ ] **Step 1: Create devclawToolDisplay.ts**

This file maps tool names to human-readable display strings. Same structure as the deleted copilotToolDisplay.ts but with DevClaw branding.

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA, Inc. All rights reserved.
 *  Licensed under the Proprietary License.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

const enum DevClawToolName {
	Bash = 'bash',
	ReadBash = 'read_bash',
	WriteBash = 'write_bash',
	BashShutdown = 'bash_shutdown',
	ListBash = 'list_bash',
	PowerShell = 'powershell',
	ReadPowerShell = 'read_powershell',
	WritePowerShell = 'write_powershell',
	ListPowerShell = 'list_powershell',
	View = 'view',
	Edit = 'edit',
	Write = 'write',
	Grep = 'grep',
	Glob = 'glob',
	Patch = 'patch',
	WebSearch = 'web_search',
	AskUser = 'ask_user',
	ReportIntent = 'report_intent',
}

interface IShellToolArgs {
	command: string;
	timeout?: number;
}

interface IFileToolArgs {
	file_path: string;
}

interface IGrepToolArgs {
	pattern: string;
	path?: string;
	include?: string;
}

interface IGlobToolArgs {
	pattern: string;
	path?: string;
}

const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
	DevClawToolName.Bash,
	DevClawToolName.PowerShell,
]);

const HIDDEN_TOOL_NAMES: ReadonlySet<string> = new Set([
	DevClawToolName.ReportIntent,
]);

export function isHiddenTool(toolName: string): boolean {
	return HIDDEN_TOOL_NAMES.has(toolName);
}

export function getToolDisplayName(toolName: string): string {
	switch (toolName) {
		case DevClawToolName.Bash:
		case DevClawToolName.PowerShell:
			return localize('tool.terminal', "Terminal");
		case DevClawToolName.ReadBash:
		case DevClawToolName.ReadPowerShell:
			return localize('tool.readTerminal', "Read Terminal");
		case DevClawToolName.WriteBash:
		case DevClawToolName.WritePowerShell:
			return localize('tool.writeTerminal', "Write to Terminal");
		case DevClawToolName.BashShutdown:
			return localize('tool.stopTerminal', "Stop Terminal");
		case DevClawToolName.ListBash:
		case DevClawToolName.ListPowerShell:
			return localize('tool.listTerminals', "List Terminals");
		case DevClawToolName.View:
			return localize('tool.readFile', "Read File");
		case DevClawToolName.Edit:
			return localize('tool.editFile', "Edit File");
		case DevClawToolName.Write:
			return localize('tool.createFile', "Create File");
		case DevClawToolName.Grep:
			return localize('tool.search', "Search");
		case DevClawToolName.Glob:
			return localize('tool.findFiles', "Find Files");
		case DevClawToolName.Patch:
			return localize('tool.patchFile', "Patch File");
		case DevClawToolName.WebSearch:
			return localize('tool.webSearch', "Web Search");
		case DevClawToolName.AskUser:
			return localize('tool.askUser', "Ask User");
		default:
			return toolName;
	}
}

export function getToolKind(toolName: string): 'terminal' | 'file' | 'search' | 'other' {
	if (SHELL_TOOL_NAMES.has(toolName)) {
		return 'terminal';
	}
	switch (toolName) {
		case DevClawToolName.View:
		case DevClawToolName.Edit:
		case DevClawToolName.Write:
		case DevClawToolName.Patch:
			return 'file';
		case DevClawToolName.Grep:
		case DevClawToolName.Glob:
		case DevClawToolName.WebSearch:
			return 'search';
		default:
			return 'other';
	}
}

export function getShellLanguage(toolName: string): string | undefined {
	if (toolName === DevClawToolName.PowerShell) {
		return 'powershell';
	}
	if (SHELL_TOOL_NAMES.has(toolName)) {
		return 'shellscript';
	}
	return undefined;
}

export function getInvocationMessage(toolName: string, displayName: string, parameters: Record<string, unknown> | undefined): string {
	if (SHELL_TOOL_NAMES.has(toolName) && parameters) {
		const cmd = (parameters as unknown as IShellToolArgs).command;
		if (cmd) {
			const short = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
			return localize('invocation.runCommand', "Running `{0}`", short);
		}
	}
	switch (toolName) {
		case DevClawToolName.Edit:
		case DevClawToolName.View:
		case DevClawToolName.Write:
		case DevClawToolName.Patch: {
			const filePath = (parameters as unknown as IFileToolArgs | undefined)?.file_path;
			if (filePath) {
				const fileName = filePath.split('/').pop() || filePath;
				return localize('invocation.fileOp', "{0} `{1}`", displayName, fileName);
			}
			return displayName;
		}
		case DevClawToolName.Grep: {
			const pattern = (parameters as unknown as IGrepToolArgs | undefined)?.pattern;
			if (pattern) {
				return localize('invocation.search', "Searching for `{0}`", pattern);
			}
			return displayName;
		}
		case DevClawToolName.Glob: {
			const pattern = (parameters as unknown as IGlobToolArgs | undefined)?.pattern;
			if (pattern) {
				return localize('invocation.findFiles', "Finding files matching `{0}`", pattern);
			}
			return displayName;
		}
		default:
			return displayName;
	}
}

export function getPastTenseMessage(toolName: string, displayName: string, parameters: Record<string, unknown> | undefined, success: boolean): string {
	if (!success) {
		return localize('pastTense.failed', "{0} failed", displayName);
	}
	if (SHELL_TOOL_NAMES.has(toolName) && parameters) {
		const cmd = (parameters as unknown as IShellToolArgs).command;
		if (cmd) {
			const short = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
			return localize('pastTense.ranCommand', "Ran `{0}`", short);
		}
	}
	switch (toolName) {
		case DevClawToolName.Edit:
		case DevClawToolName.Patch: {
			const filePath = (parameters as unknown as IFileToolArgs | undefined)?.file_path;
			const fileName = filePath?.split('/').pop() || '';
			return fileName ? localize('pastTense.edited', "Edited `{0}`", fileName) : localize('pastTense.editedFile', "Edited file");
		}
		case DevClawToolName.View: {
			const filePath = (parameters as unknown as IFileToolArgs | undefined)?.file_path;
			const fileName = filePath?.split('/').pop() || '';
			return fileName ? localize('pastTense.read', "Read `{0}`", fileName) : localize('pastTense.readFile', "Read file");
		}
		case DevClawToolName.Write: {
			const filePath = (parameters as unknown as IFileToolArgs | undefined)?.file_path;
			const fileName = filePath?.split('/').pop() || '';
			return fileName ? localize('pastTense.created', "Created `{0}`", fileName) : localize('pastTense.createdFile', "Created file");
		}
		case DevClawToolName.Grep:
			return localize('pastTense.searched', "Search complete");
		case DevClawToolName.Glob:
			return localize('pastTense.foundFiles', "Found files");
		default:
			return displayName;
	}
}

export function getToolInputString(toolName: string, parameters: Record<string, unknown> | undefined, rawArgs: string | undefined): string | undefined {
	if (SHELL_TOOL_NAMES.has(toolName) && parameters) {
		return (parameters as unknown as IShellToolArgs).command;
	}
	return rawArgs;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/vs/platform/agentHost/node/devclaw/
git commit -m "feat: add DevClaw tool display module"
```

---

### Task 7: Create DevClaw agent provider

**Files:**
- Create: `src/vs/platform/agentHost/node/devclaw/devclawAgent.ts`

- [ ] **Step 1: Create devclawAgent.ts**

This implements the full IAgent interface, routing to CTRL-A backend via REST.

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) SageAAA, Inc. All rights reserved.
 *  Licensed under the Proprietary License.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import type { IAuthorizationProtectedResourceMetadata } from '../../../../base/common/oauth.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import {
	AgentSession, IAgent, IAgentAttachment, IAgentCreateSessionConfig,
	IAgentDescriptor, IAgentMessageEvent, IAgentModelInfo,
	IAgentProgressEvent, IAgentSessionMetadata,
	IAgentToolCompleteEvent, IAgentToolStartEvent,
} from '../../common/agentService.js';
import { PermissionKind } from '../../common/state/sessionState.js';
import { getInvocationMessage, getPastTenseMessage, getShellLanguage, getToolDisplayName, getToolKind, getToolInputString, isHiddenTool } from './devclawToolDisplay.js';

function tryStringify(value: unknown): string | undefined {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

interface DevClawConfig {
	baseUrl: string;
	apiKey: string;
}

/**
 * Agent provider backed by the CTRL-A backend via REST API.
 * Replaces CopilotAgent as the registered IAgent in the agent host.
 */
export class DevClawAgent extends Disposable implements IAgent {
	readonly id = 'devclaw' as const;

	private readonly _onDidSessionProgress = this._register(new Emitter<IAgentProgressEvent>());
	readonly onDidSessionProgress = this._onDidSessionProgress.event;

	private readonly _sessions = this._register(new DisposableMap<string, DevClawSession>());
	private readonly _pendingPermissions = new Map<string, { sessionId: string; deferred: DeferredPromise<boolean> }>();

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	// ---- descriptor & auth ---------------------------------------------------

	getDescriptor(): IAgentDescriptor {
		return {
			provider: 'devclaw',
			displayName: 'Agent Host - DevClaw',
			description: 'CTRL-A agent team running via REST API',
			requiresAuth: false,
		};
	}

	getProtectedResources(): IAuthorizationProtectedResourceMetadata[] {
		return [];
	}

	async authenticate(_resource: string, _token: string): Promise<boolean> {
		return true;
	}

	// ---- config --------------------------------------------------------------

	private _getConfig(): DevClawConfig {
		// Read from environment or .devclaw config
		const baseUrl = process.env['DEVCLAW_CTRL_A_URL'] || 'http://localhost:3000';
		const apiKey = process.env['DEVCLAW_CTRL_A_API_KEY'] || '';
		return { baseUrl, apiKey };
	}

	private _isConfigured(): boolean {
		const config = this._getConfig();
		return !!config.baseUrl && config.baseUrl !== 'http://localhost:3000';
	}

	// ---- session management --------------------------------------------------

	async listSessions(): Promise<IAgentSessionMetadata[]> {
		// In-memory sessions only for now — no persistence
		const result: IAgentSessionMetadata[] = [];
		for (const [id, session] of this._sessions) {
			result.push({
				session: AgentSession.uri(this.id, id),
				startTime: session.startTime,
				modifiedTime: Date.now(),
				summary: session.lastMessage,
			});
		}
		return result;
	}

	async listModels(): Promise<IAgentModelInfo[]> {
		return [
			{ provider: this.id, id: 'ctrl-a', name: 'CTRL-A (Router)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
			{ provider: this.id, id: 'devin', name: 'Devin (Lead Engineer)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
			{ provider: this.id, id: 'scout', name: 'Scout (Researcher)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
			{ provider: this.id, id: 'sage', name: 'Sage (Code Reviewer)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
			{ provider: this.id, id: 'ink', name: 'Ink (Technical Writer)', maxContextWindow: 128000, supportsVision: false, supportsReasoningEffort: false },
		];
	}

	async createSession(config?: IAgentCreateSessionConfig): Promise<URI> {
		const sessionId = config?.session ? AgentSession.id(config.session) : generateUuid();
		this._logService.info(`[DevClaw] Creating session: ${sessionId}`);

		const session = new DevClawSession(sessionId, config?.model || 'ctrl-a');
		this._sessions.set(sessionId, session);

		const uri = AgentSession.uri(this.id, sessionId);
		this._logService.info(`[DevClaw] Session created: ${uri.toString()}`);
		return uri;
	}

	async sendMessage(sessionUri: URI, prompt: string, attachments?: IAgentAttachment[]): Promise<void> {
		const sessionId = AgentSession.id(sessionUri);
		const session = this._sessions.get(sessionId);
		if (!session) {
			this._logService.error(`[DevClaw:${sessionId}] Session not found`);
			return;
		}

		const config = this._getConfig();
		if (!this._isConfigured()) {
			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'message',
				role: 'assistant',
				messageId: generateUuid(),
				content: 'CTRL-A is not connected. Set the `DEVCLAW_CTRL_A_URL` and `DEVCLAW_CTRL_A_API_KEY` environment variables, or configure your connection in DevClaw Settings.',
			});
			this._onDidSessionProgress.fire({ session: sessionUri, type: 'idle' });
			return;
		}

		// Build context from attachments
		let fullMessage = prompt;
		if (attachments?.length) {
			const parts = attachments.map(a => {
				if (a.type === 'selection' && a.text) {
					return `[Selection from ${a.path}]:\n${a.text}`;
				}
				return `[File: ${a.path}]`;
			});
			fullMessage += '\n\n' + parts.join('\n');
		}

		session.lastMessage = prompt.substring(0, 200);

		try {
			const { default: http } = await import('http');
			const { default: https } = await import('https');
			const url = new URL(`${config.baseUrl}/api/chat`);
			const transport = url.protocol === 'https:' ? https : http;

			const body = JSON.stringify({
				message: fullMessage,
				agentId: session.agentId,
			});

			const response = await new Promise<string>((resolve, reject) => {
				const req = transport.request(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': config.apiKey,
					},
				}, (res) => {
					let data = '';
					res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
					res.on('end', () => {
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							resolve(data);
						} else {
							reject(new Error(`CTRL-A API error: ${res.statusCode} ${res.statusMessage}`));
						}
					});
				});
				req.on('error', reject);
				req.write(body);
				req.end();
			});

			const data = JSON.parse(response);
			const content = data.response || data.message || 'No response from agent.';

			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'message',
				role: 'assistant',
				messageId: generateUuid(),
				content,
			});
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[DevClaw:${sessionId}] Error: ${errorMsg}`);
			this._onDidSessionProgress.fire({
				session: sessionUri,
				type: 'error',
				errorType: 'connection',
				message: `Connection error: ${errorMsg}. Check your CTRL-A connection.`,
			});
		}

		this._onDidSessionProgress.fire({ session: sessionUri, type: 'idle' });
	}

	async getSessionMessages(_session: URI): Promise<(IAgentMessageEvent | IAgentToolStartEvent | IAgentToolCompleteEvent)[]> {
		return [];
	}

	async disposeSession(session: URI): Promise<void> {
		const sessionId = AgentSession.id(session);
		this._sessions.deleteAndDispose(sessionId);
		this._denyPendingPermissionsForSession(sessionId);
	}

	async abortSession(_session: URI): Promise<void> {
		// No long-running requests to abort in REST mode
	}

	async changeModel(session: URI, model: string): Promise<void> {
		const sessionId = AgentSession.id(session);
		const entry = this._sessions.get(sessionId);
		if (entry) {
			this._logService.info(`[DevClaw:${sessionId}] Changing agent to: ${model}`);
			entry.agentId = model;
		}
	}

	respondToPermissionRequest(requestId: string, approved: boolean): void {
		const entry = this._pendingPermissions.get(requestId);
		if (entry) {
			this._pendingPermissions.delete(requestId);
			entry.deferred.complete(approved);
		}
	}

	hasSession(session: URI): boolean {
		return this._sessions.has(AgentSession.id(session));
	}

	async shutdown(): Promise<void> {
		this._logService.info('[DevClaw] Shutting down...');
		this._sessions.clearAndDisposeAll();
		this._denyPendingPermissions();
	}

	// ---- internal ------------------------------------------------------------

	private _denyPendingPermissions(): void {
		for (const [, entry] of this._pendingPermissions) {
			entry.deferred.complete(false);
		}
		this._pendingPermissions.clear();
	}

	private _denyPendingPermissionsForSession(sessionId: string): void {
		for (const [requestId, entry] of this._pendingPermissions) {
			if (entry.sessionId === sessionId) {
				entry.deferred.complete(false);
				this._pendingPermissions.delete(requestId);
			}
		}
	}

	override dispose(): void {
		this._denyPendingPermissions();
		super.dispose();
	}
}

/** Lightweight session state. */
class DevClawSession {
	readonly startTime = Date.now();
	lastMessage = '';

	constructor(
		readonly sessionId: string,
		public agentId: string,
	) { }

	dispose(): void { }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/vs/platform/agentHost/node/devclaw/
git commit -m "feat: add DevClawAgent — CTRL-A backed IAgent provider"
```

---

### Task 8: Swap agent registration in entry points

**Files:**
- Modify: `src/vs/platform/agentHost/node/agentHostMain.ts:16,34,68`
- Modify: `src/vs/platform/agentHost/node/agentHostServerMain.ts:31,177-179`

- [ ] **Step 1: Update agentHostMain.ts**

Line 16 — change import:
```diff
- import { CopilotAgent } from './copilot/copilotAgent.js';
+ import { DevClawAgent } from './devclaw/devclawAgent.js';
```

Line 34 — update comment:
```diff
- // Sets up IPC, logging, and registers agent providers (Copilot).
+ // Sets up IPC, logging, and registers agent providers (DevClaw).
```

Line 68 — swap registration:
```diff
- agentService.registerProvider(new CopilotAgent(logService));
+ agentService.registerProvider(new DevClawAgent(logService));
```

- [ ] **Step 2: Update agentHostServerMain.ts**

Line 31 — change import:
```diff
- import { CopilotAgent } from './copilot/copilotAgent.js';
+ import { DevClawAgent } from './devclaw/devclawAgent.js';
```

Lines 177-179 — swap registration:
```diff
- const copilotAgent = disposables.add(instantiationService.createInstance(CopilotAgent));
- registerAgent(copilotAgent);
- log('CopilotAgent registered');
+ const devclawAgent = disposables.add(instantiationService.createInstance(DevClawAgent));
+ registerAgent(devclawAgent);
+ log('DevClawAgent registered');
```

- [ ] **Step 3: Commit**

```bash
git add src/vs/platform/agentHost/node/agentHostMain.ts src/vs/platform/agentHost/node/agentHostServerMain.ts
git commit -m "feat: register DevClawAgent in both agent host entry points"
```

---

## Chunk 4: Verification

### Task 9: Build verification

- [ ] **Step 1: Run TypeScript compilation**

```bash
npm run compile-check-ts-native
```

Expected: No errors related to copilot imports or missing modules.

- [ ] **Step 2: Fix any compilation errors**

If there are errors from remaining copilot references we missed, fix them. Common places to check:
- Any file importing from `./copilot/`
- Build scripts referencing deleted `copilot.ts`

- [ ] **Step 3: Run build typecheck**

```bash
cd build && npm run typecheck
```

Expected: No build script errors.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve remaining copilot references after stripping"
```

---

### Task 10: Final verification commit

- [ ] **Step 1: Verify git status is clean**

```bash
git status
git log --oneline -8
```

Expected: All changes committed, clean working tree. Commits should show the logical progression:
1. Rebrand + remove deps
2. Block Copilot extensions
3. Delete copilot build scripts
4. Clean build system references
5. Delete CopilotAgent
6. Add DevClaw tool display
7. Add DevClawAgent
8. Register DevClawAgent in entry points
