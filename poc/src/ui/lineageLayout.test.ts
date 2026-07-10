import { describe, it, expect } from 'vitest';
import { layoutLineage, LINEAGE_METRICS, type LineageInput } from './lineageLayout';

const { NODE_W, NODE_H, ROW, PAD } = LINEAGE_METRICS;

// A → { B, C }; B → D. A tidy little dynasty: three generations, a fork at the top.
const dynasty: LineageInput[] = [
  { id: 1, reignStart: 10, parentIds: [], childIds: [2, 3] },
  { id: 2, reignStart: 40, parentIds: [1], childIds: [4] },
  { id: 3, reignStart: 42, parentIds: [1], childIds: [] },
  { id: 4, reignStart: 70, parentIds: [2], childIds: [] },
];

describe('layoutLineage — the dynasty tree geometry', () => {
  it('layers members by longest parent-chain (generation)', () => {
    const { nodes } = layoutLineage(dynasty);
    expect(nodes.get(1)!.depth).toBe(0); // founder
    expect(nodes.get(2)!.depth).toBe(1);
    expect(nodes.get(3)!.depth).toBe(1);
    expect(nodes.get(4)!.depth).toBe(2); // grandchild sits two rows down
    // rows map straight to y
    expect(nodes.get(1)!.y).toBe(PAD);
    expect(nodes.get(4)!.y).toBe(PAD + 2 * ROW);
  });

  it('centres a parent over its children and never overlaps siblings', () => {
    const { nodes, width, height } = layoutLineage(dynasty);
    // A is centred over B and C
    expect(nodes.get(1)!.cx).toBeCloseTo((nodes.get(2)!.cx + nodes.get(3)!.cx) / 2, 5);
    // siblings on the same row are at least a node-width apart (no overlap)
    const sameRow = [nodes.get(2)!, nodes.get(3)!].sort((a, b) => a.x - b.x);
    expect(sameRow[1].x - sameRow[0].x).toBeGreaterThanOrEqual(NODE_W);
    // the canvas encloses every node
    for (const n of nodes.values()) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + NODE_W).toBeLessThanOrEqual(width + 0.001);
      expect(n.y + NODE_H).toBeLessThanOrEqual(height + 0.001);
    }
  });

  it('draws one descent edge per parent link, connecting the right centres', () => {
    const { edges, nodes } = layoutLineage(dynasty);
    expect(edges.length).toBe(3); // 1→2, 1→3, 2→4
    const e = edges.find((x) => x.from === 1 && x.to === 2)!;
    // path starts at the parent's bottom-centre and ends at the child's top-centre
    expect(e.d.startsWith(`M ${nodes.get(1)!.cx} ${nodes.get(1)!.y + NODE_H}`)).toBe(true);
    expect(e.d.endsWith(`V ${nodes.get(2)!.y}`)).toBe(true);
  });

  it('degrades a kin-less line to a single row of roots', () => {
    const line: LineageInput[] = [1, 2, 3].map((id) => ({ id, reignStart: id * 10, parentIds: [], childIds: [] }));
    const { nodes, edges } = layoutLineage(line);
    expect(edges.length).toBe(0);
    expect([...nodes.values()].every((n) => n.depth === 0)).toBe(true); // all on one row
  });

  it('terminates on a pathological cycle instead of hanging', () => {
    const cyclic: LineageInput[] = [
      { id: 1, reignStart: 1, parentIds: [2], childIds: [2] },
      { id: 2, reignStart: 2, parentIds: [1], childIds: [1] },
    ];
    const { nodes } = layoutLineage(cyclic);
    expect(nodes.size).toBe(2); // laid out, no infinite recursion
  });
});
