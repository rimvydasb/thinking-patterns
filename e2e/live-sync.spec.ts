import {expect, test, type APIRequestContext} from '@playwright/test';
import {E2E_SERVER_PORT} from '../playwright.config';

const MCP_URL = `http://127.0.0.1:${E2E_SERVER_PORT}/mcp`;

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

// The server holds one map, so tests that use it must not run in parallel.
test.describe.configure({mode: 'serial'});

test.describe('live sync with the MCP server', () => {
    test('agent changes appear in the open app without a reload', async ({page, request}) => {
        await page.goto('/');
        await expect(page.getByTestId('sync-status')).toHaveText('Live');
        await callTool(request, 'replace_map', {markdown: '- Central Topic'});

        const tag = `e2e ${Date.now()}`;
        await callTool(request, 'add_topics', {markdown: `- Pushed by agent ${tag}\n  - Nested topic ${tag}`});
        await expect(page.getByTestId('topic').filter({hasText: `Pushed by agent ${tag}`})).toBeVisible();
        await expect(page.getByTestId('topic').filter({hasText: `Nested topic ${tag}`})).toBeVisible();

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
