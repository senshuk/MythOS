/**
 * Pure layout for the visual dynasty tree (App.tsx `LineageDiagram`). Kept separate from the
 * component so the geometry — depths, tidy x-placement, and descent edges — is unit-testable
 * without a DOM. Input is the minimal shape a House member needs; nothing here touches React.
 */

/** The slice of a House member this layout reads. */
export interface LineageInput {
  id: number;
  reignStart: number;
  parentIds: number[]; // parents who are also members of this House
  childIds: number[]; // children who are also members of this House
}

export interface LineageNode {
  id: number;
  depth: number; // generation — longest chain of parents-within-the-House (roots at 0)
  x: number; // top-left of the node box
  y: number;
  cx: number; // horizontal centre (edges attach here)
}

export interface LineageEdge {
  from: number; // parent id
  to: number; // child id
  d: string; // SVG path, an elbow from parent-bottom to child-top
}

export interface LineageLayout {
  nodes: Map<number, LineageNode>;
  edges: LineageEdge[];
  width: number;
  height: number;
}

export const LINEAGE_METRICS = { NODE_W: 118, NODE_H: 26, GAP_X: 14, ROW: 58, PAD: 6 } as const;

/**
 * Lay the line out as a generation-layered tidy tree. Depth is the longest parent-chain (so a
 * member always sits below every ancestor); within the tree a parent is centred over its
 * children. Cycles (should never occur) are guarded so layout always terminates.
 */
export function layoutLineage(members: LineageInput[]): LineageLayout {
  const { NODE_W, NODE_H, GAP_X, ROW, PAD } = LINEAGE_METRICS;
  const byId = new Map(members.map((m) => [m.id, m]));

  // depth = 1 + max(parent depth); memoized, cycle-guarded.
  const depth = new Map<number, number>();
  const depthOf = (id: number, stack: Set<number>): number => {
    const memo = depth.get(id);
    if (memo !== undefined) return memo;
    if (stack.has(id)) return 0;
    stack.add(id);
    const m = byId.get(id)!;
    const d = m.parentIds.length ? 1 + Math.max(...m.parentIds.map((p) => (byId.has(p) ? depthOf(p, stack) : -1))) : 0;
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const m of members) depthOf(m.id, new Set());

  // x-slot via tidy post-order: leaves take successive slots; a parent centres over its kids.
  const slot = new Map<number, number>();
  const placed = new Set<number>();
  let next = 0;
  const place = (m: LineageInput): void => {
    if (placed.has(m.id)) return;
    placed.add(m.id);
    const kids = m.childIds.map((c) => byId.get(c)).filter((c): c is LineageInput => !!c && !placed.has(c.id));
    if (kids.length === 0) { slot.set(m.id, next++); return; }
    kids.forEach(place);
    const xs = kids.map((k) => slot.get(k.id)!);
    slot.set(m.id, (Math.min(...xs) + Math.max(...xs)) / 2);
  };
  [...members].filter((m) => m.parentIds.length === 0).sort((a, b) => a.reignStart - b.reignStart).forEach(place);
  for (const m of members) if (!slot.has(m.id)) slot.set(m.id, next++); // stragglers (e.g. a stray cycle)

  const stepX = NODE_W + GAP_X;
  const nodes = new Map<number, LineageNode>();
  for (const m of members) {
    const x = PAD + slot.get(m.id)! * stepX;
    const y = PAD + depth.get(m.id)! * ROW;
    nodes.set(m.id, { id: m.id, depth: depth.get(m.id)!, x, y, cx: x + NODE_W / 2 });
  }

  const edges: LineageEdge[] = [];
  for (const m of members) {
    for (const pid of m.parentIds) {
      const p = nodes.get(pid);
      const c = nodes.get(m.id);
      if (!p || !c) continue;
      const pBottom = p.y + NODE_H;
      const midY = pBottom + (c.y - pBottom) / 2;
      edges.push({ from: pid, to: m.id, d: `M ${p.cx} ${pBottom} V ${midY} H ${c.cx} V ${c.y}` });
    }
  }

  const maxDepth = Math.max(0, ...members.map((m) => depth.get(m.id)!));
  const width = PAD * 2 + Math.max(0, next - 1) * stepX + NODE_W;
  const height = PAD * 2 + maxDepth * ROW + NODE_H;
  return { nodes, edges, width, height };
}
