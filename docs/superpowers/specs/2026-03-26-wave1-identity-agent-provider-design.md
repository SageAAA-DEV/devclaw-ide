# Wave 1: Identity, Branding & Agent Provider Replacement

**Date:** 2026-03-26
**Status:** Reviewed
**Scope:** Strip Copilot SDK, rebrand to DevClaw/SageAAA, replace agent provider with CTRL-A backed implementation

## Goal

Remove all GitHub Copilot dependencies and Microsoft branding from the DevClaw IDE codebase. Replace the Copilot agent provider with a DevClaw agent provider that routes to the existing CTRL-A backend. Block Copilot extension imports. Result: a clean DevClaw build with no competitor DNA in the agent layer.

## Non-Goals (Wave 2+)

- Telemetry replacement (`@microsoft/1ds` → DevClaw telemetry) — Wave 2
- Device ID replacement (`@vscode/deviceid` → random UUID) — Wave 2
- First-run consent dialog — Wave 2
- Feature flags endpoint — Wave 2
- Streaming responses — Wave 2

## 1. Identity & Branding

### 1.1 package.json Changes

Three package.json files need updates: root, `remote/`, and `remote/web/`.

**Root `package.json`:**
- Change `author.name` from `"Microsoft Corporation"` to `"SageAAA, Inc."`
- Change `repository.url` to `"https://github.com/sageaaa/devclaw.git"` (or remove)
- Change `bugs.url` to `"https://github.com/sageaaa/devclaw/issues"`
- Remove dependency: `@github/copilot`
- Remove dependency: `@github/copilot-sdk`

**`remote/package.json`:**
- Remove dependency: `@github/copilot`
- Remove dependency: `@github/copilot-sdk`

**`remote/web/package.json`:**
- No copilot dependencies to remove (only has `@microsoft/1ds` — Wave 2)

### 1.2 product.json Changes

Add extension blocking:

```json
"cannotImportExtensions": [
    "github.copilot",
    "github.copilot-chat"
]
```

The `defaultChatAgent` block already points to `sageaaa.devclaw-*` — no changes needed.

### 1.3 Build System Cleanup

**Delete:**
- `build/lib/copilot.ts` — Copilot binary management for platform-specific packages
- `build/azure-pipelines/common/checkCopilotChatCompatibility.ts` — CI compatibility check

**Edit:**
- `build/.moduleignore` — Remove all `@github/copilot*` entries (lines 192-215 approx)
- `build/gulpfile.vscode.ts` — Remove imports of `getCopilotExcludeFilter`, `copyCopilotNativeDeps` from `./lib/copilot.ts` and all usage (lines 34, 441, 448, 685, 696, 725 approx)
- `build/gulpfile.reh.ts` — Same copilot imports and usage (lines 37, 347, 466, 469, 522 approx)
- `build/darwin/create-universal-app.ts` — Remove copilot-specific platform directory handling (lines 60-63, 71-78, 88 approx)
- `build/darwin/verify-macho.ts` — Remove copilot binary paths from Mach-O verification allowlist (lines 30-36 approx)
- `build/npm/postinstall.ts` — Remove `@github/copilot-sdk` session.js ESM patch (lines 292-302 approx)

### 1.4 Legal Attribution

**Keep untouched:**
- `LICENSE.txt` (MIT license)
- `ThirdPartyNotices.txt`

**Add to About dialog** (future, not this spec):
- "Built on the Code-OSS editor, licensed under the MIT License."

## 2. Agent Provider Replacement

### 2.1 Architecture

The existing `AgentService` (`src/vs/platform/agentHost/node/agentService.ts`) is provider-agnostic. It holds a map of `IAgent` providers and dispatches to them by provider ID. Replacing `CopilotAgent` with `DevClawAgent` requires no changes to the service layer.

```
AgentService (untouched)
  └── registers IAgent providers
       ├── CopilotAgent (DELETE)
       └── DevClawAgent (NEW) → CTRL-A backend via REST/WebSocket
```

### 2.2 Files to Delete

```
src/vs/platform/agentHost/node/copilot/
├── copilotAgent.ts          (DELETE)
├── copilotSessionWrapper.ts (DELETE)
└── copilotToolDisplay.ts    (DELETE)
```

Remove the `copilot/` directory entirely.

### 2.3 Files to Create

```
src/vs/platform/agentHost/node/devclaw/
├── devclawAgent.ts          (NEW)
├── devclawSessionWrapper.ts (NEW)
└── devclawToolDisplay.ts    (NEW)
```

### 2.4 DevClawAgent (`devclawAgent.ts`)

Implements `IAgent` interface. Key behaviors:

**Constructor:**
- Uses DI decorator: `@ILogService private readonly _logService: ILogService`
- Config (CTRL-A URL and API key) read from environment variables or a config file in `.devclaw/`, not IStorageService (agent host runs in a utility process without access to workbench storage)
- Two instantiation patterns exist: `new DevClawAgent(logService)` in `agentHostMain.ts` and `instantiationService.createInstance(DevClawAgent)` in `agentHostServerMain.ts` — must support both

**`getDescriptor()`:**
```typescript
{
    provider: 'devclaw',
    displayName: 'Agent Host - DevClaw',
    description: 'CTRL-A agent team running via REST/WebSocket',
    requiresAuth: false, // Uses API key, not OAuth
}
```

**`getProtectedResources()`:**
Returns empty array — DevClaw uses API key auth via storage, not OAuth resource metadata.

**`authenticate()`:**
Reads API key from storage. No GitHub OAuth flow.

**`createSession()`:**
- Calls CTRL-A backend `POST /api/chat` to initialize
- Creates a `DevClawSessionWrapper` around the WebSocket connection
- Wires up event handlers (delta, message, tool_start, tool_complete, idle, error)
- Returns session URI

**`sendMessage()`:**
- Sends message to CTRL-A via REST `POST /api/chat` with `{ message, agentId }`
- Agent ID defaults to `ctrl-a` (the router), which internally dispatches to Devin/Scout/Sage/Ink
- Attachments mapped to context string (same pattern as existing `devclawAgents.ts` gatherLocalContext)

**`listModels()`:**
- Returns available models from CTRL-A backend (or hardcoded list initially)
- Each model maps to a DevClaw agent: `devclaw-ctrl-a`, `devclaw-devin`, `devclaw-scout`, `devclaw-sage`, `devclaw-ink`

**Permission handling:**
- Reuses the same `PermissionKind` enum and `_handlePermissionRequest` pattern
- Auto-approves reads inside working directory
- All other operations prompt the user via the renderer

**All required IAgent interface members:**

| Method | Implementation |
|---|---|
| `readonly id` | `'devclaw'` |
| `readonly onDidSessionProgress` | Emitter, fires on all session events |
| `getDescriptor()` | Returns DevClaw descriptor (see above) |
| `getProtectedResources()` | Returns `[]` (API key auth, no OAuth) |
| `authenticate()` | Reads API key from config, returns true |
| `createSession()` | Creates session against CTRL-A backend |
| `sendMessage()` | POST to CTRL-A `/api/chat` |
| `getSessionMessages()` | Returns message history from session wrapper |
| `listSessions()` | Returns active sessions (in-memory initially, no persistence) |
| `listModels()` | Returns hardcoded agent list initially |
| `abortSession()` | Cancels current request via AbortController |
| `changeModel()` | Switches active agent ID on the session |
| `respondToPermissionRequest()` | Same deferred-promise pattern as Copilot |
| `disposeSession()` | Cleans up session wrapper, pending permissions |
| `shutdown()` | Disconnects all WebSockets, clears state |
| `dispose()` | Calls shutdown, cleans up emitters |

**Error handling:**
- If CTRL-A backend is unreachable, fires `error` event with connection guidance
- No crash — graceful degradation

**Platform constraint:**
The agent host runs in a Node.js utility process, not the browser renderer. The existing `CtrlAClient` in `src/vs/workbench/contrib/devteam/common/ctrlAClient.ts` uses the browser `WebSocket` API. `DevClawAgent` must use Node.js `ws` module or the `undici` WebSocket (already a dependency) instead.

### 2.5 DevClawSessionWrapper (`devclawSessionWrapper.ts`)

Wraps the CTRL-A WebSocket connection. Maps `StreamEvent` types to `IAgent` session events:

| CTRL-A StreamEvent | IAgent Event | Notes |
|---|---|---|
| `response` | `delta` + `message` | Split streaming content into deltas |
| `tool-start` | `tool_start` | Maps tool name + args |
| `tool-complete` | `tool_complete` | Maps success/error + output |
| `error` | `error` | Error type + message |
| `pong` | (ignored) | Heartbeat |
| `agent-selected` | (logged) | Which agent CTRL-A routed to |

### 2.6 DevClawToolDisplay (`devclawToolDisplay.ts`)

Same structure as `copilotToolDisplay.ts` but with agent-branded messages.

**Tool name enum:**
Reuses the same tool names (bash, edit, view, grep, glob, write, web_search) since these are standard across agent frameworks.

**Display name mapping:**
- `bash` → "Running command"
- `edit` → "Editing file"
- `view` → "Reading file"
- `grep` → "Searching"
- `glob` → "Finding files"
- `write` → "Creating file"
- `web_search` → "Searching the web"

**Agent-branded invocation messages** (when agent context is available):
- "Devin is running `npm test`"
- "Scout is searching for `auth middleware`"
- "Sage is reading `src/app.ts`"

**Past-tense messages:**
- "Devin ran `npm test`"
- "Scout found 3 matches"
- "Sage read `src/app.ts`"

**Hidden tools:**
- `report_intent` — internal, not shown to user

### 2.7 Registration Changes

**Two files** instantiate CopilotAgent and both must be updated:

**`agentHostMain.ts`** (line 68 approx — direct instantiation):
```diff
- import { CopilotAgent } from './copilot/copilotAgent.js';
+ import { DevClawAgent } from './devclaw/devclawAgent.js';

- agentService.registerProvider(new CopilotAgent(logService));
+ agentService.registerProvider(new DevClawAgent(logService));
```

**`agentHostServerMain.ts`** (line 31, 177 approx — DI instantiation):
```diff
- import { CopilotAgent } from './copilot/copilotAgent.js';
+ import { DevClawAgent } from './devclaw/devclawAgent.js';

- const copilotAgent = disposables.add(instantiationService.createInstance(CopilotAgent));
+ const devclawAgent = disposables.add(instantiationService.createInstance(DevClawAgent));
```

Also in `agentHostServerMain.ts`, change hardcoded provider fallback (line 143 approx):
```diff
- provider: AgentSession.provider(s.session) ?? 'copilot',
+ provider: AgentSession.provider(s.session) ?? 'devclaw',
```

### 2.8 Unchanged Components

These files are NOT modified:
- `src/vs/platform/agentHost/common/agentService.ts` — IAgent interface
- `src/vs/platform/agentHost/node/agentService.ts` — AgentService dispatcher
- `src/vs/platform/agentHost/node/sessionStateManager.ts` — session state
- `src/vs/platform/agentHost/common/state/` — session state types
- `src/vs/platform/agentHost/node/agentSideEffects.ts` — side effects
- `src/vs/platform/agentHost/node/agentEventMapper.ts` — event mapping
- `src/vs/platform/agentHost/node/webSocketTransport.ts` — WebSocket transport

### 2.9 Existing DevTeam Code Relationship

The existing custom code in `src/vs/workbench/contrib/devteam/` (chat participants, DevClawService, CtrlAClient) continues to work independently. The new `DevClawAgent` in the agent host is a **second integration point** — it makes CTRL-A agents available through VS Code's sessions/agent-host system, while the existing chat participants provide them through the chat panel.

Long-term, these may converge. For now, both paths work and serve different UI surfaces:
- Chat participants → VS Code chat panel (existing, working)
- Agent host provider → Sessions window, agent mode (new, this spec)

## 3. Testing Strategy

### 3.1 Build Verification
- `npm run compile` must succeed with no Copilot import errors
- `npm run compile-check-ts-native` must pass

### 3.2 Runtime Verification
- IDE launches without errors
- Agent host starts and registers DevClaw provider
- Chat panel still works (existing chat participants unaffected)
- Sessions window shows DevClaw agent (if CTRL-A backend is configured)
- Copilot extensions cannot be installed (blocked)

### 3.3 Graceful Degradation
- If CTRL-A backend is not configured, agent host reports "not connected" (no crash)
- If CTRL-A backend is unreachable, sessions show connection error

## 4. Deferred Cleanup (Wave 2+)

These items contain `'copilot'` strings but are not build-breaking and are deferred:

- **Test files** — `agentService.test.ts`, `agentSideEffects.test.ts`, `protocolServerHandler.test.ts`, `sessionStateManager.test.ts`, `agentHostChatContribution.test.ts` use `MockAgent('copilot')` and `'copilot'` as provider strings. Tests still pass since `AgentService` is provider-name-agnostic. Update to `'devclaw'` in Wave 2.
- **Design docs** — `agentHost/design.md`, `agentHost/architecture.md` reference copilot concepts. Update in Wave 2.
- **Chat debug** — `chatDebugServiceImpl.ts` hardcodes `'copilotcli'` as a process name filter (line 123). Cosmetic, not functional.
- **Chat contributions** — `chat.contribution.ts` references `~/.copilot/agents` as a path. Part of upstream VS Code harness system, not our agent code.

## 5. File Change Summary

| Action | Path |
|---|---|
| EDIT | `package.json` (author, repo, remove copilot deps) |
| EDIT | `remote/package.json` (remove copilot deps) |
| EDIT | `product.json` (add cannotImportExtensions) |
| EDIT | `build/.moduleignore` (remove copilot entries) |
| EDIT | `src/vs/platform/agentHost/node/agentHostMain.ts` (swap CopilotAgent → DevClawAgent) |
| EDIT | `src/vs/platform/agentHost/node/agentHostServerMain.ts` (swap CopilotAgent → DevClawAgent + fix `'copilot'` fallback) |
| EDIT | `build/gulpfile.vscode.ts` (remove copilot imports and task references) |
| EDIT | `build/gulpfile.reh.ts` (remove copilot imports and task references) |
| EDIT | `build/darwin/create-universal-app.ts` (remove copilot platform handling) |
| EDIT | `build/darwin/verify-macho.ts` (remove copilot binary allowlist) |
| EDIT | `build/npm/postinstall.ts` (remove copilot-sdk ESM patch) |
| DELETE | `build/lib/copilot.ts` |
| DELETE | `build/azure-pipelines/common/checkCopilotChatCompatibility.ts` |
| DELETE | `src/vs/platform/agentHost/node/copilot/` (3 files + directory) |
| CREATE | `src/vs/platform/agentHost/node/devclaw/devclawAgent.ts` |
| CREATE | `src/vs/platform/agentHost/node/devclaw/devclawSessionWrapper.ts` |
| CREATE | `src/vs/platform/agentHost/node/devclaw/devclawToolDisplay.ts` |
