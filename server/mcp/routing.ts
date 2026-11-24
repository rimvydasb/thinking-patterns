import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {FastifyInstance} from 'fastify';
import type {MapWorkspace} from '../map/mapWorkspace';
import {createMcpServer} from './tools';

export const MCP_PATH = '/mcp';

/**
 * MCP over Streamable HTTP in stateless mode: every POST gets a fresh `McpServer` and transport. All state lives in
 * the `MapWorkspace` (the open map file), so no MCP session is needed. GET (server-initiated stream) and DELETE (session end) are not
 * supported in stateless mode and answer 405.
 */
export async function mcpRoutes(app: FastifyInstance, opts: {workspace: MapWorkspace}) {
    app.post(MCP_PATH, async (req, reply) => {
        const server = createMcpServer(opts.workspace);
        const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
        reply.raw.on('close', () => {
            void transport.close();
            void server.close();
        });
        await server.connect(transport);
        reply.hijack();
        await transport.handleRequest(req.raw, reply.raw, req.body);
    });

    const notAllowed = {jsonrpc: '2.0', error: {code: -32000, message: 'Method not allowed.'}, id: null};
    app.get(MCP_PATH, async (_req, reply) => reply.code(405).header('allow', 'POST').send(notAllowed));
    app.delete(MCP_PATH, async (_req, reply) => reply.code(405).header('allow', 'POST').send(notAllowed));
}
