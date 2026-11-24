import type {FastifyInstance, FastifyReply} from 'fastify';
import {z} from 'zod';
import {FILES_PATH, OPEN_MAP_PATH} from '../../app/mindmap/sync/protocol';
import {WorkspaceError, type MapWorkspace} from '../map/mapWorkspace';

const openBodySchema = z.object({path: z.string().min(1), create: z.boolean().optional()});

/** Answers a workspace refusal with its status; other errors stay 500. */
function sendError(reply: FastifyReply, err: unknown) {
    if (err instanceof WorkspaceError) return reply.code(err.status).send({error: err.message});
    throw err;
}

/**
 * REST API: health, the open map (debugging), and the map file picker (D11): list the maps directory and open a
 * file by its absolute path. The result of an open reaches all apps as a sync `snapshot`.
 */
export async function apiRoutes(app: FastifyInstance, opts: {workspace: MapWorkspace}) {
    const {workspace} = opts;
    app.get('/api/health', async () => ({ok: true}));

    app.get('/api/map', async (_req, reply) => {
        const binding = workspace.current();
        if (!binding) return reply.code(404).send({error: 'No map file is open.'});
        return {version: binding.doc.version, tree: binding.doc.tree, file: binding.fileState()};
    });

    app.get<{Querystring: {dir?: string}}>(FILES_PATH, async (req, reply) => {
        try {
            return await workspace.listDir(req.query.dir || undefined);
        } catch (err) {
            return sendError(reply, err);
        }
    });

    app.post(OPEN_MAP_PATH, async (req, reply) => {
        const body = openBodySchema.safeParse(req.body);
        if (!body.success) return reply.code(400).send({error: 'Send {"path": "<absolute path>", "create"?: true}.'});
        try {
            return await workspace.open(body.data.path, {create: body.data.create});
        } catch (err) {
            return sendError(reply, err);
        }
    });
}
