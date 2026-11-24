/** Visual tokens shared by layout (sizes) and rendering (colors). */

export const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface TopicStyle {
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    padX: number;
    padY: number;
    maxTextWidth: number;
    minWidth: number;
    radius: number;
}

export function topicStyle(depth: number): TopicStyle {
    if (depth === 0)
        return {
            fontSize: 26,
            fontWeight: 700,
            lineHeight: 1.25,
            padX: 28,
            padY: 16,
            maxTextWidth: 360,
            minWidth: 120,
            radius: 8,
        };
    if (depth === 1)
        return {
            fontSize: 17,
            fontWeight: 500,
            lineHeight: 1.3,
            padX: 16,
            padY: 9,
            maxTextWidth: 260,
            minWidth: 60,
            radius: 6,
        };
    return {
        fontSize: 14,
        fontWeight: 400,
        lineHeight: 1.35,
        padX: 8,
        padY: 5,
        maxTextWidth: 240,
        minWidth: 30,
        radius: 6,
    };
}

const BRANCH_COLORS = ['#F9C440', '#E86F55', '#24408E', '#2A9D8F', '#8E6CCB', '#3E8ED0', '#D9577F', '#6B9E3B'];
export const ROOT_COLOR = '#0B1660';

export function branchColor(index: number): string {
    if (index < 0) return ROOT_COLOR;
    return BRANCH_COLORS[index % BRANCH_COLORS.length];
}

function hexToRgb(hex: string): [number, number, number] {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
    return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Mixes `hex` with `other` (amount 0..1 of `other`). */
export function mix(hex: string, other: string, amount: number): string {
    const a = hexToRgb(hex);
    const b = hexToRgb(other);
    return rgbToHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as [number, number, number]);
}

export function isLight(hex: string): boolean {
    const [r, g, b] = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export interface TopicColors {
    background: string;
    text: string;
    line: string;
}

export function topicColors(depth: number, branch: number): TopicColors {
    const base = branchColor(branch);
    if (depth === 0) return {background: ROOT_COLOR, text: '#FFFFFF', line: ROOT_COLOR};
    if (depth === 1) return {background: base, text: isLight(base) ? '#1F1A0A' : '#FFFFFF', line: base};
    if (depth === 2) return {background: mix(base, '#FFFFFF', 0.8), text: mix(base, '#000000', 0.6), line: base};
    return {background: 'transparent', text: mix(base, '#000000', 0.6), line: base};
}
