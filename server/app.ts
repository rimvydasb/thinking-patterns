import websocket from '@fastify/websocket';
import Fastify, {type FastifyInstance, type FastifyServerOptions} from 'fastify';
import {apiRoutes} from './api/routing';
import {MapDocument} from './map/mapDocument';
import {mcpRoutes} from './mcp/routing';
import {syncRoutes} from './sync/routing';

export interface ServerOptions {
    doc?: MapDocument;
    logger?: FastifyServerOptions['logger'];
}

/** Builds the Fastify server: MCP (`/mcp`), app sync WebSocket (`/api/sync`) and REST (`/api/*`). */
export async function buildServer(opts: ServerOptions = {}): Promise<{app: FastifyInstance; doc: MapDocument}> {
    const doc = opts.doc ?? new MapDocument();
    const app = Fastify({logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024});
    await app.register(websocket);
    await app.register(apiRoutes, {doc});
    await app.register(syncRoutes, {doc});
    await app.register(mcpRoutes, {doc});
    return {app, doc};
}
