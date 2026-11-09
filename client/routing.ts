import { Position } from '@xyflow/react';
import type { PointData } from '../shared/schema';

export type CardBounds = PointData & { halfWidth: number; halfHeight: number };
type Ports = [Position, Position];
const sides = [Position.Left, Position.Right, Position.Top, Position.Bottom];
const directions: Record<Position, PointData> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

function offset(point: PointData, side: Position, distance: number): PointData {
  const direction = directions[side];
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}

function anchor(card: CardBounds, side: Position): PointData {
  const horizontal = side === Position.Left || side === Position.Right;
  return offset(card, side, horizontal ? card.halfWidth : card.halfHeight);
}

export function connectionCurve(from: PointData, to: PointData, ports: Ports) {
  const [start, end] = ports;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const bend = start === end ? 72 : Math.max(32, Math.min(140, length * 0.38));
  const a = offset(from, start, bend);
  const b = offset(to, end, bend);
  const point = (t: number): PointData => {
    const u = 1 - t;
    return {
      x:
        u ** 3 * from.x +
        3 * u ** 2 * t * a.x +
        3 * u * t ** 2 * b.x +
        t ** 3 * to.x,
      y:
        u ** 3 * from.y +
        3 * u ** 2 * t * a.y +
        3 * u * t ** 2 * b.y +
        t ** 3 * to.y,
    };
  };
  return {
    path: `M ${from.x} ${from.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${to.x} ${to.y}`,
    point,
    bounds: {
      left: Math.min(from.x, a.x, b.x, to.x),
      right: Math.max(from.x, a.x, b.x, to.x),
      top: Math.min(from.y, a.y, b.y, to.y),
      bottom: Math.max(from.y, a.y, b.y, to.y),
    },
    length,
  };
}

function segmentHitsCard(from: PointData, to: PointData, card: CardBounds) {
  let enter = 0;
  let exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const halfSize = axis === 'x' ? card.halfWidth : card.halfHeight;
    const min = card[axis] - halfSize;
    const max = card[axis] + halfSize;
    const delta = to[axis] - from[axis];
    if (delta === 0) {
      if (from[axis] <= min || from[axis] >= max) return false;
      continue;
    }
    const near = (min - from[axis]) / delta;
    const far = (max - from[axis]) / delta;
    enter = Math.max(enter, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
    if (enter >= exit) return false;
  }
  return true;
}

export function clearPorts(
  from: CardBounds,
  to: CardBounds,
  preferred: Ports,
  cards: Iterable<CardBounds>,
  opposingPorts?: Ports,
): Ports {
  const obstacles = [...cards].map((card) => ({
    ...card,
    halfWidth: card.halfWidth + (card === from || card === to ? -1 : 8),
    halfHeight: card.halfHeight + (card === from || card === to ? -1 : 8),
  }));
  const countHits = (curve: ReturnType<typeof connectionCurve>) => {
    const { left, right, top, bottom } = curve.bounds;
    const nearby = obstacles.filter(
      (card) =>
        card.x + card.halfWidth > left &&
        card.x - card.halfWidth < right &&
        card.y + card.halfHeight > top &&
        card.y - card.halfHeight < bottom,
    );
    if (!nearby.length) return 0;
    const samples = Array.from({ length: 25 }, (_, i) => curve.point(i / 24));
    return nearby.filter((card) =>
      samples.some(
        (point, index) =>
          index > 0 && segmentHitsCard(samples[index - 1], point, card),
      ),
    ).length;
  };

  const initial = connectionCurve(
    anchor(from, preferred[0]),
    anchor(to, preferred[1]),
    preferred,
  );
  const preferredIsReserved =
    preferred[0] === opposingPorts?.[0] && preferred[1] === opposingPorts[1];
  let bestHits = preferredIsReserved ? Infinity : countHits(initial);
  if (!bestHits) return preferred;

  let best = preferred;
  let bestLength = initial.length;
  for (const start of sides) {
    for (const end of sides) {
      if (start === opposingPorts?.[0] && end === opposingPorts[1]) continue;
      const ports: Ports = [start, end];
      const curve = connectionCurve(
        anchor(from, start),
        anchor(to, end),
        ports,
      );
      const hits = countHits(curve);
      if (hits < bestHits || (hits === bestHits && curve.length < bestLength)) {
        best = ports;
        bestHits = hits;
        bestLength = curve.length;
      }
    }
  }
  return best;
}
