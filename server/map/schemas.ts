import {z} from 'zod';
import {isIconCode} from '../../app/mindmap/model/icons';
import type {MapOp} from '../../app/mindmap/model/ops';
import type {Outline} from '../../app/mindmap/model/types';

const id = z.string().min(1);
const index = z.number().int().min(0);

/** Validates one `MapOp` (see app/mindmap/model/ops.ts). */
export const mapOpSchema = z.discriminatedUnion('op', [
    z.object({op: z.literal('add'), id, parentId: id, index, text: z.string()}),
    z.object({op: z.literal('remove'), id}),
    z.object({op: z.literal('move'), id, parentId: id, index}),
    z.object({op: z.literal('setText'), id, text: z.string()}),
    z.object({op: z.literal('setCollapsed'), id, collapsed: z.boolean()}),
    z.object({op: z.literal('setNote'), id, note: z.string()}),
    z.object({op: z.literal('setIcons'), id, icons: z.array(z.string().refine(isIconCode, 'Unknown icon'))}),
]) satisfies z.ZodType<MapOp>;

/** Icon shortcodes of a topic, as agents give them. */
export const iconsSchema = z
    .array(z.string().refine(isIconCode, 'Unknown icon. Use a shortcode such as "star" (see list_icons).'))
    .describe(
        'Icon shortcodes shown in front of the topic, without colons, e.g. ["one", "star"]. At most one per ' +
            'group; see the list_icons tool.',
    );

/** A nested topic as agents write it. */
export const topicInputSchema: z.ZodType<Outline> = z.lazy(() =>
    z.object({
        text: z.string().min(1).describe('Topic text. Use \\n for a line break.'),
        collapsed: z.boolean().optional().describe('Show the topic folded (its children hidden).'),
        note: z.string().optional().describe('Markdown note of the topic.'),
        icons: iconsSchema.optional(),
        children: z.array(topicInputSchema).optional(),
    }),
);

export const clientMessageSchema = z.discriminatedUnion('type', [
    z.object({type: z.literal('hello'), clientId: id}),
    z.object({type: z.literal('ops'), seq: z.number().int().min(1), ops: z.array(mapOpSchema)}),
    z.object({type: z.literal('selection'), topicId: id}),
    z.object({type: z.literal('writeFile')}),
]);
