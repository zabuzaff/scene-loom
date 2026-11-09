import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position } from '@xyflow/react';
import { clearPorts } from '../client/routing.js';

test('a return wire leaves the outside of a branch when the preferred path crosses another card', () => {
  const root = { x: 150, y: 140, halfWidth: 150, halfHeight: 140 };
  const upper = { x: 550, y: 80, halfWidth: 150, halfHeight: 80 };
  const lower = { x: 550, y: 350, halfWidth: 150, halfHeight: 80 };
  assert.deepEqual(
    clearPorts(
      lower,
      root,
      [Position.Top, Position.Top],
      [root, upper, lower],
      [Position.Left, Position.Right],
    ),
    [Position.Left, Position.Bottom],
  );
});

test('an alternate return path avoids cutting back through its source card', () => {
  const card = (x: number, y: number) => ({
    x,
    y,
    halfWidth: 150,
    halfHeight: 80,
  });
  const from = card(150, 300);
  const to = card(1205, 815);
  assert.deepEqual(
    clearPorts(
      from,
      to,
      [Position.Top, Position.Top],
      [from, to, card(755, 494), card(842, 50)],
      [Position.Right, Position.Left],
    ),
    [Position.Bottom, Position.Left],
  );
});

test('a return wire cannot reuse the ports of an already routed forward wire', () => {
  const from = { x: 550, y: 80, halfWidth: 150, halfHeight: 80 };
  const to = { ...from, x: 150 };
  const reserved: [Position, Position] = [Position.Top, Position.Top];
  assert.notDeepEqual(
    clearPorts(from, to, reserved, [from, to], reserved),
    reserved,
  );
});

test('a long wire detects a card entirely between its sample points', () => {
  const from = { x: 150, y: 80, halfWidth: 150, halfHeight: 80 };
  const to = { ...from, x: 20150 };
  const between = { ...from, x: 945 };
  const straight: [Position, Position] = [Position.Right, Position.Left];
  assert.notDeepEqual(
    clearPorts(from, to, straight, [from, to, between]),
    straight,
  );
});
