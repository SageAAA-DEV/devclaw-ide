# OpenClaw Inside — Embedded AI Engine for DevTeam IDE

**Date:** 2026-03-30
**Status:** Approved
**Ship date:** 2026-04-01 (v1)

---

## Overview

OpenClaw ships baked into DevTeam IDE as the primary AI engine. "OpenClaw Inside" — like Intel Inside. One build, one binary. OpenClaw is always there. CTRL-A Cloud is an optional upgrade for managed multi-agent orchestration.

The agent is a **persistent daemon** that outlives the IDE window. Close the IDE, the agent keeps working — watching deploys, listening on channels (Slack/Discord/Telegram), executing proactively. Reopen the IDE, it reconnects and shows what happened.

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
| OpenClaw source | `F:\lenovo backup\devStuff\openclaw-main` (v2026.3.30) | Latest features and bug fixes |

## Section 1: OpenClaw Inside — Bundle + Daemon

### Bundle

OpenClaw ships in `resources/openclaw/` inside the IDE package. This is the complete gateway — `openclaw.mjs` entrypoint plus all dependencies.

### Daemon Lifecycle

**First launch (wizard completes):**
1. Copies OpenClaw from `resources/openclaw/` to `~/.openclaw/engine/` (persistent location, survives IDE updates)
2. Generates a random gateway token, saves to `~/.openclaw/config.json`
3. Selects a fixed port (default 18789, or next available), saves to config
4. Registers OpenClaw as a background service:
   - **Windows:** Startup task via `AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/` or Windows Task Scheduler
   - **Mac:** launchd plist in `~/Library/LaunchAgents/`
   - **Linux:** systemd user unit in `~/.config/systemd/user/`
5. Starts the daemon
6. Waits for `/health` to return OK

**IDE opens (daemon already running):**
1. Reads `~/.openclaw/config.json` for port + token
2. Checks `/health` — if OK, connects immediately
3. If daemon is down, restarts it from `~/.openclaw/engine/`

**IDE closes:**
- Daemon keeps running. No shutdown signal sent.

**IDE updates:**
- New IDE version bundles newer OpenClaw in `resources/openclaw/`
- On launch, compares bundled version vs `~/.openclaw/engine/` version
- If newer, copies over and restarts daemon

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

## Section 2: OpenClaw Client Layer

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
- `conversationId` — managed client-side (OpenClaw doesn't track conversations the same way)

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

- Reads `devteam.backend` setting
- If `'openclaw'`: Node `http` request to `localhost:<port>/v1/chat/completions` with Bearer token
- If `'ctrl-a'`: existing behavior (`/api/chat` with `x-app-key`)
- Response parsing adapts per backend:
  - OpenClaw: `choices[0].message.content` → delta events
  - CTRL-A: `response` field → delta events (existing)
- Conversation tracking: client-side for OpenClaw, server-side for CTRL-A

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
| `src/vs/workbench/contrib/devteam/common/openClawClient.ts` | HTTP client for OpenClaw (OpenAI format) |
| `src/vs/workbench/contrib/devteam/browser/welcomeWizard.ts` | First-launch wizard UI |

### Modified Files
| File | Changes |
|------|---------|
| `src/vs/workbench/contrib/devteam/browser/devclawService.ts` | Backend selection, OpenClaw client integration |
| `src/vs/workbench/contrib/devteam/browser/devclawAgents.ts` | Route through OpenClaw when selected |
| `src/vs/workbench/contrib/devteam/browser/settingsPane.ts` | Backend toggle, OpenClaw settings, daemon status |
| `src/vs/platform/agentHost/node/devclaw/devclawAgent.ts` | Dual backend support in IAgent provider |
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
