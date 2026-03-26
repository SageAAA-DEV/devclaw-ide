# Wave 2: Telemetry Stub & Device ID Replacement

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Replace @microsoft/1ds telemetry with a no-op stub appender. Replace @vscode/deviceid with random UUID. Remove both dependencies from package.json.

## Goal

Remove the Microsoft telemetry pipeline (`@microsoft/1ds-core-js`, `@microsoft/1ds-post-js`) and hardware device fingerprinting (`@vscode/deviceid`). Replace with DevClaw stubs. Telemetry is already OFF (`enableTelemetry: false` in product.json), so this removes dead-but-wired infrastructure that sends data to `mobile.events.data.microsoft.com`.

## Non-Goals (Wave 3+)

- Real telemetry backend (Sentry) — Wave 3
- First-run consent dialog — Wave 3
- Feature flags endpoint — Wave 3

## 1. Telemetry Appender Replacement

### Architecture

The telemetry system has 3 layers:
1. **Common** (`common/1dsAppender.ts`) — `AbstractOneDataSystemAppender` base class, `IAppInsightsCore` interface, Microsoft endpoint URLs
2. **Node** (`node/1dsAppender.ts`) — `OneDataSystemAppender` subclass with Node.js HTTP override
3. **Browser** (`browser/1dsAppender.ts`) — `OneDataSystemWebAppender` subclass for browser context

All implement `ITelemetryAppender` (from `telemetryUtils.ts`):
```typescript
interface ITelemetryAppender {
    log(eventName: string, data: any): void;
    flush(): Promise<any>;
}
```

### Strategy: Replace, Don't Gut

Instead of modifying the existing 1DS files (which would break the interface contract), we:
1. Rewrite `common/1dsAppender.ts` to export a `DevClawTelemetryAppender` that implements `ITelemetryAppender` as a no-op
2. Rewrite `node/1dsAppender.ts` to re-export from common (keeping the `OneDataSystemAppender` name so consumers don't break)
3. Rewrite `browser/1dsAppender.ts` same pattern

This means the 5 consumer files (`cliProcessMain.ts`, `sharedProcessMain.ts`, `serverServices.ts`, `telemetryService.ts`, `telemetryApp.ts`) need ZERO changes — they import `OneDataSystemAppender` / `OneDataSystemWebAppender` by name and those names still exist.

### Files Changed

| File | Action |
|---|---|
| `src/vs/platform/telemetry/common/1dsAppender.ts` | Rewrite — remove @microsoft/1ds imports, export no-op `AbstractOneDataSystemAppender` |
| `src/vs/platform/telemetry/node/1dsAppender.ts` | Rewrite — remove @microsoft/1ds imports, simple re-export |
| `src/vs/platform/telemetry/browser/1dsAppender.ts` | Rewrite — remove @microsoft/1ds imports, simple re-export |
| `src/vs/platform/telemetry/test/browser/1dsAppender.test.ts` | Update — remove mock IAppInsightsCore, test the no-op |
| `package.json` | Remove `@microsoft/1ds-core-js`, `@microsoft/1ds-post-js` |
| `remote/web/package.json` | Remove `@microsoft/1ds-core-js`, `@microsoft/1ds-post-js` |

### Consumer files (NO changes needed)

- `src/vs/code/node/cliProcessMain.ts` — imports `OneDataSystemAppender` by name
- `src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts` — same
- `src/vs/server/node/serverServices.ts` — same
- `src/vs/workbench/services/telemetry/browser/telemetryService.ts` — imports `OneDataSystemWebAppender`
- `src/vs/workbench/contrib/debug/node/telemetryApp.ts` — imports `OneDataSystemAppender`

## 2. Device ID Replacement

### Current Behavior

`src/vs/base/node/id.ts` exports `getDevDeviceId()` which calls `@vscode/deviceid` to generate a hardware-derived machine fingerprint. Falls back to `uuid.generateUuid()` on error.

### New Behavior

Replace `getDevDeviceId()` to always return a random UUID persisted to `~/.devclaw/device-id`. First call generates and saves. Subsequent calls read from file. No hardware fingerprinting.

### Files Changed

| File | Action |
|---|---|
| `src/vs/base/node/id.ts` | Rewrite `getDevDeviceId()` — read/write UUID from `~/.devclaw/device-id` |
| `package.json` | Remove `@vscode/deviceid` |
| `remote/package.json` | Remove `@vscode/deviceid` |

## 3. Testing Strategy

- Build typecheck must pass (`cd build && npm run typecheck`)
- No runtime errors from telemetry initialization
- `getDevDeviceId()` returns stable UUID across calls

## 4. File Change Summary

| Action | Path |
|---|---|
| REWRITE | `src/vs/platform/telemetry/common/1dsAppender.ts` |
| REWRITE | `src/vs/platform/telemetry/node/1dsAppender.ts` |
| REWRITE | `src/vs/platform/telemetry/browser/1dsAppender.ts` |
| UPDATE | `src/vs/platform/telemetry/test/browser/1dsAppender.test.ts` |
| EDIT | `src/vs/base/node/id.ts` (getDevDeviceId function only) |
| EDIT | `package.json` (remove 3 deps) |
| EDIT | `remote/package.json` (remove @vscode/deviceid) |
| EDIT | `remote/web/package.json` (remove @microsoft/1ds deps) |
