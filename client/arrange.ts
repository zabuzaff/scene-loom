import type { PointData, ProjectData } from '../shared/schema';
import type { SceneNode } from './SceneCard';

export function arrangeScenes(
  nodes: SceneNode[],
  connections: ProjectData['connections'],
): Map<string, PointData> {
  const gap = 100;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map(nodes.map(({ id }) => [id, new Set<string>()]));
  const neighbors = new Map(nodes.map(({ id }) => [id, new Set<string>()]));
  const indegree = new Map(nodes.map(({ id }) => [id, 0]));
  for (const { sourceSceneId: from, targetSceneId: to } of connections) {
    if (from === to || !byId.has(from) || !byId.has(to)) continue;
    const targets = outgoing.get(from)!;
    if (targets.has(to)) continue;
    targets.add(to);
    neighbors.get(from)!.add(to);
    neighbors.get(to)!.add(from);
    indegree.set(to, indegree.get(to)! + 1);
  }

  const width = (id: string) => byId.get(id)!.measured?.width ?? 300;
  const height = (id: string) => byId.get(id)!.measured?.height ?? 300;
  const positions = new Map<string, PointData>();
  const visited = new Set<string>();
  const isolated: string[] = [];
  let groupY = 0;

  for (const { id } of nodes) {
    if (visited.has(id)) continue;
    visited.add(id);
    if (!neighbors.get(id)!.size) {
      isolated.push(id);
      continue;
    }
    const group = [id];
    for (const member of group) {
      for (const neighbor of neighbors.get(member)!) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        group.push(neighbor);
      }
    }

    const ready = group.filter((member) => indegree.get(member) === 0);
    const placed = new Set<string>();
    const ranks = new Map<string, number>();
    const columns: string[][] = [];
    let nextCycleMember = 0;
    for (let index = 0; placed.size < group.length; index++) {
      if (index === ready.length) {
        while (placed.has(group[nextCycleMember])) nextCycleMember++;
        let entry = group[nextCycleMember];
        const path = new Set<string>();
        // Follow unplaced predecessors to break the cycle itself, rather than
        // forcing a downstream card into an earlier column.
        while (!path.has(entry)) {
          path.add(entry);
          const predecessor = [...neighbors.get(entry)!].find(
            (from) => !placed.has(from) && outgoing.get(from)!.has(entry),
          );
          if (predecessor === undefined) break;
          entry = predecessor;
        }
        ready.push(entry);
      }
      const member = ready[index];
      placed.add(member);
      const rank = ranks.get(member) ?? 0;
      (columns[rank] ??= []).push(member);
      for (const target of outgoing.get(member)!) {
        if (placed.has(target)) continue;
        ranks.set(target, Math.max(ranks.get(target) ?? 0, rank + 1));
        const remaining = indegree.get(target)! - 1;
        indegree.set(target, remaining);
        if (remaining === 0) ready.push(target);
      }
    }

    let x = 0;
    let groupHeight = 0;
    for (const column of columns) {
      let y = groupY;
      let columnWidth = 0;
      for (const member of column) {
        positions.set(member, { x, y });
        y += height(member) + gap;
        columnWidth = Math.max(columnWidth, width(member));
      }
      groupHeight = Math.max(groupHeight, y - groupY);
      x += columnWidth + gap;
    }
    groupY += groupHeight + gap;
  }

  for (let index = 0; index < isolated.length; index += 4) {
    let x = 0;
    let rowHeight = 0;
    for (const id of isolated.slice(index, index + 4)) {
      positions.set(id, { x, y: groupY });
      x += width(id) + gap;
      rowHeight = Math.max(rowHeight, height(id));
    }
    groupY += rowHeight + gap;
  }
  return positions;
}
