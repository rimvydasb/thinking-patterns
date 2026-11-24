import type {Meta, StoryObj} from '@storybook/react-vite';
import {expect, fn, userEvent, within} from 'storybook/test';
import {FileStatusBanner} from './FileStatusBanner';

const meta = {
    title: 'MapFile/FileStatusBanner',
    component: FileStatusBanner,
    args: {onWrite: fn()},
} satisfies Meta<typeof FileStatusBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The file does not parse: the banner lists the errors and offers to write the app version. */
export const Invalid: Story = {
    args: {
        file: {
            path: '/Users/me/maps/plan.map.md',
            state: 'invalid',
            diagnostics: [
                {line: 8, severity: 'error', message: 'Git conflict marker. Resolve the merge conflict first.'},
                {line: 12, severity: 'warning', message: 'Note "Gone" matches no topic.'},
            ],
            writtenAt: null,
            changedOnDiskAt: '2026-11-24T10:00:00.000Z',
        },
    },
    play: async ({canvasElement, args}) => {
        const c = within(canvasElement);
        await expect(c.getByTestId('file-banner')).toHaveTextContent('The map file has errors');
        await expect(c.getByTestId('file-diagnostics')).toHaveTextContent(
            'Line 8: Git conflict marker. Resolve the merge conflict first.',
        );
        await expect(c.getByTestId('file-diagnostics')).not.toHaveTextContent('matches no topic');
        await userEvent.click(c.getByTestId('write-file'));
        await expect(args.onWrite).toHaveBeenCalledOnce();
    },
};

/** The file was deleted or renamed. */
export const Missing: Story = {
    args: {
        file: {
            path: '/Users/me/maps/plan.map.md',
            state: 'missing',
            diagnostics: [],
            writtenAt: null,
            changedOnDiskAt: null,
        },
    },
    play: async ({canvasElement}) => {
        const c = within(canvasElement);
        await expect(c.getByTestId('file-banner')).toHaveTextContent('File not found');
        await expect(c.getByTestId('file-banner')).toHaveTextContent('/Users/me/maps/plan.map.md');
        await expect(c.getByTestId('write-file')).toHaveTextContent('Write the app version to the file');
    },
};

/** In the clean state the banner shows nothing. */
export const Clean: Story = {
    args: {
        file: {
            path: '/Users/me/maps/plan.map.md',
            state: 'clean',
            diagnostics: [],
            writtenAt: null,
            changedOnDiskAt: null,
        },
    },
    play: async ({canvasElement}) => {
        await expect(within(canvasElement).queryByTestId('file-banner')).toBeNull();
    },
};
