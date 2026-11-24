import {z} from 'zod';
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
]) satisfies z.ZodType<MapOp>;

/** A nested topic as agents write it. */
export const topicInputSchema: z.ZodType<Outline> = z.lazy(() =>
    z.object({
        text: z.string().min(1).describe('Topic text. Use \\n for a line break.'),
        collapsed: z.boolean().optional().describe('Show the topic folded (its children hidden).'),
        children: z.array(topicInputSchema).optional(),
    }),
);

export const clientMessageSchema = z.discriminatedUnion('type', [
    z.object({type: z.literal('hello'), clientId: id}),
    z.object({type: z.literal('ops'), seq: z.number().int().min(1), ops: z.array(mapOpSchema)}),
    z.object({type: z.literal('selection'), topicId: id}),
]);
