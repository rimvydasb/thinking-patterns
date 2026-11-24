import {FILES_PATH, OPEN_MAP_PATH, type DirListing, type FileState, type OpenMapRequest} from './protocol';

/** A refused REST request. `status` is the HTTP status (400, 404, 409, ...), 0 for a network error. */
export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

/** REST calls of the map file picker (D11). `baseUrl` is the server origin; empty for the page origin. */
export interface MapFilesApi {
    listFiles(dir?: string): Promise<DirListing>;
    openFile(path: string, opts?: {create?: boolean}): Promise<FileState>;
}

export function createMapFilesApi(baseUrl = '', fetchFn: typeof fetch = (...a) => fetch(...a)): MapFilesApi {
    const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
        let res: Response;
        try {
            res = await fetchFn(`${baseUrl}${url}`, init);
        } catch (err) {
            throw new ApiError(`The server is not reachable: ${String(err)}`, 0);
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status}).`, res.status);
        return body as T;
    };
    return {
        listFiles: (dir) => request<DirListing>(`${FILES_PATH}${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
        openFile: (path, opts = {}) =>
            request<FileState>(OPEN_MAP_PATH, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({path, ...(opts.create ? {create: true} : {})} satisfies OpenMapRequest),
            }),
    };
}
