import {FONT_FAMILY, topicStyle} from './theme';

export interface Size {
    width: number;
    height: number;
}

export type TextWidthFn = (text: string, font: string) => number;

let ctx: CanvasRenderingContext2D | null | undefined;

/** Canvas based text width; falls back to an estimate where no canvas exists (Node/Jest). */
export const canvasTextWidth: TextWidthFn = (text, font) => {
    if (ctx === undefined) {
        ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    }
    if (!ctx) return estimateTextWidth(text, font);
    ctx.font = font;
    return ctx.measureText(text).width;
};

export const estimateTextWidth: TextWidthFn = (text, font) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 14);
    return text.length * size * 0.56;
};

/** Greedy word wrap. Explicit newlines are kept. */
export function wrapText(text: string, maxWidth: number, font: string, measure: TextWidthFn): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
        const words = paragraph.split(/(\s+)/).filter((w) => w.length > 0);
        let line = '';
        for (const word of words) {
            const candidate = line + word;
            if (line && /\S/.test(word) && measure(candidate.trimEnd(), font) > maxWidth) {
                lines.push(line.trimEnd());
                line = word;
            } else {
                line = candidate;
            }
        }
        lines.push(line.trimEnd());
    }
    return lines;
}

export function fontFor(depth: number): string {
    const s = topicStyle(depth);
    return `${s.fontWeight} ${s.fontSize}px ${FONT_FAMILY}`;
}

/** Outer size of a topic box (text + padding). Must match the CSS in TopicNode. */
export function measureTopic(text: string, depth: number, measure: TextWidthFn = canvasTextWidth): Size {
    const s = topicStyle(depth);
    const font = fontFor(depth);
    const lines = wrapText(text || ' ', s.maxTextWidth, font, measure);
    const textWidth = Math.min(s.maxTextWidth, Math.max(...lines.map((l) => measure(l, font))));
    // +4px slack so the browser never wraps earlier than our estimate.
    const width = Math.ceil(Math.max(s.minWidth, textWidth + 4 + s.padX * 2));
    const height = Math.ceil(lines.length * s.fontSize * s.lineHeight + s.padY * 2);
    return {width, height};
}
