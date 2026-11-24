import {spawn, type ChildProcess} from 'node:child_process';
import path from 'node:path';
import {E2E_SERVER_PORT} from '../playwright.config';

export const SERVER_URL = `http://127.0.0.1:${E2E_SERVER_PORT}`;

export interface RunningServer {
    stop(): Promise<void>;
}

/**
 * Starts the MCP/sync server for the e2e tests on `E2E_SERVER_PORT` (the Vite dev server proxies `/api` to it).
 * The tests own the process, so they can restart it.
 */
export async function startServer(env: {MAPS_DIR: string; MAP_FILE?: string}): Promise<RunningServer> {
    const child: ChildProcess = spawn(path.resolve('node_modules/.bin/tsx'), ['server/main.ts'], {
        env: {
            ...process.env,
            PORT: String(E2E_SERVER_PORT),
            LOG_LEVEL: 'warn',
            MAPS_DIR: env.MAPS_DIR,
            MAP_FILE: env.MAP_FILE ?? '',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const end = Date.now() + 20_000;
    for (;;) {
        if (child.exitCode !== null) throw new Error(`The server exited with code ${child.exitCode}.`);
        const ok = await fetch(`${SERVER_URL}/api/health`).then(
            (r) => r.ok,
            () => false,
        );
        if (ok) break;
        if (Date.now() > end) throw new Error('The server did not start.');
        await new Promise((r) => setTimeout(r, 100));
    }
    return {
        async stop() {
            if (child.exitCode === null) child.kill('SIGTERM');
            await exited;
        },
    };
}
