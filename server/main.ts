import {buildServer} from './app';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';

const {app} = await buildServer({logger: {level: process.env.LOG_LEVEL ?? 'info'}});
await app.listen({port, host});
app.log.info(`MCP endpoint: http://${host}:${port}/mcp`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.close().then(() => process.exit(0)));
}
