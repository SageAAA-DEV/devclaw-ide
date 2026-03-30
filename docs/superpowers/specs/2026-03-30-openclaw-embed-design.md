# OpenClaw Inside — Embedded AI Engine for DevTeam IDE

**Date:** 2026-03-30
**Status:** Approved (Rev 2 — post spec review)
**Ship date:** 2026-04-01 (v1)

---

## Overview

OpenClaw ships baked into DevTeam IDE as the primary AI engine. "OpenClaw Inside" — like Intel Inside. One build, one binary. OpenClaw is always there. CTRL-A Cloud is an optional upgrade for managed multi-agent orchestration.

The agent is a **persistent daemon** that outlives the IDE window. Close the IDE, the agent keeps working — watching deploys, listening on channels (Slack/Discord/Telegram), executing proactively. Reopen the IDE, it reconnects and shows what happened.

## Known Limitations (v1)

- **API keys stored in plaintext** in `~/.openclaw/config.json`. v1.x will migrate to OS keychain (Windows Credential Manager, macOS Keychain, libsecret on Linux).
- **`/tools/invoke` endpoint** is listed but not wired into the chat UI for v1. Tool calls happen through the chat completions flow. Direct tool invocation is post-launch.
- **"While you were away" recap** is post-launch. On reconnect, the IDE just re-establishes the connection silently.

## Architecture

```
DevTeam IDE (single build)
├── resources/openclaw/          ← bundled OpenClaw (fresh 2026.3.30)
├── ~/.openclaw/                 ← persistent config, state, memory
│   ├── config.json              ← port, token, BYOK keys, provider
│   └── workspace/               ← LanceDB, agent state
│
├── Electron Main Process
│   ├── OpenClawDaemonManager    ← install/start/stop/health-check daemon
│   └── DevClawAgent (IAgent)    ← Node-side agent provider, routes to backend
│
├── Renderer (Browser)
│   ├── OpenClawClient           ← HTTP client (OpenAI format)
│   ├── CtrlAClient              ← HTTP client (CTRL-A format, existing)
│   ├── DevClawService           ← singleton, picks backend based on config
│   ├── DevClawAgents            ← chat participants (ctrl-a, devin, scout, sage, ink)
│   └── First-Launch Wizard      ← one screen, one key, done
│
└── Background (daemon)
    └── OpenClaw Gateway          ← always-on, localhost:<port>
        ├── /v1/chat/completions  ← OpenAI-compatible chat
        ├── /health               ← liveness probe
        └── /tools/invoke         ← tool execution
```

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| One build vs two | One build | Single codebase, no maintenance split |
| Process model | Persistent daemon | Agent must outlive IDE — 2am texts, deploy watching, proactive fixes |
| API bridge | Two clients side-by-side | `openClawClient.ts` + `ctrlAClient.ts`, service picks based on config. Clean separation. |
| BYOK wizard | One key on wizard, rest in advanced | Fast onboarding. Anthropic/OpenAI/MiniMax/OpenRouter all supported. |
| Demo scope (4/1) | Full experience | Wizard, streaming chat, agent roster, workspace context |
| OpenClaw source | `F:\lenovo backup\devStuff\openclaw-main` (v2026.3.30) | Latest features and bug fixes. Copied into repo at `resources/openclaw/` for reproducible builds. |
| Client interface | Shared `IBackendClient` interface | Both `OpenClawClient` and `CtrlAClient` implement it. `getClient()` returns `IBackendClient`, not `CtrlAClient`. |
| Windows daemon | Task Scheduler (user-level) | No admin required. Runs on login. Restart on failure. Startup folder is too fragile. |
| API key storage (v1) | Plaintext `~/.openclaw/config.json` | Known limitation. v1.x migrates to OS keychain. |
| Version tracking | `package.json` version field | Bundled vs installed `~/.openclaw/engine/package.json` version compared on IDE launch. |

## Section 1: OpenClaw Inside — Bundle + Daemon

### Bundle

OpenClaw ships in `resources/openclaw/` inside the IDE package. This is the complete gateway — `openclaw.mjs` entrypoint plus all dependencies.

### Daemon Lifecycle

**First launch (wizard completes):**
1. Copies OpenClaw from `resources/openclaw/` to `~/.openclaw/engine/` (persistent location, survives IDE updates)
2. Generates a random gateway token, saves to `~/.openclaw/config.json`
3. Selects a fixed port (default 18789, or next available), saves to config
4. Registers OpenClaw as a background service:
   - **Windows:** Task Scheduler user-level task (no admin). Trigger: user logon. Action: `node ~/.openclaw/engine/openclaw.mjs gateway --bind 127.0.0.1 --port <port>`. Restart on failure (3 retries, 10s delay).
   - **Mac:** launchd plist in `~/Library/LaunchAgents/com.devteam.openclaw.plist`. KeepAlive: true. StandardOutPath/StandardErrorPath: `~/.openclaw/logs/`.
   - **Linux:** systemd user unit in `~/.config/systemd/user/openclaw.service`. Restart=on-failure. RestartSec=10.
5. Starts the daemon
6. Waits for `/health` to return OK (30s timeout, polls every 1s)
7. **If health check fails after 30s:** Show error screen: "Agent failed to start. Check your setup or try restarting." with a Retry button and a link to logs at `~/.openclaw/logs/`.

**IDE opens (daemon already running):**
1. Reads `~/.openclaw/config.json` for port + token
2. Checks `/health` — if OK, connects immediately
3. If daemon is down, restarts it from `~/.openclaw/engine/`

**IDE closes:**
- Daemon keeps running. No shutdown signal sent.

**IDE updates:**
- New IDE version bundles newer OpenClaw in `resources/openclaw/`
- On launch, reads `version` field from bundled `resources/openclaw/package.json` vs `~/.openclaw/engine/package.json`
- If bundled version is newer (semver compare), copies over and restarts daemon
- Version mismatch logged to `~/.openclaw/logs/upgrade.log`

**Port conflict on subsequent starts:**
- Daemon reads saved port from `~/.openclaw/config.json`
- If port is in use by another process, scans 18790-18899, then any free port
- Updates config.json with new port so IDE can find it

### Daemon Manager

New file: `src/vs/platform/openclaw/node/openclawDaemonManager.ts`

Responsibilities:
- `install()` — copy bundle to persistent location, register service
- `start()` — spawn daemon if not running
- `stop()` — graceful shutdown (SIGTERM → 3s → SIGKILL)
- `isRunning()` — check `/health` endpoint
- `getPort()` — read from config
- `getToken()` — read from config
- `onReady` — event fired when health check first passes
- `upgrade()` — compare versions, copy new bundle, restart

Environment variables passed to daemon:
- `OPENCLAW_GATEWAY_TOKEN` — auth token
- `ANTHROPIC_API_KEY` — if configured
- `OPENAI_API_KEY` — if configured
- `MINIMAX_API_KEY` — if configured
- `OPENROUTER_API_KEY` — if configured
- `OPENCLAW_CONFIG_DIR=~/.openclaw`

## Section 2: Backend Client Interface & OpenClaw Client

### Shared Interface

New file: `src/vs/workbench/contrib/devteam/common/backendClient.ts`

```typescript
export interface IBackendClient {
  chat(agentId: string, message: string, conversationId?: string): Promise<ChatResponse>;
  chatStream(agentId: string, message: string, onChunk: (text: string) => void): Promise<string>;
  getHealth(): Promise<{ status: string; version: string }>;
  listAgents(): Promise<AgentInfo[]>;
  isConnected(): boolean;
  dispose(): void;
}
```

Both `CtrlAClient` and `OpenClawClient` implement `IBackendClient`. The existing `CtrlAClient` gets this interface added (non-breaking — it already has these methods). `DevClawService.getClient()` returns `IBackendClient` instead of `CtrlAClient`. WebSocket methods (`connectWs`, `sendChat`, `selectAgent`, `on`, `onAll`) stay on `CtrlAClient` only — they are not part of the shared interface. `DevClawService` conditionally calls WebSocket methods only when backend is `'ctrl-a'`.

### OpenClaw Client

New file: `src/vs/workbench/contrib/devteam/common/openClawClient.ts`

Speaks OpenAI-compatible format to the local daemon.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/chat/completions` | Chat (streaming and non-streaming) |
| GET | `/health` | Health check |
| POST | `/tools/invoke` | Isolated tool execution |

### Authentication

Bearer token in `Authorization` header. Token read from `~/.openclaw/config.json`.

### Request Format

```typescript
// Non-streaming
POST /v1/chat/completions
{
  "model": "openclaw:main",
  "messages": [
    { "role": "system", "content": "<persona + workspace context>" },
    { "role": "user", "content": "<user message>" }
  ]
}

// Streaming
Same body + "stream": true
Response: SSE with data: {"choices":[{"delta":{"content":"..."}}]}
```

### Agent Selection

Agent persona (devin, scout, sage, ink) is injected as the system prompt — OpenClaw routes to the LLM, persona defines the voice. No agent discovery endpoint needed for v1.

### Response Normalization

OpenClawClient returns the same `ChatResponse` shape as CtrlAClient:
- `response` — extracted from `choices[0].message.content`
- `agentId` — set from the locally-selected agent
- `conversationId` — generated client-side as `crypto.randomUUID()` on first message, persisted in-memory per chat session. Passed to OpenClaw via the `user` field (OpenClaw derives stable sessions from `user`). Reset when user starts a new chat.

### DevClawService Changes

`devclawService.ts` updated:
- Reads `devteam.backend` from storage (default: `'openclaw'`)
- If `'openclaw'`: instantiates `OpenClawClient` with port + token from daemon manager
- If `'ctrl-a'`: instantiates `CtrlAClient` as today
- All downstream code (chat, agents, context) is unchanged — same interface

## Section 3: First-Launch Wizard

Single screen shown once on first IDE launch (or if no BYOK key is configured).

### UI

**Header:** "Welcome to DevTeam — Your AI agent is ready"

**Fields:**
- Provider dropdown: Anthropic (default), OpenAI, MiniMax, OpenRouter
- API key input (password field, label changes per provider)
- "Start" button (primary, prominent)
- "Advanced settings" link (small, below)

### Flow

1. User selects provider, pastes key, clicks Start
2. Key saved to `~/.openclaw/config.json`
3. Daemon manager installs + starts OpenClaw
4. Progress indicator: "Starting your agent..."
5. Health check passes → wizard closes
6. Chat panel opens with agent greeting
7. `devteam.wizardComplete` flag set in storage — wizard never shows again

### Edge Cases

- **Key invalid:** OpenClaw will start fine (it's a gateway), but first chat message will return an LLM error. Surface this clearly in chat: "API key may be invalid — check Settings."
- **Port conflict:** Try default 18789, then scan 18790-18899, then any free port.
- **OpenClaw already running:** Skip install/start, just connect. Wizard still shows for key setup if no key configured.

## Section 4: Agent Roster & Workspace Context

### Agents

Existing five agents remain: **ctrl-a, devin, scout, sage, ink**. Each has a persona prompt prefix and slash commands. All registered as VS Code chat participants.

In OpenClaw mode, the persona prompt is injected as the system message. OpenClaw forwards to the configured LLM provider. The agent voice comes from the prompt, not the backend.

### Workspace Context

Existing context gathering from `devclawAgents.ts` is unchanged:
- Directory tree (3 levels, excludes node_modules/.git/dist)
- Key files (package.json, tsconfig, CLAUDE.md, README, etc.)
- All open editor tabs
- File references detected in user message
- 80k char safety cap

This context is included in the system prompt for every message, regardless of backend.

## Section 5: Node-Side Agent Provider

`devclawAgent.ts` (IAgent implementation in Electron main process) gets a parallel path:

- Backend selection via environment variables (same pattern as existing `DEVCLAW_CTRL_A_URL`):
  - `DEVCLAW_BACKEND=openclaw|ctrl-a` (default: `openclaw`)
  - `DEVCLAW_OPENCLAW_PORT` — read from `~/.openclaw/config.json` at startup
  - `DEVCLAW_OPENCLAW_TOKEN` — read from `~/.openclaw/config.json` at startup
  - These env vars are set by the Electron main process before spawning the agent host, bridging renderer config to the node side.
- If `'openclaw'`: Node `http` request to `localhost:<port>/v1/chat/completions` with Bearer token
- If `'ctrl-a'`: existing behavior (`/api/chat` with `x-app-key`)
- Response parsing adapts per backend:
  - OpenClaw: `choices[0].message.content` → delta events
  - CTRL-A: `response` field → delta events (existing)
- Conversation tracking: client-side UUID for OpenClaw (passed in `user` field), server-side for CTRL-A

## Section 6: Settings Pane Updates

`settingsPane.ts` changes:

### Backend Section (new, top of settings)
- **Backend toggle:** OpenClaw (default) | CTRL-A Cloud
- When OpenClaw: shows provider dropdown + key fields + daemon status
- When CTRL-A: shows URL + app key fields (existing behavior)

### OpenClaw Section (new)
- **Daemon status:** Running/Stopped indicator + restart button
- **Provider:** Dropdown (Anthropic, OpenAI, MiniMax, OpenRouter)
- **API Key:** Password field per provider
- **Port:** Display current port (read-only, from config)
- **Advanced:** Link to `~/.openclaw/config.json` for power users

### BYOK Section (existing, updated)
- Moves under OpenClaw section
- Keys saved to `~/.openclaw/config.json` instead of IDE storage
- Daemon restarted when keys change (to pick up new env vars)

## Section 7: File Inventory

### New Files
| File | Purpose |
|------|---------|
| `src/vs/platform/openclaw/node/openclawDaemonManager.ts` | Daemon lifecycle (install, start, stop, health, upgrade) |
| `src/vs/workbench/contrib/devteam/common/backendClient.ts` | `IBackendClient` interface shared by both clients |
| `src/vs/workbench/contrib/devteam/common/openClawClient.ts` | HTTP client for OpenClaw (OpenAI format), implements `IBackendClient` |
| `src/vs/workbench/contrib/devteam/browser/welcomeWizard.ts` | First-launch wizard UI |

### Modified Files
| File | Changes |
|------|---------|
| `src/vs/workbench/contrib/devteam/common/ctrlAClient.ts` | Add `implements IBackendClient`, no logic changes |
| `src/vs/workbench/contrib/devteam/browser/devclawService.ts` | Backend selection, return `IBackendClient` from `getClient()`, conditional WebSocket |
| `src/vs/workbench/contrib/devteam/browser/devclawAgents.ts` | Route through OpenClaw when selected |
| `src/vs/workbench/contrib/devteam/browser/settingsPane.ts` | Backend toggle, OpenClaw settings, daemon status |
| `src/vs/platform/agentHost/node/devclaw/devclawAgent.ts` | Dual backend support via env vars |
| `src/vs/workbench/contrib/devteam/browser/devteam.contribution.ts` | Register wizard, daemon manager |

### Bundled
| Path | Contents |
|------|----------|
| `resources/openclaw/` | Full OpenClaw gateway from `F:\lenovo backup\devStuff\openclaw-main` |

## Section 8: What Ships April 1st vs Later

### v1 (April 1st)
- OpenClaw bundled in IDE, installed as persistent daemon
- First-launch wizard (one screen, one key)
- Chat with streaming responses through OpenClaw
- Agent roster with personas (ctrl-a, devin, scout, sage, ink)
- Workspace context in every message
- Settings: backend toggle, provider/key management, daemon status
- Optional CTRL-A Cloud connection
- Daemon persists when IDE closes

### v1.x (Post-launch)
- Channel integrations UI (connect Slack/Discord from IDE settings)
- "While you were away" recap on IDE reconnect
- Deploy watching + proactive agent actions
- Auto-upgrade daemon when IDE updates
- Multi-project context switching
- LanceDB memory integration visible in IDE
