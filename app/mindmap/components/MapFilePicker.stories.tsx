import type {Meta, StoryObj} from '@storybook/react-vite';
import {expect, fn, userEvent, waitFor, within} from 'storybook/test';
import {ApiError, type MapFilesApi} from '../sync/mapFilesApi';
import type {DirListing, FileState} from '../sync/protocol';
import {MapFilePicker} from './MapFilePicker';

const ROOT = '/Users/me/maps';

/** A fake server directory: directory path -> entries. */
const TREE: Record<string, {name: string; kind: 'dir' | 'file'}[]> = {
    [ROOT]: [
        {name: 'archive', kind: 'dir'},
        {name: 'plan.map.md', kind: 'file'},
        {name: 'roadmap.map.md', kind: 'file'},
    ],
    [`${ROOT}/archive`]: [{name: '2025.map.md', kind: 'file'}],
};

const state = (path: string, s: FileState['state'] = 'clean'): FileState => ({
    path,
    state: s,
    diagnostics: [],
    writtenAt: null,
    changedOnDiskAt: null,
});

function fakeApi(opts: {openError?: ApiError} = {}): MapFilesApi {
    return {
        listFiles: fn(async (dir?: string): Promise<DirListing> => {
            const d = dir ?? ROOT;
            const entries = TREE[d];
            if (!entries) throw new ApiError(`Not a directory: ${d}`, 400);
            return {
                root: ROOT,
                dir: d,
                parent: d === ROOT ? null : d.slice(0, d.lastIndexOf('/')),
                entries: entries.map((e) => ({...e, path: `${d}/${e.name}`})),
            };
        }),
        openFile: fn(async (path: string) => {
            if (opts.openError) throw opts.openError;
            return state(path);
        }),
    };
}

const meta = {
    title: 'MapFile/MapFilePicker',
    component: MapFilePicker,
    args: {onOpened: fn(), onCancel: fn(), currentFile: null},
} satisfies Meta<typeof MapFilePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No file is open. The user browses into a folder and opens a file. */
export const NoFileOpen: Story = {
    args: {api: fakeApi()},
    play: async ({canvasElement, args, step}) => {
        const c = within(canvasElement);
        await step('lists folders first, then map files', async () => {
            await waitFor(() =>
                expect(c.getAllByTestId(/picker-(dir|file)/).map((e) => e.textContent)).toEqual([
                    '📁archive',
                    '🧠plan.map.md',
                    '🧠roadmap.map.md',
                ]),
            );
        });
        await step('can be closed (the map then stays unsaved)', async () => {
            await userEvent.click(c.getByTestId('picker-close'));
            await expect(args.onCancel).toHaveBeenCalledOnce();
        });
        await step('navigates into a folder and back with the breadcrumbs', async () => {
            await userEvent.click(c.getByText('archive'));
            await waitFor(() => expect(c.getByTestId('picker-crumbs')).toHaveTextContent('maps/archive'));
            await userEvent.click(c.getByRole('button', {name: 'maps'}));
            await waitFor(() => expect(c.getByTestId('picker-crumbs')).toHaveTextContent(/^maps$/));
            await userEvent.click(c.getByText('archive'));
            await waitFor(() => expect(c.getByTestId('picker-up')).toBeInTheDocument());
        });
        await step('opens a file by its absolute path', async () => {
            await userEvent.click(await c.findByText('2025.map.md'));
            await waitFor(() => expect(args.onOpened).toHaveBeenCalledWith(state(`${ROOT}/archive/2025.map.md`)));
            await expect(args.api!.openFile).toHaveBeenCalledWith(`${ROOT}/archive/2025.map.md`, {create: false});
        });
    },
};

/** A file is open: the picker starts in its folder, marks it, and can be closed. */
export const SwitchFile: Story = {
    args: {api: fakeApi(), currentFile: state(`${ROOT}/plan.map.md`)},
    play: async ({canvasElement, args}) => {
        const c = within(canvasElement);
        await waitFor(() =>
            expect(c.getByText('plan.map.md').closest('button')).toHaveAttribute('aria-current', 'true'),
        );
        await userEvent.keyboard('{Escape}');
        await expect(args.onCancel).toHaveBeenCalledOnce();
        await userEvent.click(c.getByTestId('picker-close'));
        await expect(args.onCancel).toHaveBeenCalledTimes(2);
    },
};

/** The open file is invalid: switching drops its unwritten changes, so the picker asks first. */
export const ConfirmSwitchFromInvalid: Story = {
    args: {api: fakeApi(), currentFile: state(`${ROOT}/plan.map.md`, 'invalid')},
    play: async ({canvasElement, args}) => {
        const c = within(canvasElement);
        await userEvent.click(await c.findByText('roadmap.map.md'));
        await expect(c.getByTestId('picker-confirm')).toHaveTextContent('The open file is invalid');
        await expect(args.api!.openFile).not.toHaveBeenCalled();
        await userEvent.click(c.getByRole('button', {name: 'Back'}));
        await expect(c.queryByTestId('picker-confirm')).toBeNull();
        await userEvent.click(c.getByText('roadmap.map.md'));
        await userEvent.click(c.getByTestId('picker-confirm-open'));
        await waitFor(() => expect(args.onOpened).toHaveBeenCalledWith(state(`${ROOT}/roadmap.map.md`)));
    },
};

/** "New map" creates `<folder>/<name>.md`; a name that already ends in `.md` or `.markdown` is kept. */
export const CreateNewMap: Story = {
    args: {api: fakeApi()},
    play: async ({canvasElement, args}) => {
        const c = within(canvasElement);
        await c.findByText('plan.map.md');
        await expect(c.getByTestId('picker-create')).toBeDisabled();
        await userEvent.type(c.getByTestId('picker-new-name'), 'ideas');
        await userEvent.click(c.getByTestId('picker-create'));
        await waitFor(() => expect(args.api!.openFile).toHaveBeenCalledWith(`${ROOT}/ideas.md`, {create: true}));
        await userEvent.clear(c.getByTestId('picker-new-name'));
        await userEvent.type(c.getByTestId('picker-new-name'), 'notes.markdown');
        await userEvent.click(c.getByTestId('picker-create'));
        await waitFor(() => expect(args.api!.openFile).toHaveBeenCalledWith(`${ROOT}/notes.markdown`, {create: true}));
        await waitFor(() => expect(args.onOpened).toHaveBeenCalled());
    },
};

/** The server refuses: the picker shows its message and stays open. */
export const ServerError: Story = {
    args: {api: fakeApi({openError: new ApiError(`The file already exists: ${ROOT}/plan.map.md`, 409)})},
    play: async ({canvasElement, args}) => {
        const c = within(canvasElement);
        await c.findByText('plan.map.md');
        await userEvent.type(c.getByTestId('picker-new-name'), 'plan.map.md');
        await userEvent.click(c.getByTestId('picker-create'));
        await waitFor(() => expect(c.getByTestId('picker-error')).toHaveTextContent('The file already exists'));
        await expect(args.onOpened).not.toHaveBeenCalled();
    },
};
