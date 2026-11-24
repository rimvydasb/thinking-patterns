import {MapDocument, type MapEvent} from '../mapDocument';

const add = (id: string, parentId = 'root') => ({op: 'add' as const, id, parentId, index: 0, text: id});

function setup() {
    const doc = new MapDocument();
    const events: MapEvent[] = [];
    doc.subscribe((e) => events.push(e));
    return {doc, events};
}

describe('MapDocument', () => {
    it('starts with an empty central topic', () => {
        const {doc} = setup();
        expect(doc.version).toBe(1);
        expect(doc.tree.nodes.root.text).toBe('Central Topic');
    });

    it('applies a batch as one version step and broadcasts the applied ops', () => {
        const {doc, events} = setup();
        expect(doc.apply([add('a'), add('b', 'missing')])).toEqual({version: 2, applied: [add('a')]});
        expect(events).toEqual([{type: 'patch', version: 2, ops: [add('a')]}]);
    });

    it('does not broadcast an agent batch without effect', () => {
        const {doc, events} = setup();
        expect(doc.apply([{op: 'remove', id: 'nope'}]).version).toBe(1);
        expect(events).toEqual([]);
    });

    it('acknowledges client batches even without effect and ignores re-sent ones', () => {
        const {doc, events} = setup();
        const origin = {clientId: 'c1', seq: 1};
        doc.apply([{op: 'remove', id: 'nope'}], {origin});
        expect(events).toEqual([{type: 'patch', version: 2, ops: [], origin}]);
        doc.apply([add('a')], {origin});
        expect(events).toHaveLength(1);
        expect(doc.tree.nodes.a).toBeUndefined();
    });

    it('drops a selection whose topic is removed', () => {
        const {doc} = setup();
        doc.apply([add('a')]);
        doc.setSelection('c1', 'a');
        expect(doc.selection?.topicId).toBe('a');
        doc.apply([{op: 'remove', id: 'a'}]);
        expect(doc.selection).toBeNull();
    });
});
