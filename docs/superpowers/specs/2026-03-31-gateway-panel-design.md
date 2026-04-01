# OpenClaw Gateway Panel — Design Spec

## Overview

Add a native "Gateway" panel to the IDE sidebar that exposes OpenClaw gateway features (agents, skills, tools, sessions, config) through VS Code ViewPanes. Communicates via WebSocket RPC (not REST) to the OpenClaw gateway on port 18789.

## Sidebar Layout

| Position | Icon | Panel | Purpose |
|----------|------|-------|---------|
| Sidebar | `Codicon.organization` | Agents | Agent roster + quick chat |
| Sidebar | `Codicon.settingsGear` | Settings | Connection, API keys, daemon |
| Sidebar | `Codicon.settings` (sliders) | **Gateway** | Full gateway control |
| Bottom | `Codicon.menuBarMore` (meatball) | Manage | VS Code manage menu |

## Gateway Panel — Tree View Structure

The Gateway panel uses a TreeView with collapsible sections:

```
GATEWAY
├── Status          (health, version, uptime)
├── Agents          (list, create, configure)
├── Skills          (installed, available, enable/disable)
├── Tools           (catalog, per-agent filtering)
├── Sessions        (active, history, reset/delete)
├── Models          (available models, defaults)
├── Cron Jobs       (scheduled tasks, run history)
├── Channels        (integrations status)
└── Config          (gateway settings editor)
```

## Protocol

OpenClaw uses **WebSocket RPC** on port 18789:
- Connect: `{ method: "connect", params: { clientId, role: "operator" } }`
- Request: `{ id: "uuid", method: "agents.list", params: {} }`
- Response: `{ id: "uuid", ok: true, result: { agents: [...] } }`
- Error: `{ id: "uuid", ok: false, error: { code, message } }`

## New Files

### 1. `openClawRpcClient.ts` (common/)
WebSocket RPC client for the gateway protocol.

```typescript
interface RpcRequest { id: string; method: string; params: Record<string, unknown> }
interface RpcResponse { id: string; ok: boolean; result?: unknown; error?: { code: string; message: string } }

class OpenClawRpcClient {
  connect(url: string, token: string): Promise<void>
  call<T>(method: string, params: Record<string, unknown>): Promise<T>
  subscribe(method: string, callback: (data: unknown) => void): Disposable
  disconnect(): void
  readonly isConnected: boolean
  readonly onDisconnect: Event<void>
}
```

### 2. `gatewayPane.ts` (browser/)
Main gateway TreeView panel.

Sections implemented as TreeDataProvider nodes:
- **Status**: calls `health`, shows green/red dot + version
- **Agents**: calls `agents.list`, shows name/id/status, click to configure
- **Skills**: calls `skills.status`, shows installed/available, toggle enable
- **Tools**: calls `tools.catalog`, shows grouped tool list
- **Sessions**: calls `sessions.resolve` + usage, shows active sessions
- **Models**: calls `models.list`, shows available with defaults marked
- **Cron**: calls `cron.list`, shows jobs with schedule + last run
- **Channels**: calls `channels.status`, shows connected integrations
- **Config**: opens inline editor or links to settings

### 3. Registration in `devteam.contribution.ts`

```typescript
const gatewayIcon = registerIcon('devteam-gateway-icon', Codicon.settings, ...);

const gatewayContainer = viewContainersRegistry.registerViewContainer({
  id: 'workbench.view.devteam-gateway',
  title: 'OpenClaw Gateway',
  icon: gatewayIcon,
  order: 12,
}, ViewContainerLocation.Sidebar);
```

## Priority Endpoints (Phase 1)

| Method | Panel Section | UI Element |
|--------|--------------|------------|
| `health` | Status | Green/red dot + version text |
| `agents.list` | Agents | List with name, model, status |
| `skills.status` | Skills | List with enabled/disabled toggle |
| `tools.catalog` | Tools | Grouped list by category |
| `sessions.resolve` | Sessions | Active session list |
| `models.list` | Models | Model picker dropdown |
| `config.get` | Config | Read-only display or link |

## Phase 2 (Later)

- `cron.list/add/remove` — Cron job management
- `channels.status` — Integration status
- `node.list/pair` — Device pairing
- `logs.tail` — Live log streaming in output panel
- `usage.status/cost` — Usage dashboard
- Agent file editing (`agents.files.get/set`)
- Config editing (`config.patch`)

## Dependencies

- Existing `IDevClawService` for connection state
- Existing `IStorageService` for gateway URL/token
- New `OpenClawRpcClient` for WebSocket RPC
- Browser-safe (no Node.js APIs in the renderer)
