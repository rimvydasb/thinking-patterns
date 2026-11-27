import {expect, test, type Locator, type Page} from '@playwright/test';

const MOD = 'ControlOrMeta';

const topics = (page: Page) => page.getByTestId('topic');
const topic = (page: Page, text: string) =>
    page.getByTestId('topic').filter({has: page.getByTestId('topic-text').getByText(text, {exact: true})});
const selected = (page: Page) => page.locator('[data-testid="topic"][aria-selected="true"]');
const editor = (page: Page) => page.getByTestId('topic-editor');

async function box(l: Locator) {
    const b = await l.boundingBox();
    if (!b) throw new Error('element has no box');
    return {...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2};
}

async function open(page: Page, query = '') {
    await page.goto(`/${query}${query ? '&' : '?'}offline`);
    await expect(topics(page).first()).toBeVisible();
    await expect(page.getByTestId('mindmap')).toBeFocused();
}

/** Types text into the active editor and commits it with Enter. */
async function typeAndCommit(page: Page, text: string) {
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(editor(page)).toHaveCount(0);
}

test.describe('creating topics', () => {
    test('starts with a selected central topic', async ({page}) => {
        await open(page);
        await expect(topics(page)).toHaveCount(1);
        await expect(selected(page)).toHaveText('Central Topic');
    });

    test('Tab adds a child in edit mode, Enter commits it', async ({page}) => {
        await open(page);
        await page.keyboard.press('Tab');
        await expect(editor(page)).toBeFocused();
        await expect(editor(page)).toHaveValue('Main Topic');
        await typeAndCommit(page, 'Ideas');

        await expect(topics(page)).toHaveCount(2);
        await expect(selected(page)).toHaveText('Ideas');
        await expect(async () => {
            const root = await box(topic(page, 'Central Topic'));
            const child = await box(topic(page, 'Ideas'));
            expect(child.x).toBeGreaterThan(root.x + root.width);
        }).toPass();
        // Keyboard control returns to the canvas after editing.
        await expect(page.getByTestId('mindmap')).toBeFocused();
    });

    test('Enter adds a sibling after', async ({page}) => {
        await open(page, '?layout=logic');
        await page.keyboard.press('Tab');
        await typeAndCommit(page, 'A');
        await page.keyboard.press('Enter');
        await typeAndCommit(page, 'B');

        await expect(async () => {
            const ys = await Promise.all(['A', 'B'].map(async (t) => (await box(topic(page, t))).cy));
            expect(ys[0]).toBeLessThan(ys[1]);
        }).toPass();
    });

    test('Tab inside the editor commits and creates a grandchild', async ({page}) => {
        await open(page, '?layout=logic');
        await page.keyboard.press('Tab');
        await page.keyboard.press(`${MOD}+a`);
        await page.keyboard.type('Parent');
        await page.keyboard.press('Tab');
        await expect(editor(page)).toHaveValue('Subtopic');
        await page.keyboard.press('Enter');

        await expect(topic(page, 'Parent')).toHaveAttribute('data-depth', '1');
        await expect(topic(page, 'Subtopic')).toHaveAttribute('data-depth', '2');
    });

    test('toolbar buttons add topics', async ({page}) => {
        await open(page);
        await page.getByTestId('add-child').click();
        await page.keyboard.press('Enter');
        await page.getByTestId('add-sibling').click();
        await page.keyboard.press('Enter');
        await expect(topics(page)).toHaveCount(3);
    });
});

test.describe('editing', () => {
    test('typing on a selected topic replaces its text', async ({page}) => {
        await open(page);
        await page.keyboard.type('My plan');
        await expect(editor(page)).toHaveValue('My plan');
        await page.keyboard.press('Enter');
        await expect(topics(page)).toHaveText(['My plan']);
    });

    test('Escape cancels editing', async ({page}) => {
        await open(page);
        await page.keyboard.press('F2');
        await page.keyboard.type(' changed');
        await page.keyboard.press('Escape');
        await expect(topics(page)).toHaveText(['Central Topic']);
    });

    test('double click starts editing', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        await topic(page, 'Events').dblclick();
        await expect(editor(page)).toHaveValue('Events');
        await page.keyboard.type('Event Sourcing');
        await page.keyboard.press('Enter');
        await expect(topic(page, 'Event Sourcing')).toBeVisible();
    });

    test('Shift+Enter in the editor inserts a line break', async ({page}) => {
        await open(page);
        await page.keyboard.press('F2');
        await page.keyboard.press('End');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('second line');
        await page.keyboard.press('Enter');
        await expect(topics(page)).toHaveText(['Central Topic\nsecond line']);
    });
});

test.describe('selection and structure', () => {
    test('arrow keys follow the logic chart layout', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        await page.keyboard.press('ArrowRight');
        await expect(selected(page)).toHaveText('Loops');
        await page.keyboard.press('ArrowDown');
        await expect(selected(page)).toHaveText('Software Quality Attributes');
        await page.keyboard.press('ArrowRight');
        await expect(selected(page)).toHaveText('Availability');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await expect(selected(page)).toHaveText('Software Factory');
    });

    test('clicking selects a topic', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        await topic(page, 'Security').click();
        await expect(selected(page)).toHaveText('Security');
        await page.keyboard.press('ArrowDown');
        await expect(selected(page)).toHaveText('Maintainability');
    });

    test('Delete removes a subtree; undo and redo restore it', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        await expect(topics(page)).toHaveCount(16);
        await topic(page, 'Software Quality Attributes').click();
        await page.keyboard.press('Delete');
        await expect(topics(page)).toHaveCount(6);
        await expect(selected(page)).toHaveText('Formal Verification For Each software attribute');

        await page.keyboard.press(`${MOD}+z`);
        await expect(topics(page)).toHaveCount(16);
        await page.keyboard.press(`${MOD}+Shift+z`);
        await expect(topics(page)).toHaveCount(6);
    });

    test('the central topic cannot be deleted', async ({page}) => {
        await open(page);
        await page.keyboard.press('Backspace');
        await expect(topics(page)).toHaveCount(1);
        await expect(page.getByTestId('delete')).toBeDisabled();
    });

    test('Alt+Arrow reorders siblings', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        await topic(page, 'Events').click();
        await page.keyboard.press('Alt+ArrowUp');
        await expect(async () => {
            const formal = await box(topic(page, 'Formal Verification For Each software attribute'));
            const ev = await box(topic(page, 'Events'));
            expect(ev.cy).toBeLessThan(formal.cy);
        }).toPass();
    });

    test('dragging a topic onto another moves it there with its subtree', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        const dragged = topic(page, 'Software Quality Attributes');
        const target = topic(page, 'Events');
        await expect(dragged).toHaveAttribute('data-depth', '1');
        await expect(topic(page, 'Security')).toHaveAttribute('data-depth', '2');

        const from = await box(dragged);
        const to = await box(target);
        await page.mouse.move(from.cx, from.cy);
        await page.mouse.down();
        await page.mouse.move(from.cx + 10, from.cy + 10, {steps: 3});
        await page.mouse.move(to.cx, to.cy, {steps: 10});
        await expect(target).toHaveAttribute('data-drop-target', 'true');
        await page.mouse.up();

        await expect(dragged).toHaveAttribute('data-depth', '2');
        await expect(topic(page, 'Security')).toHaveAttribute('data-depth', '3');
        await expect(selected(page)).toHaveText('Software Quality Attributes');
        await expect(topics(page)).toHaveCount(16);

        await page.keyboard.press(`${MOD}+z`);
        await expect(dragged).toHaveAttribute('data-depth', '1');
    });

    test('dropping a topic on empty canvas leaves the map unchanged', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        const dragged = topic(page, 'Events');
        const root = topic(page, 'Software Factory');
        // Relative to the parent: selecting the dropped topic may pan the view.
        const offset = async () => (await box(dragged)).cy - (await box(root)).cy;
        const before = await offset();
        const from = await box(dragged);
        await page.mouse.move(from.cx, from.cy);
        await page.mouse.down();
        await page.mouse.move(from.cx + 10, from.cy + 200, {steps: 10});
        await page.mouse.up();
        await expect(dragged).toHaveAttribute('data-depth', '1');
        await expect(async () => expect(Math.abs((await offset()) - before)).toBeLessThan(2)).toPass();
    });

    test('Ctrl/Cmd+click builds a multi-selection; a plain click or Esc resets it', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        await topic(page, 'Security').click();
        await topic(page, 'Events').click({modifiers: ['ControlOrMeta']});
        await topic(page, 'Loops').click({modifiers: ['ControlOrMeta']});
        await expect(selected(page)).toHaveCount(3);
        await topic(page, 'Events').click({modifiers: ['ControlOrMeta']});
        await expect(selected(page)).toHaveCount(2);
        await page.keyboard.press('Escape');
        await expect(selected(page)).toHaveCount(1);
        await expect(selected(page)).toHaveText('Loops');

        await topic(page, 'Events').click({modifiers: ['ControlOrMeta']});
        await topic(page, 'Security').click();
        await expect(selected(page)).toHaveCount(1);
        await expect(selected(page)).toHaveText('Security');
    });

    test('dragging one of several selected topics moves them all', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        await topic(page, 'Security').click();
        await topic(page, 'Loops').click({modifiers: ['ControlOrMeta']});
        const target = topic(page, 'Events');

        const from = await box(topic(page, 'Loops'));
        const to = await box(target);
        await page.mouse.move(from.cx, from.cy);
        await page.mouse.down();
        await page.mouse.move(from.cx + 10, from.cy + 10, {steps: 3});
        await page.mouse.move(to.cx, to.cy, {steps: 10});
        await expect(target).toHaveAttribute('data-drop-target', 'true');
        await expect(topic(page, 'Security')).toHaveClass(/is-dragging/);
        await page.mouse.up();

        await expect(topic(page, 'Loops')).toHaveAttribute('data-depth', '2');
        await expect(topic(page, 'Security')).toHaveAttribute('data-depth', '2');
        await expect(selected(page)).toHaveCount(2);

        await page.keyboard.press(`${MOD}+z`);
        await expect(topic(page, 'Loops')).toHaveAttribute('data-depth', '1');
        await expect(topic(page, 'Security')).toHaveAttribute('data-depth', '2');
        await expect(async () => {
            const sec = await box(topic(page, 'Security'));
            const qa = await box(topic(page, 'Software Quality Attributes'));
            expect(sec.x).toBeGreaterThan(qa.x + qa.width);
        }).toPass();
    });

    test('collapse hides descendants and the badge expands them', async ({page}) => {
        await open(page, '?sample=software-factory&layout=logic');
        await topic(page, 'Software Quality Attributes').click();
        await page.keyboard.press(`${MOD}+/`);
        await expect(topics(page)).toHaveCount(7);
        const badge = topic(page, 'Software Quality Attributes').getByTestId('collapse-badge');
        await expect(badge).toHaveText('9');
        await badge.click();
        await expect(topics(page)).toHaveCount(16);
    });
});

test.describe('layouts', () => {
    test('logic chart grows to the right', async ({page}) => {
        await open(page, '?sample=product-launch&layout=logic');
        const root = await box(topic(page, 'Product Launch'));
        for (const t of ['Goals', 'Risks', 'Budget']) {
            expect((await box(topic(page, t))).x).toBeGreaterThan(root.x + root.width);
        }
    });

    test('mind map balances branches on both sides', async ({page}) => {
        await open(page, '?sample=product-launch');
        const root = await box(topic(page, 'Product Launch'));
        for (const t of ['Goals', 'Audience', 'Channels']) {
            expect((await box(topic(page, t))).x).toBeGreaterThan(root.x + root.width);
        }
        for (const t of ['Timeline', 'Risks', 'Budget']) {
            const b = await box(topic(page, t));
            expect(b.x + b.width).toBeLessThan(root.x);
        }
        // Arrow keys on the left side are mirrored.
        await page.keyboard.press('ArrowLeft');
        await expect(selected(page)).toHaveText('Timeline');
        await page.keyboard.press('ArrowLeft');
        await expect(selected(page)).toHaveText('Beta – March');
    });

    test('org chart grows downwards', async ({page}) => {
        await open(page, '?sample=organisation&layout=org');
        const root = await box(topic(page, 'CEO'));
        const cto = await box(topic(page, 'CTO'));
        const qa = await box(topic(page, 'QA'));
        expect(cto.y).toBeGreaterThan(root.y + root.height);
        expect(qa.y).toBeGreaterThan(cto.y + cto.height);
        await page.keyboard.press('ArrowDown');
        await expect(selected(page)).toHaveText('CTO');
        await page.keyboard.press('ArrowRight');
        await expect(selected(page)).toHaveText('CFO');
    });

    test('layout can be switched from the toolbar', async ({page}) => {
        await open(page, '?sample=organisation');
        await page.getByTestId('layout-org').click();
        await expect(page.getByTestId('mindmap')).toHaveAttribute('data-layout', 'org');
        await expect(page.getByTestId('layout-org')).toHaveAttribute('aria-pressed', 'true');
        await expect(async () => {
            const root = await box(topic(page, 'CEO'));
            const cfo = await box(topic(page, 'CFO'));
            expect(cfo.y).toBeGreaterThan(root.y + root.height);
        }).toPass();
    });

    test('topics never overlap', async ({page}) => {
        for (const q of [
            '?sample=software-factory&layout=logic',
            '?sample=thinking-patterns',
            '?sample=organisation&layout=org',
        ]) {
            await open(page, q);
            const boxes = await topics(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
            for (let i = 0; i < boxes.length; i++)
                for (let j = i + 1; j < boxes.length; j++) {
                    const a = boxes[i];
                    const b = boxes[j];
                    const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
                    expect(overlap, `${q}: topics ${i} and ${j} overlap`).toBe(false);
                }
        }
    });
});

test.describe('AI brainstorming', () => {
    /** Answers bridge calls with `answers` in turn, each after `delayMs`. */
    async function mockBridge(page: Page, answers: string[], delayMs = 300) {
        await page.route('http://127.0.0.1:3456/**', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/health')) return route.fulfill({json: {ok: true}});
            if (url.endsWith('/v1/models')) return route.fulfill({json: {data: [{id: 'haiku'}, {id: 'sonnet'}]}});
            await new Promise((r) => setTimeout(r, delayMs));
            await route.fulfill({json: {choices: [{message: {role: 'assistant', content: answers.shift() ?? ''}}]}});
        });
    }

    test('shows the bridge status and model in the top-right chip', async ({page}) => {
        await mockBridge(page, []);
        await open(page);
        await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'connected');
        await expect(page.getByTestId('ai-status')).toHaveText('haiku');
    });

    test('Shift+Tab and Shift+Enter add topics at once and fill in generated names', async ({page}) => {
        await mockBridge(page, ['Apple', 'Banana']);
        await open(page);
        await page.keyboard.press('Shift+Tab');
        await expect(topics(page)).toHaveCount(2);
        await expect(page.getByTestId('topic-spinner')).toHaveCount(1);
        await expect(page.getByTestId('ai-task')).toContainText('Generating node');
        await page.keyboard.press('Shift+Enter');
        await expect(topics(page)).toHaveCount(3);

        await expect(topic(page, 'Apple')).toBeVisible();
        await expect(topic(page, 'Banana')).toBeVisible();
        await expect(selected(page)).toHaveText('Banana');
        await expect(page.getByTestId('topic-spinner')).toHaveCount(0);
        await expect(page.getByTestId('ai-task')).toHaveCount(0);
    });

    test('Shift+Tab on a topic without subtopics generates a list of them', async ({page}) => {
        await mockBridge(page, ['Apple\nBanana\nCherry']);
        await open(page);
        await page.keyboard.press('Shift+Tab');
        await expect(topics(page)).toHaveCount(2);
        for (const fruit of ['Apple', 'Banana', 'Cherry']) await expect(topic(page, fruit)).toBeVisible();
        await expect(topics(page)).toHaveCount(4);
        await expect(selected(page)).toHaveText('Apple');

        await page.keyboard.press(`${MOD}+z`);
        await expect(topics(page)).toHaveCount(1);
    });

    test('settings change the model', async ({page}) => {
        await mockBridge(page, []);
        await open(page);
        await page.getByTestId('open-settings').click();
        await page.getByTestId('settings-dialog').getByRole('button', {name: 'sonnet'}).click();
        await page.getByTestId('settings-save').click();
        await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
        await expect(page.getByTestId('ai-status')).toHaveText('sonnet');
        await expect(page.getByTestId('mindmap')).toBeFocused();
    });
});

test.describe('markdown import / export', () => {
    test('exports the map as a Markdown download', async ({page}) => {
        await open(page);
        await page.getByTestId('import-export').click();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByTestId('export-markdown').click(),
        ]);
        expect(download.suggestedFilename()).toBe('Central Topic.md');
        const chunks: Buffer[] = [];
        for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
        expect(Buffer.concat(chunks).toString('utf8')).toBe('---\nmindmap: 1\n---\n\n# Map\n\n- Central Topic\n');
        await expect(page.getByTestId('export-markdown')).toHaveCount(0);
    });

    test('imports a Markdown file and undo restores the previous map', async ({page}) => {
        await open(page);
        await page.getByTestId('import-export').click();
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.getByTestId('import-markdown').click(),
        ]);
        await chooser.setFiles({
            name: 'ideas.md',
            mimeType: 'text/markdown',
            buffer: Buffer.from('---\nmindmap: 1\n---\n\n# Map\n\n- Ideas\n  - First\n  - Second\n'),
        });
        await expect(page.getByTestId('import-status')).toHaveText('Imported ideas.md');
        await expect(topics(page)).toHaveCount(3);
        await expect(topic(page, 'Second')).toBeVisible();

        await page.keyboard.press(`${MOD}+z`);
        await expect(topics(page)).toHaveCount(1);
        await expect(topic(page, 'Central Topic')).toBeVisible();
    });

    test('refuses a Markdown file without the mindmap: 1 flag', async ({page}) => {
        await open(page);
        await page.getByTestId('import-export').click();
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.getByTestId('import-markdown').click(),
        ]);
        await chooser.setFiles({name: 'readme.md', mimeType: 'text/markdown', buffer: Buffer.from('- A list\n')});
        await expect(page.getByTestId('import-status')).toContainText('This is not a mind map file');
        await expect(topics(page)).toHaveCount(1);
    });
});

test.describe('topic icons', () => {
    test('the top-right icon button opens a panel; icons replace within a group and add across groups', async ({
        page,
    }) => {
        await open(page);
        const toggle = page.getByTestId('icon-panel-toggle');
        const panel = page.getByTestId('icon-panel');
        const icons = selected(page).getByTestId('topic-icons').locator('[data-icon]');
        await expect(panel).toHaveCount(0);

        await toggle.click();
        await expect(panel).toBeVisible();
        await page.getByTestId('icon-one').click();
        await page.getByTestId('icon-star').click();
        await expect(icons).toHaveCount(2);
        expect(await icons.evaluateAll((els) => els.map((e) => e.getAttribute('data-icon')))).toEqual(['one', 'star']);

        // Same group: replaces "one" in place.
        await page.getByTestId('icon-three').click();
        expect(await icons.evaluateAll((els) => els.map((e) => e.getAttribute('data-icon')))).toEqual([
            'three',
            'star',
        ]);
        await expect(page.getByTestId('icon-three')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('mindmap')).toBeFocused();

        await toggle.click();
        await expect(panel).toHaveCount(0);
    });
});
