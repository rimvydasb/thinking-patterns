/**
 * Topic icons: GitHub emoji shortcodes (https://gist.github.com/rxaviers/7360908), grouped like XMind markers.
 * A topic holds at most one icon per group: picking another icon of the same group replaces it, an icon of another
 * group is added. The map file writes icons in front of the topic text as `:shortcode:` tokens.
 */

export interface IconDef {
    /** Shortcode without the colons, e.g. `star`. */
    code: string;
    /** The emoji. */
    emoji: string;
}

export interface IconGroup {
    id: string;
    label: string;
    icons: IconDef[];
}

const VS = '️';
const keycap = (d: string) => `${d}${VS}⃣`;

const group = (id: string, label: string, icons: [string, string][]): IconGroup => ({
    id,
    label,
    icons: icons.map(([code, emoji]) => ({code, emoji})),
});

/** The panel shows 7 icons per row, so every group holds 7 or 14 icons (full rows). */
export const ICON_GROUPS: readonly IconGroup[] = [
    group('priority', 'Priority', [
        ['zero', keycap('0')],
        ['one', keycap('1')],
        ['two', keycap('2')],
        ['three', keycap('3')],
        ['four', keycap('4')],
        ['five', keycap('5')],
        ['six', keycap('6')],
        ['seven', keycap('7')],
        ['eight', keycap('8')],
        ['nine', keycap('9')],
        ['keycap_ten', '🔟'],
        ['hash', keycap('#')],
        ['1234', '🔢'],
        ['top', '🔝'],
    ]),
    group('task', 'Task', [
        ['white_square', '⬜'],
        ['arrow_forward', `▶${VS}`],
        ['hourglass_flowing_sand', '⏳'],
        ['construction', '🚧'],
        ['white_check_mark', '✅'],
        ['x', '❌'],
        ['no_entry', '⛔'],
    ]),
    group('signal', 'Signal', [
        ['warning', `⚠${VS}`],
        ['exclamation', '❗'],
        ['question', '❓'],
        ['bangbang', `‼${VS}`],
        ['interrobang', `⁉${VS}`],
        ['no_entry_sign', '🚫'],
        ['rotating_light', '🚨'],
    ]),
    group('feedback', 'Feedback', [
        ['+1', '👍'],
        ['-1', '👎'],
        ['ok_hand', '👌'],
        ['clap', '👏'],
        ['muscle', '💪'],
        ['pray', '🙏'],
        ['wave', '👋'],
    ]),
    group('star', 'Star', [
        ['star', '⭐'],
        ['star2', '🌟'],
        ['sparkles', '✨'],
        ['dizzy', '💫'],
        ['trophy', '🏆'],
        ['crown', '👑'],
        ['gem', '💎'],
    ]),
    group('marker', 'Marker', [
        ['triangular_flag_on_post', '🚩'],
        ['checkered_flag', '🏁'],
        ['crossed_flags', '🎌'],
        ['round_pushpin', '📍'],
        ['pushpin', '📌'],
        ['bookmark', '🔖'],
        ['paperclip', '📎'],
    ]),
    group('color', 'Color', [
        ['red_circle', '🔴'],
        ['large_orange_diamond', '🔶'],
        ['large_blue_circle', '🔵'],
        ['large_blue_diamond', '🔷'],
        ['small_red_triangle', '🔺'],
        ['black_circle', '⚫'],
        ['white_circle', '⚪'],
    ]),
    group('heart', 'Heart', [
        ['heart', `❤${VS}`],
        ['yellow_heart', '💛'],
        ['green_heart', '💚'],
        ['blue_heart', '💙'],
        ['purple_heart', '💜'],
        ['sparkling_heart', '💖'],
        ['broken_heart', '💔'],
    ]),
    group('business', 'Business', [
        ['briefcase', '💼'],
        ['office', '🏢'],
        ['bank', '🏦'],
        ['moneybag', '💰'],
        ['dollar', '💵'],
        ['credit_card', '💳'],
        ['chart_with_upwards_trend', '📈'],
        ['chart_with_downwards_trend', '📉'],
        ['bar_chart', '📊'],
        ['clipboard', '📋'],
        ['memo', '📝'],
        ['page_facing_up', '📄'],
        ['scroll', '📜'],
        ['ledger', '📒'],
    ]),
    group('process', 'Process', [
        ['inbox_tray', '📥'],
        ['outbox_tray', '📤'],
        ['repeat', '🔁'],
        ['arrows_clockwise', '🔃'],
        ['twisted_rightwards_arrows', '🔀'],
        ['recycle', `♻${VS}`],
        ['link', '🔗'],
        ['vertical_traffic_light', '🚦'],
        ['wrench', '🔧'],
        ['hammer', '🔨'],
        ['nut_and_bolt', '🔩'],
        ['mag', '🔍'],
        ['file_folder', '📁'],
        ['card_index', '📇'],
    ]),
    group('tech', 'Technology', [
        ['computer', '💻'],
        ['iphone', '📱'],
        ['floppy_disk', '💾'],
        ['cd', '💿'],
        ['minidisc', '💽'],
        ['tv', '📺'],
        ['electric_plug', '🔌'],
        ['battery', '🔋'],
        ['satellite', '📡'],
        ['signal_strength', '📶'],
        ['globe_with_meridians', '🌐'],
        ['bug', '🐛'],
        ['key', '🔑'],
        ['lock', '🔒'],
    ]),
    group('idea', 'Idea', [
        ['bulb', '💡'],
        ['zap', '⚡'],
        ['fire', '🔥'],
        ['rocket', '🚀'],
        ['dart', '🎯'],
        ['books', '📚'],
        ['pencil2', `✏${VS}`],
        ['mortar_board', '🎓'],
        ['microscope', '🔬'],
        ['telescope', '🔭'],
        ['art', '🎨'],
        ['gift', '🎁'],
        ['tada', '🎉'],
        ['100', '💯'],
    ]),
    group('time', 'Time', [
        ['hourglass', '⌛'],
        ['alarm_clock', '⏰'],
        ['watch', '⌚'],
        ['clock3', '🕒'],
        ['date', '📅'],
        ['calendar', '📆'],
        ['soon', '🔜'],
    ]),
    group('communication', 'Communication', [
        ['speech_balloon', '💬'],
        ['thought_balloon', '💭'],
        ['loudspeaker', '📢'],
        ['mega', '📣'],
        ['bell', '🔔'],
        ['email', `✉${VS}`],
        ['phone', `☎${VS}`],
    ]),
    group('people', 'People', [
        ['bust_in_silhouette', '👤'],
        ['busts_in_silhouette', '👥'],
        ['man', '👨'],
        ['woman', '👩'],
        ['boy', '👦'],
        ['girl', '👧'],
        ['older_man', '👴'],
        ['older_woman', '👵'],
        ['person_with_blond_hair', '👱'],
        ['family', '👪'],
        ['raising_hand', '🙋'],
        ['information_desk_person', '💁'],
        ['construction_worker', '👷'],
        ['cop', '👮'],
    ]),
    group('mood', 'Mood', [
        ['smile', '😄'],
        ['grinning', '😀'],
        ['heart_eyes', '😍'],
        ['wink', '😉'],
        ['sunglasses', '😎'],
        ['neutral_face', '😐'],
        ['confused', '😕'],
        ['worried', '😟'],
        ['disappointed', '😞'],
        ['cry', '😢'],
        ['sweat', '😓'],
        ['scream', '😱'],
        ['rage', '😡'],
        ['sleeping', '😴'],
    ]),
    group('arrow', 'Arrow', [
        ['arrow_up', `⬆${VS}`],
        ['arrow_down', `⬇${VS}`],
        ['arrow_left', `⬅${VS}`],
        ['arrow_right', `➡${VS}`],
        ['arrow_upper_right', `↗${VS}`],
        ['arrow_lower_right', `↘${VS}`],
        ['arrows_counterclockwise', '🔄'],
    ]),
    group('other', 'Other', [
        ['house', '🏠'],
        ['airplane', `✈${VS}`],
        ['car', '🚗'],
        ['runner', '🏃'],
        ['coffee', '☕'],
        ['musical_note', '🎵'],
        ['video_game', '🎮'],
    ]),
];

const BY_CODE = new Map<string, {icon: IconDef; group: IconGroup; order: number}>();
ICON_GROUPS.forEach((g, gi) => g.icons.forEach((icon) => BY_CODE.set(icon.code, {icon, group: g, order: gi})));

export function isIconCode(code: string): boolean {
    return BY_CODE.has(code);
}

/** The emoji of a shortcode, or `null` for an unknown code. */
export function iconEmoji(code: string): string | null {
    return BY_CODE.get(code)?.icon.emoji ?? null;
}

export function iconGroupOf(code: string): IconGroup | null {
    return BY_CODE.get(code)?.group ?? null;
}

/** Shortcode as written in Markdown: `:star:`. */
export const iconToken = (code: string) => `:${code}:`;

/** A known `:shortcode:` at the start of a line, followed by a space or the end of the line. */
const LEADING_TOKEN = /^:([a-z0-9_+-]+):(?=\s|$)/;

/** True if `line` starts with a known icon token (the map file would read it as an icon). */
export function startsWithIconToken(line: string): boolean {
    const m = LEADING_TOKEN.exec(line);
    return !!m && isIconCode(m[1]);
}

/**
 * Splits leading icon tokens off the first line of a topic: `:one: :star: Launch` gives `['one', 'star']` and
 * `Launch`. Unknown shortcodes stay in the text. All tokens stay text when no text would be left.
 */
export function splitLeadingIcons(line: string): {icons: string[]; text: string} {
    const icons: string[] = [];
    let rest = line;
    for (;;) {
        const m = LEADING_TOKEN.exec(rest);
        if (!m || !isIconCode(m[1])) break;
        icons.push(m[1]);
        rest = rest.slice(m[0].length).trimStart();
    }
    if (!rest) return {icons: [], text: line};
    return {icons: normalizeIcons(icons), text: rest};
}

/** Known codes only, at most one per group (the last one wins, at the position of the first). */
export function normalizeIcons(codes: readonly string[]): string[] {
    let out: string[] = [];
    for (const code of codes) if (isIconCode(code)) out = toggleIcon(out, code, true);
    return out;
}

/**
 * The icons after picking `code`:
 * - an icon the topic has is removed (unless `keep`),
 * - an icon of a group the topic has an icon of replaces that icon in place,
 * - any other icon is added at the end.
 */
export function toggleIcon(icons: readonly string[], code: string, keep = false): string[] {
    const g = iconGroupOf(code);
    if (!g) return [...icons];
    if (icons.includes(code)) return keep ? [...icons] : icons.filter((c) => c !== code);
    const at = icons.findIndex((c) => iconGroupOf(c) === g);
    if (at < 0) return [...icons, code];
    return icons.map((c, i) => (i === at ? code : c));
}

export function sameIcons(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    const x = a ?? [];
    const y = b ?? [];
    return x.length === y.length && x.every((c, i) => c === y[i]);
}
