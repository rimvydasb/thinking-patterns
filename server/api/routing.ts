import type {FastifyInstance} from 'fastify';
import type {MapDocument} from '../map/mapDocument';

/** Small read-only REST API for health checks and debugging. */
export async function apiRoutes(app: FastifyInstance, opts: {doc: MapDocument}) {
    app.get('/api/health', async () => ({ok: true}));
    app.get('/api/map', async () => ({version: opts.doc.version, tree: opts.doc.tree}));
}
