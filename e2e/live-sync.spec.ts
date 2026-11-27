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

/** Opens the file picker from the import / export menu. */
async function openPicker(page: Page) {
    await page.getByTestId('import-export').click();
    await page.getByTestId('menu-open-file').click();
    await expect(page.getByTestId('map-file-picker')).toBeVisible();
}

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

        await openPicker(page);
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
        await openPicker(page);
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

    test('with no file open and none remembered, the app starts with a Central Topic draft, not the picker', async ({
        page,
    }) => {
        await server.stop();
        server = await startServer({MAPS_DIR: mapsDir});
        await page.goto('/');
        await expect(topic(page, 'Central Topic')).toBeVisible();
        await expect(page.getByTestId('file-status')).toHaveText('Not saved');
        await page.reload();
        await expect(topic(page, 'Central Topic')).toBeVisible();
        const picker = page.getByTestId('map-file-picker');
        await expect(picker).toHaveCount(0);
        await expect(page.getByTestId('open-file')).toHaveCount(0);

        await openPicker(page);
        await picker.getByTestId('picker-close').click();
        await expect(picker).toHaveCount(0);

        await openPicker(page);
        await picker.getByTestId('picker-new-name').fill('fresh');
        await picker.getByTestId('picker-create').click();
        await expect(picker).toHaveCount(0);
        await expect(page.getByTestId('file-path')).toHaveText(path.join(mapsDir, 'fresh.md'));
        expect(await readFile(path.join(mapsDir, 'fresh.md'), 'utf8')).toBe(mapText('- Central Topic'));
    });

    test('a Markdown file without the mindmap: 1 flag is refused as not a mind map file', async ({page}) => {
        await writeFile(path.join(mapsDir, 'readme.md'), '# Readme\n\n- Just a list\n');
        await page.goto('/');
        // Earlier tests may leave another file open; the refused file must not replace it.
        const filePath = page.getByTestId('file-path');
        await expect(filePath).toBeVisible();
        const before = (await filePath.textContent())!;
        await openPicker(page);
        const picker = page.getByTestId('map-file-picker');
        await picker
            .getByTestId('picker-file')
            .filter({hasText: /^🧠readme\.md$/})
            .click();
        await expect(picker.getByTestId('picker-error')).toContainText('This is not a mind map file');
        await expect(filePath).toHaveText(before);
    });

    test('the picker lists and opens any Markdown file', async ({page}) => {
        await writeFile(path.join(mapsDir, 'notes.md'), mapText('- Plain notes', '  - Item'));
        await page.goto('/');
        await openPicker(page);
        const picker = page.getByTestId('map-file-picker');
        await picker
            .getByTestId('picker-file')
            .filter({hasText: /^🧠notes\.md$/})
            .click();
        await expect(picker).toHaveCount(0);
        await expect(topic(page, 'Plain notes')).toBeVisible();
        await openPicker(page);
        await page.keyboard.press('Escape');
        await expect(picker).toHaveCount(0);
    });

    // Last: it leaves an invalid file open.
    test('a mind map file without a "# Map" section opens with a parse error', async ({page}) => {
        const broken = path.join(mapsDir, 'broken.md');
        await writeFile(broken, '---\nmindmap: 1\n---\n\n# Notes\n');
        await page.goto('/');
        await openPicker(page);
        await page
            .getByTestId('map-file-picker')
            .getByTestId('picker-file')
            .filter({hasText: /^🧠broken\.md$/})
            .click();
        await expect(page.getByTestId('file-banner')).toContainText('exactly one "# Map" section');
    });
});
