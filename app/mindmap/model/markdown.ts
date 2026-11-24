import type {Outline} from './types';

/**
 * Markdown list form of a mind map: one bullet per topic, two spaces of indentation per level.
 * Multi-line topic text continues on the following lines, indented to the bullet's text.
 *
 * ```md
 * - Central Topic
 *   - Main Topic
 *     - Subtopic
 * ```
 */
export function outlineToMarkdown(outlines: Outline | readonly Outline[]): string {
    const lines: string[] = [];
    const visit = (o: Outline, depth: number) => {
        const pad = '  '.repeat(depth);
        const [first, ...rest] = o.text.split('\n');
        lines.push(`${pad}- ${first}`);
        for (const line of rest) lines.push(`${pad}  ${line}`);
        o.children?.forEach((c) => visit(c, depth + 1));
    };
    (Array.isArray(outlines) ? outlines : [outlines]).forEach((o) => visit(o as Outline, 0));
    return lines.join('\n');
}

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Parses a Markdown list into outlines (a forest: every top-level bullet is one outline).
 * - Bullets `-`, `*`, `+` and `1.` are accepted; indentation can be spaces or tabs (a tab counts as 4 spaces).
 * - A non-bullet line that is indented deeper than the previous bullet continues that bullet's text.
 * - A `#` heading line becomes a top-level item; blank lines and other lines are ignored.
 */
export function markdownToOutlines(markdown: string): Outline[] {
    const roots: Outline[] = [];
    const stack: {indent: number; node: Outline}[] = [];

    const add = (indent: number, text: string) => {
        const node: Outline = {text};
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        const parent = stack[stack.length - 1]?.node;
        if (parent) (parent.children ??= []).push(node);
        else roots.push(node);
        stack.push({indent, node});
    };

    for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.replace(/\t/g, '    ').replace(/\s+$/, '');
        if (!line.trim()) continue;
        const bullet = BULLET.exec(line);
        if (bullet) {
            add(bullet[1].length, bullet[2].trim());
            continue;
        }
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) {
            stack.length = 0;
            add(-1, heading[1].trim());
            continue;
        }
        const last = stack[stack.length - 1];
        const indent = line.length - line.trimStart().length;
        if (last && last.indent >= 0 && indent > last.indent) last.node.text += `\n${line.trim()}`;
    }
    return roots;
}
