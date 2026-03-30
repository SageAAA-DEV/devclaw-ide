/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import { createServer, type AddressInfo } from 'net';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import * as path from '../../../base/common/path.js';

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IOpenClawDaemonConfig, IOpenClawDaemonService } from '../common/openclawDaemon.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 18789;
const PORT_SCAN_START = 18790;
const PORT_SCAN_END = 18899;
const HEALTH_TIMEOUT_MS = 2_000;
const START_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 1_000;
const STOP_GRACE_MS = 3_000;
const TOKEN_PREFIX = 'ocl_';
const TOKEN_RAND_LEN = 32;
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
	let rand = '';
	for (let i = 0; i < TOKEN_RAND_LEN; i++) {
		rand += TOKEN_CHARS.charAt(Math.floor(Math.random() * TOKEN_CHARS.length));
	}
	return TOKEN_PREFIX + rand;
}

function openClawHome(): string {
	return path.join(homedir(), '.openclaw');
}

function configPath(): string {
	return path.join(openClawHome(), 'config.json');
}

function engineDir(): string {
	return path.join(openClawHome(), 'engine');
}

function logsDir(): string {
	return path.join(openClawHome(), 'logs');
}

function ensureDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirRecursive(src: string, dest: string): void {
	ensureDir(dest);
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirRecursive(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

function readConfig(): IOpenClawDaemonConfig | null {
	try {
		const raw = fs.readFileSync(configPath(), 'utf8');
		return JSON.parse(raw) as IOpenClawDaemonConfig;
	} catch {
		return null;
	}
}

function writeConfig(cfg: IOpenClawDaemonConfig): void {
	ensureDir(openClawHome());
	fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function readPackageVersion(pkgPath: string): string | null {
	try {
		const raw = fs.readFileSync(pkgPath, 'utf8');
		const parsed = JSON.parse(raw) as { version?: string };
		return parsed.version ?? null;
	} catch {
		return null;
	}
}

function isPortFree(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const server = createServer();
		server.once('error', () => resolve(false));
		server.once('listening', () => {
			server.close(() => resolve(true));
		});
		server.listen(port, '127.0.0.1');
	});
}

async function findFreePort(): Promise<number> {
	if (await isPortFree(DEFAULT_PORT)) {
		return DEFAULT_PORT;
	}
	for (let p = PORT_SCAN_START; p <= PORT_SCAN_END; p++) {
		if (await isPortFree(p)) {
			return p;
		}
	}
	// Fall back to OS-assigned port
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address() as AddressInfo;
			server.close(() => resolve(addr.port));
		});
		server.once('error', reject);
	});
}

async function checkHealthOnce(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort();
			resolve(false);
		}, HEALTH_TIMEOUT_MS);

		fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal })
			.then(res => {
				clearTimeout(timer);
				resolve(res.ok);
			})
			.catch(() => {
				clearTimeout(timer);
				resolve(false);
			});
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function parseSemver(v: string): [number, number, number] {
	const parts = v.replace(/^v/, '').split('.').map(Number);
	return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isNewer(candidate: string, installed: string): boolean {
	const [cMaj, cMin, cPat] = parseSemver(candidate);
	const [iMaj, iMin, iPat] = parseSemver(installed);
	if (cMaj !== iMaj) { return cMaj > iMaj; }
	if (cMin !== iMin) { return cMin > iMin; }
	return cPat > iPat;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class OpenClawDaemonManager extends Disposable implements IOpenClawDaemonService {

	declare readonly _serviceBrand: undefined;

	// ---- state -------------------------------------------------------------

	private _isReady: boolean = false;
	private _config: IOpenClawDaemonConfig | null = null;
	private _daemonProcess: ChildProcess | undefined;

	// ---- events ------------------------------------------------------------

	private readonly _onReady = this._register(new Emitter<void>());
	readonly onReady: Event<void> = this._onReady.event;

	private readonly _onError = this._register(new Emitter<string>());
	readonly onError: Event<string> = this._onError.event;

	// ---- IOpenClawDaemonService accessors ----------------------------------

	get isReady(): boolean {
		return this._isReady;
	}

	getPort(): number {
		return this._config?.port ?? DEFAULT_PORT;
	}

	getToken(): string {
		return this._config?.token ?? '';
	}

	getBaseUrl(): string {
		return `http://127.0.0.1:${this.getPort()}`;
	}

	// ---- public API --------------------------------------------------------

	/**
	 * Create required directories, copy bundled engine, generate a token, find a
	 * free port, and persist config. Safe to call multiple times — subsequent calls
	 * are idempotent (existing config is reused, engine is not re-copied unless
	 * upgrade() is called separately).
	 */
	async install(): Promise<IOpenClawDaemonConfig> {
		ensureDir(openClawHome());
		ensureDir(engineDir());
		ensureDir(logsDir());

		// If config already exists, reuse it
		const existing = readConfig();
		if (existing) {
			this._config = existing;
			return existing;
		}

		// Copy bundled engine files
		const bundled = this.getBundledPath();
		if (bundled && fs.existsSync(bundled)) {
			copyDirRecursive(bundled, engineDir());
		}

		const port = await findFreePort();
		const token = generateToken();

		const cfg: IOpenClawDaemonConfig = { port, token };
		writeConfig(cfg);
		this._config = cfg;
		return cfg;
	}

	/**
	 * Spawn the daemon if it is not already running, then wait up to 30 s for
	 * /health to respond. Returns true on success.
	 */
	async start(): Promise<boolean> {
		// Load config if we don't have it yet
		if (!this._config) {
			this._config = readConfig();
		}
		if (!this._config) {
			this._onError.fire('OpenClaw config not found — call install() first');
			return false;
		}

		const { port, token } = this._config;

		// Already healthy?
		if (await checkHealthOnce(port)) {
			this._isReady = true;
			this._onReady.fire();
			return true;
		}

		// Locate the engine entry-point
		const entryPoint = path.join(engineDir(), 'openclaw.mjs');
		if (!fs.existsSync(entryPoint)) {
			this._onError.fire(`OpenClaw engine not found at ${entryPoint}`);
			return false;
		}

		// Prepare log streams
		const logFile = path.join(logsDir(), 'daemon.log');
		const logStream = fs.createWriteStream(logFile, { flags: 'a' });

		try {
			const child = spawn(
				process.execPath,
				[entryPoint, 'gateway', '--bind', 'loopback', '--port', String(port)],
				{
					detached: true,
					stdio: ['ignore', logStream, logStream],
					env: {
						...process.env,
						OPENCLAW_TOKEN: token,
					},
				}
			);

			child.unref();
			this._daemonProcess = child;

			child.on('error', err => {
				this._onError.fire(`OpenClaw daemon error: ${err.message}`);
			});

		} catch (err) {
			this._onError.fire(`Failed to spawn OpenClaw daemon: ${String(err)}`);
			return false;
		}

		// Poll /health until ready or timeout
		const deadline = Date.now() + START_TIMEOUT_MS;
		while (Date.now() < deadline) {
			await sleep(HEALTH_POLL_MS);
			if (await checkHealthOnce(port)) {
				this._isReady = true;
				this._onReady.fire();
				return true;
			}
		}

		this._onError.fire(`OpenClaw daemon did not become healthy within ${START_TIMEOUT_MS / 1000}s`);
		return false;
	}

	/**
	 * Send SIGTERM, wait up to 3 s, then SIGKILL if still alive.
	 * The daemon is intentionally NOT stopped on dispose() — it outlives the IDE.
	 */
	async stop(): Promise<void> {
		const proc = this._daemonProcess;
		if (!proc || proc.exitCode !== null) {
			return;
		}

		proc.kill('SIGTERM');

		await new Promise<void>(resolve => {
			const timer = setTimeout(() => {
				try { proc.kill('SIGKILL'); } catch { /* already gone */ }
				resolve();
			}, STOP_GRACE_MS);

			proc.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
		});

		this._daemonProcess = undefined;
		this._isReady = false;
	}

	/**
	 * Merge new key/provider values into config and restart the daemon so it
	 * picks up the changes.
	 */
	async updateKeys(
		keys: Partial<Pick<IOpenClawDaemonConfig, 'anthropicKey' | 'openaiKey' | 'minimaxKey' | 'openrouterKey' | 'provider'>>
	): Promise<void> {
		const cfg = readConfig();
		if (!cfg) {
			throw new Error('OpenClaw not installed — call install() first');
		}

		const updated: IOpenClawDaemonConfig = { ...cfg, ...keys };
		writeConfig(updated);
		this._config = updated;

		await this.stop();
		await this.start();
	}

	/**
	 * Compare bundled package.json version against installed engine version.
	 * If the bundled version is newer, overwrite the engine directory and restart.
	 * Returns true if an upgrade was performed.
	 */
	async upgrade(): Promise<boolean> {
		const bundled = this.getBundledPath();
		if (!bundled || !fs.existsSync(bundled)) {
			return false;
		}

		const bundledPkg = path.join(bundled, 'package.json');
		const installedPkg = path.join(engineDir(), 'package.json');

		const bundledVersion = readPackageVersion(bundledPkg);
		const installedVersion = readPackageVersion(installedPkg);

		if (!bundledVersion) {
			return false;
		}

		const shouldUpgrade = !installedVersion || isNewer(bundledVersion, installedVersion);
		if (!shouldUpgrade) {
			return false;
		}

		await this.stop();
		copyDirRecursive(bundled, engineDir());
		await this.start();
		return true;
	}

	// ---- health check (public utility) ------------------------------------

	async checkHealth(): Promise<boolean> {
		return checkHealthOnce(this.getPort());
	}

	// ---- dispose -----------------------------------------------------------

	/**
	 * Disposing this service does NOT stop the daemon — the gateway is meant to
	 * outlive the IDE window so reconnections are instant.
	 */
	override dispose(): void {
		super.dispose();
		// Intentionally leave daemon running
	}

	// ---- private helpers ---------------------------------------------------

	/**
	 * Locate the bundled OpenClaw directory that ships inside the IDE resources.
	 * Checks process.resourcesPath first (Electron production), then falls back
	 * to import.meta.url-relative paths for dev builds.
	 */
	private getBundledPath(): string | null {
		const candidates: string[] = [];

		// Electron production path
		if ((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath) {
			candidates.push(
				path.join((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!, 'openclaw')
			);
		}

		// Dev / test fallback — walk up from this file's directory.
		// This file lives at src/vs/platform/openclaw/node/ — resources/ is 5 levels up at repo root.
		try {
			const thisDir = path.dirname(fileURLToPath(import.meta.url));
			const fromDir = path.join(thisDir, '..', '..', '..', '..', '..', 'resources', 'openclaw');
			candidates.push(fromDir);
		} catch {
			// import.meta.url may not be available in all build contexts
		}

		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}

		return null;
	}
}

// ---------------------------------------------------------------------------
// Service registration
// ---------------------------------------------------------------------------

registerSingleton(IOpenClawDaemonService, OpenClawDaemonManager, InstantiationType.Delayed);
