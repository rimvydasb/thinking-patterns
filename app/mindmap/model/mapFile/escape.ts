/**
 * Escapes for topic text lines in the `# Map` list. A line of topic text that starts like a Markdown block (a bullet,
 * a heading, a quote, a fence, a setext underline or a thematic break) would change the list structure, so the
 * serializer puts a backslash in front of it. The parser removes exactly these backslashes again.
 * Text that starts with a known icon shortcode (`:star: …`) is escaped the same way, so it is not read as an icon.
 */

import {startsWithIconToken} from '../icons';

const ORDERED = /^(\d{1,9})([.)])(?=\s|$)/;
const BLOCK_START = /^(?:[-+*](?:\s|$)|#{1,6}(?:\s|$)|>|=+\s*$|`{3,}|~{3,}|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;

/** Escapes one line of topic text so it reads as paragraph text inside a list item. */
export function escapeTopicLine(line: string): string {
    if (ORDERED.test(line)) return line.replace(ORDERED, '$1\\$2');
    // A leading backslash that the parser would remove is itself text, so it gets one more backslash.
    if (
        BLOCK_START.test(line) ||
        startsWithIconToken(line) ||
        (line.startsWith('\\') && unescapeTopicLine(line) !== line)
    )
        return `\\${line}`;
    return line;
}

/** Reverses `escapeTopicLine`. Other backslashes stay as the user wrote them. */
export function unescapeTopicLine(line: string): string {
    const ordered = /^(\d{1,9})\\([.)])/.exec(line);
    if (ordered) {
        const plain = `${ordered[1]}${ordered[2]}${line.slice(ordered[0].length)}`;
        if (escapeTopicLine(plain) === line) return plain;
    }
    if (line.startsWith('\\') && escapeTopicLine(line.slice(1)) === line) return line.slice(1);
    return line;
}
