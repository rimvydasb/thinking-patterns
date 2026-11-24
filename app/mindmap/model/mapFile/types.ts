import type {MindMapTree} from '../types';

/** The content of a `.map.md` file (format v1, see docs/map-file-lifecycle-story.md "File format v1"). */
export interface MapFileModel {
    /** Topics with notes. Ids are random (`newId`), the file holds no ids. */
    tree: MindMapTree;
    /** Frontmatter lines between the `---` markers, verbatim. */
    frontmatter: string;
    /** Other `#` sections, verbatim, in file order. Empty string if there are none. */
    extraSections: string;
    /** Notes whose heading matches no topic (or a topic that already has a note), in file order. */
    orphanNotes: OrphanNote[];
}

export interface OrphanNote {
    heading: string;
    body: string;
}

export interface Diagnostic {
    /** 1-based line in the file. */
    line: number;
    /** An error makes the file invalid. */
    severity: 'error' | 'warning';
    /** Shown to the user and to agents as is. */
    message: string;
}

export type ParseResult =
    {ok: true; model: MapFileModel; diagnostics: Diagnostic[]} | {ok: false; diagnostics: Diagnostic[]};

/** Frontmatter of a new map file. */
export const DEFAULT_FRONTMATTER = 'mindmap: 1';
