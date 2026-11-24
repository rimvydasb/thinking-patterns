import {createTree} from '../model/tree';
import {createMindMapStore} from '../store/mindmapStore';
import {ApiError} from './mapFilesApi';
import type {ClientMessage, FileState, ServerMessage} from './protocol';
import {connectSync, type SyncClientOptions, type SyncSocket} from './syncClient';

class FakeSocket implements SyncSocket {
    readyState = 0;
    sent: ClientMessage[] = [];
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: {data: unknown}) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    send(data: string) {
        this.sent.push(JSON.parse(data));
    }
    close() {
        this.readyState = 3;
        this.onclose?.({});
    }
    open() {
        this.readyState = 1;
        this.onopen?.({});
    }
    receive(msg: ServerMessage) {
        this.onmessage?.({data: JSON.stringify(msg)});
    }
}

const fileState = (path: string, state: FileState['state'] = 'clean'): FileState => ({
    path,
    state,
    diagnostics: [],
    writtenAt: null,
    changedOnDiskAt: null,
});

function setup(stored: string | null, openFile: SyncClientOptions['openFile'] = async () => ({})) {
    const socket = new FakeSocket();
    const files: (FileState | null)[] = [];
    const storage = {
        value: stored,
        load: () => storage.value,
        save: (p: string) => void (storage.value = p),
        clear: () => void (storage.value = null),
    };
    const opened: string[] = [];
    const client = connectSync({
        url: 'ws://localhost/api/sync',
        store: createMindMapStore(),
        createSocket: () => socket,
        onFile: (f) => files.push(f),
        lastMapFile: storage,
        openFile: (p) => {
            opened.push(p);
            return openFile(p);
        },
    });
    socket.open();
    return {socket, files, storage, opened, client};
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('connectSync and the map file', () => {
    it('passes the file of a snapshot and of file messages, and stores its path', () => {
        const {socket, files, storage, opened} = setup(null);
        socket.receive({
            type: 'snapshot',
            version: 1,
            tree: createTree('A', 'r1'),
            lastSeq: 0,
            file: fileState('/m/a.map.md'),
        });
        socket.receive({type: 'file', file: fileState('/m/a.map.md', 'writing')});
        expect(files).toEqual([fileState('/m/a.map.md'), fileState('/m/a.map.md', 'writing')]);
        expect(storage.value).toBe('/m/a.map.md');
        expect(opened).toEqual([]);
    });

    it('reopens the stored file when the server has none open', async () => {
        const {socket, files, opened} = setup('/m/last.map.md');
        socket.receive({type: 'file', file: null});
        await flush();
        expect(opened).toEqual(['/m/last.map.md']);
        expect(files).toEqual([]); // the snapshot of the reopened file follows
    });

    it('clears a stored path that returns 404 and reports no file (show the picker)', async () => {
        const {socket, files, storage} = setup('/m/gone.map.md', () => Promise.reject(new ApiError('gone', 404)));
        socket.receive({type: 'file', file: null});
        await flush();
        expect(storage.value).toBeNull();
        expect(files).toEqual([null]);
    });

    it('keeps a stored path after a network error, but still shows the picker', async () => {
        const {socket, files, storage} = setup('/m/a.map.md', () => Promise.reject(new ApiError('down', 0)));
        socket.receive({type: 'file', file: null});
        await flush();
        expect(storage.value).toBe('/m/a.map.md');
        expect(files).toEqual([null]);
    });

    it('does not send the stored path while the server has a file open', async () => {
        const {socket, opened, storage} = setup('/m/old.map.md');
        socket.receive({
            type: 'snapshot',
            version: 1,
            tree: createTree('B', 'r2'),
            lastSeq: 0,
            file: fileState('/m/b.map.md'),
        });
        await flush();
        expect(opened).toEqual([]);
        expect(storage.value).toBe('/m/b.map.md');
    });

    it('reports no file without reopening when the open file closes later', async () => {
        const {socket, files, opened} = setup('/m/a.map.md');
        socket.receive({
            type: 'snapshot',
            version: 1,
            tree: createTree('A', 'r1'),
            lastSeq: 0,
            file: fileState('/m/a.map.md'),
        });
        socket.receive({type: 'file', file: null});
        await flush();
        expect(opened).toEqual([]);
        expect(files.at(-1)).toBeNull();
    });

    it('sends writeFile', () => {
        const {socket, client} = setup(null);
        client.writeFile();
        expect(socket.sent.at(-1)).toEqual({type: 'writeFile'});
    });
});
