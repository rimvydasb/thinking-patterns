import {buildServer} from './app';
import {createMapWorkspace} from './map/mapWorkspace';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
/** Root of the map file picker (D11). */
const mapsDir = process.env.MAPS_DIR || process.cwd();
/** A map file to open at start; trusted configuration, so it may lie outside `MAPS_DIR`. */
const mapFile = process.env.MAP_FILE;

const workspace = createMapWorkspace(mapsDir);
if (mapFile) await workspace.open(mapFile, {trusted: true});

const {app} = await buildServer({workspace, logger: {level: process.env.LOG_LEVEL ?? 'info'}});
await app.listen({port, host});
app.log.info(`MCP endpoint: http://${host}:${port}/mcp`);
app.log.info(`Maps directory: ${workspace.root}`);
app.log.info(`Open map file: ${workspace.current()?.fileState().path ?? 'none (pick one in the app)'}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        void app
            .close()
            .then(() => workspace.close())
            .finally(() => process.exit(0));
    });
}
