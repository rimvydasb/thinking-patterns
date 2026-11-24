import websocket from '@fastify/websocket';
import Fastify, {type FastifyInstance, type FastifyServerOptions} from 'fastify';
import {apiRoutes} from './api/routing';
import {createMapWorkspace, type MapWorkspace} from './map/mapWorkspace';
import {mcpRoutes} from './mcp/routing';
import {syncRoutes} from './sync/routing';

export interface ServerOptions {
    /** The maps directory and the open map file. Default: a workspace for the working directory. */
    workspace?: MapWorkspace;
    logger?: FastifyServerOptions['logger'];
}

/** Builds the Fastify server: MCP (`/mcp`), app sync WebSocket (`/api/sync`) and REST (`/api/*`). */
export async function buildServer(opts: ServerOptions = {}): Promise<{app: FastifyInstance; workspace: MapWorkspace}> {
    const workspace = opts.workspace ?? createMapWorkspace(process.cwd());
    const app = Fastify({logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024});
    await app.register(websocket);
    await app.register(apiRoutes, {workspace});
    await app.register(syncRoutes, {workspace});
    await app.register(mcpRoutes, {workspace});
    return {app, workspace};
}
