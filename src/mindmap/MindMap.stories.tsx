import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { MindMap } from './components/MindMap';
import { createTree, fromOutline } from './model/tree';
import { organisation, productLaunch, softwareFactory, thinkingPatterns } from './samples';

const meta = {
  title: 'MindMap/Examples',
  component: MindMap,
  args: { style: { width: '100vw', height: '100vh' } },
} satisfies Meta<typeof MindMap>;

export default meta;
type Story = StoryObj<typeof meta>;

// ---- helpers for play functions ------------------------------------------------

const topicTexts = (root: HTMLElement) =>
  within(root)
    .queryAllByTestId('topic-text')
    .map((t) => t.textContent);

const topicByText = (root: HTMLElement, text: string) =>
  within(root)
    .getAllByTestId('topic')
    .find((t) => t.querySelector('[data-testid="topic-text"]')?.textContent === text)!;

const selectedText = (root: HTMLElement) =>
  root.querySelector('[data-testid="topic"][aria-selected="true"]')?.textContent;

async function waitForTopics(root: HTMLElement, count: number) {
  await waitFor(() => expect(within(root).getAllByTestId('topic')).toHaveLength(count));
}

/** Types into the active topic editor and commits with Enter. */
async function typeTopic(root: HTMLElement, text: string) {
  const editor = await within(root).findByTestId('topic-editor');
  await waitFor(() => expect(editor).toHaveFocus());
  await userEvent.clear(editor);
  await userEvent.type(editor, `${text}{Enter}`);
  await waitFor(() => expect(within(root).queryByTestId('topic-editor')).toBeNull());
}

// ---- stories -------------------------------------------------------------------

/** An empty map: build it from the keyboard (Tab = child, Enter = sibling). */
export const Blank: Story = {
  args: { initialTree: createTree('Central Topic') },
  play: async ({ canvasElement, step }) => {
    await waitForTopics(canvasElement, 1);
    await userEvent.click(topicByText(canvasElement, 'Central Topic'));

    await step('Tab creates a main topic', async () => {
      await userEvent.keyboard('{Tab}');
      await typeTopic(canvasElement, 'Goals');
    });
    await step('Enter creates a sibling', async () => {
      await userEvent.keyboard('{Enter}');
      await typeTopic(canvasElement, 'Risks');
    });
    await step('Tab on a main topic creates a subtopic', async () => {
      await userEvent.keyboard('{Tab}');
      await typeTopic(canvasElement, 'Scope creep');
    });

    await waitForTopics(canvasElement, 4);
    await expect(topicTexts(canvasElement)).toEqual(
      expect.arrayContaining(['Central Topic', 'Goals', 'Risks', 'Scope creep']),
    );
    await expect(topicByText(canvasElement, 'Scope creep').dataset.depth).toBe('2');
  },
};

/** The "Software Factory" example from the spec rendered as a Logic Chart. */
export const SoftwareFactoryLogicChart: Story = {
  args: { initialTree: fromOutline(softwareFactory), initialLayout: 'logic' },
  play: async ({ canvasElement, step }) => {
    await waitForTopics(canvasElement, 16);
    await userEvent.click(topicByText(canvasElement, 'Software Factory'));

    await step('arrow keys follow the layout', async () => {
      await userEvent.keyboard('{ArrowRight}{ArrowDown}{ArrowRight}');
      await waitFor(() => expect(selectedText(canvasElement)).toBe('Availability'));
    });

    await step('Delete removes the topic, Ctrl+Z restores it', async () => {
      await userEvent.keyboard('{Delete}');
      await waitForTopics(canvasElement, 15);
      await waitFor(() => expect(selectedText(canvasElement)).toBe('Reliability'));
      await userEvent.keyboard('{Control>}z{/Control}');
      await waitForTopics(canvasElement, 16);
    });

    const root = topicByText(canvasElement, 'Software Factory');
    for (const t of canvasElement.querySelectorAll<HTMLElement>('[data-testid="topic"]')) {
      if (t !== root) await expect(t.dataset.side).toBe('right');
    }
  },
};

/** Balanced mind map: main topics are split between the right and the left side. */
export const BalancedMindMap: Story = {
  args: { initialTree: fromOutline(productLaunch), initialLayout: 'mindmap' },
  play: async ({ canvasElement }) => {
    await waitForTopics(canvasElement, 18);
    const side = (t: string) => topicByText(canvasElement, t).dataset.side;
    await expect(['Goals', 'Audience', 'Channels'].map(side)).toEqual(['right', 'right', 'right']);
    await expect(['Timeline', 'Risks', 'Budget'].map(side)).toEqual(['left', 'left', 'left']);

    const root = topicByText(canvasElement, 'Product Launch').getBoundingClientRect();
    const risks = topicByText(canvasElement, 'Risks').getBoundingClientRect();
    await expect(risks.right).toBeLessThan(root.left);
  },
};

/** Top-down Org Chart; the toolbar switches between layouts. */
export const OrgChart: Story = {
  args: { initialTree: fromOutline(organisation), initialLayout: 'org' },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await waitForTopics(canvasElement, 11);
    await expect(topicByText(canvasElement, 'CTO').dataset.side).toBe('down');

    await step('switch to Logic Chart and back', async () => {
      await userEvent.click(canvas.getByTestId('layout-logic'));
      await waitFor(() => expect(topicByText(canvasElement, 'CTO').dataset.side).toBe('right'));
      await userEvent.click(canvas.getByTestId('layout-org'));
      await waitFor(() => expect(topicByText(canvasElement, 'CTO').dataset.side).toBe('down'));
    });

    const ceo = topicByText(canvasElement, 'CEO').getBoundingClientRect();
    await waitFor(() =>
      expect(topicByText(canvasElement, 'CFO').getBoundingClientRect().top).toBeGreaterThan(ceo.bottom),
    );
  },
};

/** Collapsed branches show how many topics they hide; click the badge or press Ctrl+/ to toggle. */
export const CollapsedBranches: Story = {
  args: { initialTree: fromOutline(thinkingPatterns), initialLayout: 'mindmap' },
  play: async ({ canvasElement, step }) => {
    await waitForTopics(canvasElement, 15);
    const badges = () => within(canvasElement).queryAllByTestId('collapse-badge');
    await expect(badges().map((b) => b.textContent)).toEqual(expect.arrayContaining(['3', '2']));

    await step('clicking a badge expands the branch', async () => {
      const decision = topicByText(canvasElement, 'Decision making');
      await userEvent.click(within(decision).getByTestId('collapse-badge'));
      await waitForTopics(canvasElement, 18);
    });

    await step('Ctrl+/ collapses the selected branch again', async () => {
      await userEvent.click(topicByText(canvasElement, 'Analysis'));
      await userEvent.keyboard('{Control>}/{/Control}');
      await waitForTopics(canvasElement, 13);
      await expect(within(topicByText(canvasElement, 'Analysis')).getByTestId('collapse-badge')).toHaveTextContent('5');
    });
  },
};
