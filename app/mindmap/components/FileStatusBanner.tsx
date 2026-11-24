import type {FileState} from '../sync/protocol';
import '../mapFile.css';

export interface FileStatusBannerProps {
    file: FileState;
    /** Writes the map in memory to the file (sync `writeFile`). */
    onWrite(): void;
}

/**
 * Shows why changes are not written while the map file is `invalid` or `missing` (D10), with the action that writes
 * the app version to the file. Renders nothing in the other states.
 */
export function FileStatusBanner({file, onWrite}: FileStatusBannerProps) {
    if (file.state !== 'invalid' && file.state !== 'missing') return null;
    const errors = file.diagnostics.filter((d) => d.severity === 'error');
    return (
        <div className="mf-banner" role="alert" data-testid="file-banner" data-state={file.state}>
            <div className="mf-banner__text">
                <strong>
                    {file.state === 'missing'
                        ? 'File not found. Changes are kept in the app but not saved.'
                        : 'The map file has errors. Changes are kept in the app but not saved.'}
                </strong>
                <div className="mf-banner__path">{file.path}</div>
                {errors.length > 0 && (
                    <ul className="mf-banner__list" data-testid="file-diagnostics">
                        {errors.map((d, i) => (
                            <li key={i}>
                                Line {d.line}: {d.message}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <button type="button" className="mf-button mf-button--primary" data-testid="write-file" onClick={onWrite}>
                Write the app version to the file
            </button>
        </div>
    );
}
