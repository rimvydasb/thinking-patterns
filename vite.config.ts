import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

/** The dev server proxies `/api` (REST and the sync WebSocket) to the MCP/sync server (`npm run server`). */
const serverUrl = process.env.SERVER_URL ?? 'http://localhost:3001';

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': {target: serverUrl, ws: true},
        },
    },
});
