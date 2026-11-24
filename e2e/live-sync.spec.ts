import {expect, test, type APIRequestContext, type Page} from '@playwright/test';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SERVER_URL, startServer, type RunningServer} from './server';

const MCP_URL = `${SERVER_URL}/mcp`;
const mapText = (...lines: string[]) => ['---', 'mindmap: 1', '---', '', '# Map', '', ...lines, ''].join('\n');

/** Calls an MCP tool the way an agent does (Streamable HTTP, stateless) and returns its JSON result. */
async function callTool(request: APIRequestContext, name: string, args: Record<string, unknown>) {
    const res = await request.post(MCP_URL, {
        headers: {accept: 'application/json, text/event-stream'},
        data: {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}},
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    return JSON.parse(body.result.content[0].text);
}

const topic = (page: Page, text: string) => page.getByTestId('topic').filter({hasText: text});

// The server holds one map, so tests that use it must not run in parallel.
test.describe.configure({mode: 'serial'});

let mapsDir: string;
let liveFile: string;
let server: RunningServer;

test.beforeAll(async () => {
    mapsDir = await realpath(await mkdtemp(path.join(tmpdir(), 'e2e-maps-')));
    liveFile = path.join(mapsDir, 'live.map.md');
    await writeFile(liveFile, mapText('- Central Topic'));
    server = await startServer({MAPS_DIR: mapsDir, MAP_FILE: liveFile});
});

test.afterAll(async () => {
    await server?.stop();
    await rm(mapsDir, {recursive: true, force: true});
});

test.describe('live sync with the MCP server', () => {
    test('agent changes appear in the open app without a reload', async ({page, request}) => {
        await page.goto('/');
        await expect(page.getByTestId('sync-status')).toHaveText('Live');
        await callTool(request, 'replace_map', {markdown: '- Central Topic'});

        const tag = `e2e ${Date.now()}`;
        await callTool(request, 'add_topics', {markdown: `- Pushed by agent ${tag}\n  - Nested topic ${tag}`});
        await expect(topic(page, `Pushed by agent ${tag}`)).toBeVisible();
        await expect(topic(page, `Nested topic ${tag}`)).toBeVisible();

        await callTool(request, 'focus_topic', {topicName: `Nested topic ${tag}`});
        await expect(page.locator('.mm-topic.is-selected')).toContainText(`Nested topic ${tag}`);

        // A user edit reaches the server and the agent can read it.
        await page.getByTestId('mindmap').focus();
        await page.keyboard.press('Tab');
        await page.keyboard.type(`Typed in the app ${tag}`);
        await page.keyboard.press('Enter');
        await expect
            .poll(async () => (await callTool(request, 'search_topics', {query: `Typed in the app ${tag}`})).matches)
            .toEqual([['Central Topic', `Pushed by agent ${tag}`, `Nested topic ${tag}`, `Typed in the app ${tag}`]]);
    });
});

test.describe('the map file', () => {
    test('a file edit on disk appears in the open app', async ({page}) => {
        await page.goto('/');
        await expect(page.getByTestId('file-status')).toHaveText('Saved');
        await expect(page.getByTestId('file-path')).toHaveText(liveFile);

        await writeFile(liveFile, mapText('- Central Topic', '  - Edited in a text editor', '    - Nested on disk'));
        await expect(topic(page, 'Edited in a text editor')).toBeVisible();
        await expect(topic(page, 'Nested on disk')).toBeVisible();
    });

    test('a GUI edit appears in the file', async ({page}) => {
        await writeFile(liveFile, mapText('- Central Topic'));
        await page.goto('/');
        await expect(page.getByTestId('topic')).toHaveCount(1);

        await page.getByTestId('mindmap').focus();
        await page.keyboard.press('Tab');
        await page.keyboard.type('Typed in the GUI');
        await page.keyboard.press('Enter');
        await expect.poll(() => readFile(liveFile, 'utf8')).toBe(mapText('- Central Topic', '  - Typed in the GUI'));
        await expect(page.getByTestId('file-status')).toHaveText('Saved');
    });

    test('the user opens a map file from the picker, and the map shows its topics', async ({page}) => {
        const other = path.join(mapsDir, 'picked.map.md');
        await writeFile(other, mapText('- Picked map', '  - First branch', '  - Second branch'));
        await page.goto('/');
        await expect(page.getByTestId('file-path')).toHaveText(liveFile);

        await page.getByTestId('open-file').click();
        const picker = page.getByTestId('map-file-picker');
        await expect(picker.getByTestId('picker-file')).toHaveText(['🧠live.map.md', '🧠picked.map.md']);
        await picker.getByText('picked.map.md').click();

        await expect(picker).toHaveCount(0);
        await expect(topic(page, 'Picked map')).toBeVisible();
        await expect(topic(page, 'Second branch')).toBeVisible();
        await expect(page.getByTestId('file-path')).toHaveText(other);
    });

    test('after a server restart without MAP_FILE, a reload of the page reopens the last file', async ({page}) => {
        const last = path.join(mapsDir, 'last.map.md');
        await writeFile(last, mapText('- Last opened map', '  - Still here'));
        await page.goto('/');
        await page.getByTestId('open-file').click();
        await page.getByTestId('map-file-picker').getByText('last.map.md').click();
        await expect(topic(page, 'Last opened map')).toBeVisible();

        await server.stop();
        await expect(page.getByTestId('sync-status')).not.toHaveText('Live');
        server = await startServer({MAPS_DIR: mapsDir});
        await page.reload();

        await expect(topic(page, 'Still here')).toBeVisible();
        await expect(page.getByTestId('file-path')).toHaveText(last);
        await expect(page.getByTestId('map-file-picker')).toHaveCount(0);
    });

    test('with no file open and none remembered, the picker shows and cannot be dismissed', async ({page}) => {
        await server.stop();
        server = await startServer({MAPS_DIR: mapsDir});
        await page.goto('/');
        const picker = page.getByTestId('map-file-picker');
        await expect(picker).toBeVisible();
        await expect(picker.getByTestId('picker-cancel')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(picker).toBeVisible();

        await picker.getByTestId('picker-new-name').fill('fresh');
        await picker.getByTestId('picker-create').click();
        await expect(picker).toHaveCount(0);
        await expect(topic(page, 'Central Topic')).toBeVisible();
        expect(await readFile(path.join(mapsDir, 'fresh.map.md'), 'utf8')).toBe(mapText('- Central Topic'));
    });
});
