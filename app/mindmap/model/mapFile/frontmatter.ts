import {isLayoutKind, LAYOUT_KINDS, type LayoutKind} from '../types';

/** Frontmatter key that holds the layout of the map, e.g. `mindmap-layout: logic`. */
export const LAYOUT_KEY = 'mindmap-layout';

const LAYOUT_LINE = new RegExp(`^${LAYOUT_KEY}:[ \\t]*(.*?)[ \\t]*$`, 'm');
const FLAG_LINE = /^mindmap:[ \t]*1[ \t]*$/m;

export type FrontmatterLayout = {layout?: LayoutKind; error?: string};

/** Reads the layout from the frontmatter. An unknown value gives `error` and no layout. */
export function readLayout(frontmatter: string): FrontmatterLayout {
    const m = LAYOUT_LINE.exec(frontmatter);
    if (!m) return {};
    const value = m[1].replace(/^(["'])(.*)\1$/, '$2');
    if (isLayoutKind(value)) return {layout: value};
    return {error: `Unknown layout "${m[1]}" in "${LAYOUT_KEY}". Use one of: ${LAYOUT_KINDS.join(', ')}.`};
}

/**
 * The frontmatter with the `mindmap-layout` line set to `layout`: replaced in place, or added after the
 * `mindmap: 1` line. `undefined` removes a line with a known layout; a line with an unknown value stays (it reads back
 * as no layout). Other lines stay verbatim.
 */
export function writeLayout(frontmatter: string, layout: LayoutKind | undefined): string {
    const lines = frontmatter.split('\n');
    const at = lines.findIndex((l) => LAYOUT_LINE.test(l));
    if (!layout) {
        if (at < 0 || !readLayout(lines[at]).layout) return frontmatter;
        return lines.filter((_, i) => i !== at).join('\n');
    }
    const line = `${LAYOUT_KEY}: ${layout}`;
    if (at >= 0) {
        if (lines[at] === line) return frontmatter;
        lines[at] = line;
    } else {
        const flag = lines.findIndex((l) => FLAG_LINE.test(l));
        lines.splice(flag + 1, 0, line);
    }
    return lines.join('\n');
}
