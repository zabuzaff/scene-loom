import {
  assetNextAction,
  rehearsalState,
  sceneNextAction,
} from '../shared/rehearsal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  BaseEdge,
  MarkerType,
  Position,
  useReactFlow,
  applyNodeChanges,
  type EdgeProps,
  type NodeChange,
  type Edge,
} from '@xyflow/react';
import {
  Search,
  X,
  Plus,
  Minus,
  Maximize,
  LayoutGrid,
  LocateFixed,
  ArrowUpRight,
} from 'lucide-react';
import type { PointData, ProjectData, ViewportData } from '../shared/schema';
import {
  api,
  RequestError,
  scenePrompt,
  assetGenerationPrompt,
  rehearsalPrepPrompt,
  rehearsalReviewPrompt,
  rehearsalHandoffPrompt,
  rehearsalAssetPrompt,
  type AssetPromptAction,
  type AgentInfo,
} from './api';
import { SceneCard, type SceneNode } from './SceneCard';
import { arrangeScenes } from './arrange';
import { clearPorts, connectionCurve } from './routing';
const nodeTypes = { scene: SceneCard };
function StoryEdge(props: EdgeProps) {
  let path: string, x: number, y: number;
  if (props.source === props.target) {
    const { sourceX, sourceY, targetX, targetY } = props;
    const right = targetX + 48;
    const top = sourceY - 48;
    path = `M ${sourceX} ${sourceY} C ${sourceX} ${top}, ${targetX} ${top}, ${right} ${top} C ${right + 34} ${top}, ${right + 34} ${targetY}, ${targetX} ${targetY}`;
    x = (sourceX + targetX) / 2;
    y = top + 7;
  } else {
    const curve = connectionCurve(
      { x: props.sourceX, y: props.sourceY },
      { x: props.targetX, y: props.targetY },
      [props.sourcePosition, props.targetPosition],
    );
    path = curve.path;
    ({ x, y } = curve.point(0.5));
  }
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
      />
      {props.label && (
        <foreignObject x={x - 42} y={y - 10} width={84} height={20}>
          <div className="story-edge-label" title={String(props.label)}>
            {props.label}
          </div>
        </foreignObject>
      )}
    </>
  );
}
const edgeTypes = { story: StoryEdge };
export function Canvas(props: {
  project: ProjectData;
  initialViewport: ViewportData | null;
  info: AgentInfo;
  recent: string[];
  notify: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
function CanvasInner({
  project,
  initialViewport,
  info,
  recent,
  notify,
  refresh,
}: Parameters<typeof Canvas>[0]) {
  const [nodes, setNodes] = useState<SceneNode[]>([]),
    [expanded, setExpanded] = useState<string | null>(null),
    [focusRequest, setFocusRequest] = useState(0),
    [search, setSearch] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [zoom, setZoom] = useState(initialViewport?.zoom ?? 1),
    [saving, setSaving] = useState(false),
    [arranging, setArranging] = useState(false),
    [saveError, setSaveError] = useState(false);
  const flow = useReactFlow<SceneNode>();
  const latest = useRef(project);
  latest.current = project;
  const dirty = useRef<Record<string, PointData>>({}),
    dragging = useRef(new Set<string>()),
    sending = useRef(false),
    mounted = useRef(true);
  const fitAfterArrange = useRef(false);
  const pendingArrange = useRef<{
    expectedContentRevision: number;
    expectedLayoutRevision: number;
    positions: Map<string, PointData>;
  } | null>(null);
  const arrangement = useRef<{
    frame: number;
    routingNodes: SceneNode[];
    movingIds: ReadonlySet<string>;
  } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (arrangement.current) cancelAnimationFrame(arrangement.current.frame);
      arrangement.current = null;
    };
  }, []);
  const toggle = useCallback(
    (id: string) => setExpanded((old) => (old === id ? null : id)),
    [],
  );
  const copy = useCallback(
    async (
      id: string,
      action:
        | 'continue'
        | 'edit'
        | 'assets'
        | 'rehearsal'
        | 'rehearsal-review'
        | 'rehearsal-handoff'
        | AssetPromptAction,
      requirementId?: string,
    ) => {
      const p = latest.current,
        s = p.scenes.find((s) => s.id === id);
      if (!s) return;
      const state = rehearsalState(s.rehearsalEvents);
      const next = sceneNextAction(
        !!s.rehearsalBrief,
        p.rehearsalInputRevision ?? p.contentRevision,
        state,
      );
      const asset = state.assets.find(
        ({ requirement }) => requirement.id === requirementId,
      );
      if (action.startsWith('rehearsal') || requirementId) {
        if (!p.meshFoundryEnabled) return;
        if (requirementId) {
          if (
            next ||
            !state.head ||
            !asset ||
            (action !== 'adopt-candidate' && assetNextAction(asset) !== action)
          )
            return;
        } else if (
          next !== action &&
          !(action === 'rehearsal-handoff' && !next)
        )
          return;
      }
      if (
        action === 'assets' &&
        (!p.meshFoundryEnabled ||
          !p.assetSuggestions?.some(
            (suggestion) =>
              !suggestion.retired && suggestion.sceneIds.includes(id),
          ))
      )
        return;
      try {
        await navigator.clipboard.writeText(
          action === 'assets'
            ? assetGenerationPrompt(info, p, s)
            : action === 'rehearsal'
              ? rehearsalPrepPrompt(info, p, s)
              : action === 'rehearsal-review'
                ? rehearsalReviewPrompt(info, p, s)
                : action === 'rehearsal-handoff'
                  ? rehearsalHandoffPrompt(info, p, s)
                  : action === 'continue' || action === 'edit'
                    ? scenePrompt(info, p, s, action)
                    : rehearsalAssetPrompt(
                        info,
                        p,
                        s,
                        asset!,
                        state.head!,
                        action,
                      ),
        );
        const labels = {
          'rehearsal-handoff': 'Rehearsal handoff',
          'rehearsal-review': 'Rehearsal review',
          rehearsal: 'Rehearsal prep',
          assets: 'Asset-generation',
          continue: 'Continue',
          edit: 'Edit',
          foundry: 'Foundry revision request',
          fit: 'Rehearsal fit-check',
          'candidate-review': 'Foundry candidate review',
          'adopt-candidate': 'Existing Foundry candidate',
          'rehearsal-correction': 'Rehearsal correction',
        };
        notify(`${labels[action]} prompt copied. Paste it into your agent.`);
      } catch {
        notify('Clipboard unavailable. Allow clipboard access and try again.');
      }
    },
    [info, notify],
  );
  useEffect(
    () =>
      setNodes((old) =>
        project.scenes.map((scene, index) => {
          const existing = old.find((n) => n.id === scene.id);
          return {
            ...existing,
            id: scene.id,
            type: 'scene',
            position: (arrangement.current?.movingIds.has(scene.id)
              ? existing?.position
              : undefined) ??
              dirty.current[scene.id] ??
              (dragging.current.has(scene.id)
                ? existing?.position
                : undefined) ??
              project.positions[scene.id] ?? { x: 0, y: 0 },
            zIndex: expanded === scene.id ? 10 : 0,
            data: {
              scene,
              projectId: project.id,
              number: index + 1,
              expanded: expanded === scene.id,
              recent: recent.includes(scene.id),
              toggle,
              copy,
              rehearsalEnabled: !!project.meshFoundryEnabled,
              rehearsalInputRevision:
                project.rehearsalInputRevision ?? project.contentRevision,
              assetSuggestions: project.meshFoundryEnabled
                ? project.assetSuggestions?.filter(
                    (suggestion) =>
                      !suggestion.retired &&
                      suggestion.sceneIds.includes(scene.id),
                  )
                : undefined,
            },
          };
        }),
      ),
    [project, expanded, recent, toggle, copy],
  );
  const routingNodes = arrangement.current?.routingNodes ?? nodes;
  const edges = useMemo<Edge[]>(() => {
    const byId = new Map(
      routingNodes.map((node) => {
        const halfWidth = (node.measured?.width ?? 300) / 2;
        const halfHeight = (node.measured?.height ?? 200) / 2;
        return [
          node.id,
          {
            x: node.position.x + halfWidth,
            y: node.position.y + halfHeight,
            halfWidth,
            halfHeight,
          },
        ] as const;
      }),
    );
    const pairs = new Set(
      project.connections.map((c) => `${c.sourceSceneId}:${c.targetSceneId}`),
    );
    const routed = new Map<string, [Position, Position]>();
    function route(source: string, target: string): [Position, Position] {
      if (source === target) return [Position.Top, Position.Right];
      const key = `${source}:${target}`;
      const saved = routed.get(key);
      if (saved) return saved;
      const fallback = { x: 0, y: 0, halfWidth: 150, halfHeight: 100 };
      const from = byId.get(source) ?? fallback;
      const to = byId.get(target) ?? fallback;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const horizontalGap = Math.abs(dx) >= from.halfWidth + to.halfWidth;
      const verticalGap = Math.abs(dy) >= from.halfHeight + to.halfHeight;
      const vertical =
        horizontalGap === verticalGap
          ? Math.abs(dy) > Math.abs(dx)
          : verticalGap;
      let sourceHandle = vertical
        ? dy > 0
          ? Position.Bottom
          : Position.Top
        : dx >= 0
          ? Position.Right
          : Position.Left;
      let targetHandle = vertical
        ? dy > 0
          ? Position.Top
          : Position.Bottom
        : dx >= 0
          ? Position.Left
          : Position.Right;
      const returnArrow = source > target && pairs.has(`${target}:${source}`);
      let opposingPorts: [Position, Position] | undefined;
      if (returnArrow) {
        const [forwardSource, forwardTarget] = route(target, source);
        opposingPorts = [forwardTarget, forwardSource];
        // Put a return arrow on the outside of its source row or column.
        // A lower branch returns below the flow rather than through the row above.
        const sourceLeft = from.x - from.halfWidth;
        const targetLeft = to.x - to.halfWidth;
        const sourceTop = from.y - from.halfHeight;
        const targetTop = to.y - to.halfHeight;
        sourceHandle = targetHandle = vertical
          ? sourceLeft > targetLeft
            ? Position.Right
            : Position.Left
          : sourceTop > targetTop
            ? Position.Bottom
            : Position.Top;
      }
      const ports = clearPorts(
        from,
        to,
        [sourceHandle, targetHandle],
        byId.values(),
        opposingPorts,
      );
      routed.set(key, ports);
      return ports;
    }
    return project.connections.map((c) => {
      const [sourceHandle, targetHandle] = route(
        c.sourceSceneId,
        c.targetSceneId,
      );
      return {
        id: c.id,
        source: c.sourceSceneId,
        target: c.targetSceneId,
        sourceHandle,
        targetHandle,
        label: c.label,
        type: 'story',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 17,
          height: 17,
          color: '#929baa',
        },
        style: { stroke: 'var(--edge)', strokeWidth: 1.5 },
      };
    });
  }, [routingNodes, project.connections]);
  const persist = useCallback(async () => {
    if (sending.current || !Object.keys(dirty.current).length) return;
    sending.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      do {
        while (Object.keys(dirty.current).length) {
          const positions = { ...dirty.current };
          const pending = pendingArrange.current;
          const arranged =
            pending &&
            Object.entries(positions).some(
              ([id, point]) => pending.positions.get(id) === point,
            )
              ? pending
              : null;
          if (pending && !arranged) pendingArrange.current = null;
          // Read a fresh layout revision; patch only moved cards, never the complete graph.
          const fresh = await api<ProjectData>(`projects/${project.id}`);
          const surviving = Object.fromEntries(
            Object.entries(positions).filter(([id]) =>
              fresh.scenes.some((s) => s.id === id),
            ),
          );
          if (Object.keys(surviving).length) {
            try {
              await api(`projects/${project.id}/layout`, 'PATCH', {
                expectedLayoutRevision:
                  arranged?.expectedLayoutRevision ?? fresh.layoutRevision,
                expectedContentRevision: arranged?.expectedContentRevision,
                positions: surviving,
              });
              if (arranged) {
                pendingArrange.current = null;
                fitAfterArrange.current = true;
              }
            } catch (e) {
              if (
                arranged &&
                e instanceof RequestError &&
                (e.detail.code === 'LAYOUT_CONFLICT' ||
                  e.detail.code === 'CONTENT_CONFLICT')
              ) {
                const discarded = new Set<string>();
                for (const [id, point] of arranged.positions) {
                  if (dirty.current[id] !== point) continue;
                  delete dirty.current[id];
                  discarded.add(id);
                }
                setNodes((old) =>
                  old.map((node) => {
                    const saved = fresh.positions[node.id];
                    return discarded.has(node.id) &&
                      saved &&
                      !dirty.current[node.id]
                      ? { ...node, position: saved }
                      : node;
                  }),
                );
                pendingArrange.current = null;
                notify(
                  'The board changed while arranging. Click Arrange scenes to try again.',
                );
                continue;
              }
              if (
                e instanceof RequestError &&
                e.detail.code === 'LAYOUT_CONFLICT'
              )
                continue;
              throw e;
            }
          }
          for (const [id, point] of Object.entries(positions))
            if (dirty.current[id] === point) delete dirty.current[id];
        }
        await refresh();
        // A move can arrive while the refresh is in flight and the save lock is held.
        // Drain it before releasing that lock so it cannot remain silently unsaved.
      } while (Object.keys(dirty.current).length);
    } catch (e) {
      if (mounted.current) {
        const hasUnsavedPositions = Object.keys(dirty.current).length > 0;
        setSaveError(hasUnsavedPositions);
        notify(
          hasUnsavedPositions
            ? `Position not saved: ${(e as Error).message} Use Retry save.`
            : `Could not refresh the board: ${(e as Error).message}`,
        );
      }
    } finally {
      sending.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [project.id, notify, refresh]);
  const onChanges = useCallback(
    (changes: NodeChange<SceneNode>[]) => {
      if (arrangement.current) {
        const structuralChanges = changes.filter(
          (change) => change.type !== 'position',
        );
        if (structuralChanges.length)
          setNodes((old) => applyNodeChanges(structuralChanges, old));
        return;
      }
      let completedMove = false;
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue;
        dirty.current[change.id] = change.position;
        if (change.dragging !== true && !dragging.current.has(change.id))
          completedMove = true;
      }
      setNodes((old) => applyNodeChanges(changes, old));
      // Keyboard moves have no pointer drag-stop callback. Save them through
      // the same serialized path, including key repeats while a save is in flight.
      if (completedMove) void persist();
    },
    [persist],
  );
  useEffect(() => {
    if (!fitAfterArrange.current) return;
    fitAfterArrange.current = false;
    void flow.fitView({ padding: 0.18, duration: 450, maxZoom: 1 });
  }, [nodes, flow]);
  function arrange() {
    if (
      nodes.length < 2 ||
      dragging.current.size ||
      arrangement.current ||
      sending.current ||
      Object.keys(dirty.current).length
    )
      return;
    const positions = arrangeScenes(nodes, project.connections);
    // The layout API accepts positions within ±100,000 canvas units.
    if ([...positions.values()].some(({ x, y }) => x > 100000 || y > 100000)) {
      notify('This board is too large to arrange automatically.');
      return;
    }
    const moves = new Map<string, { from: PointData; to: PointData }>();
    for (const { id, position: from } of nodes) {
      const to = positions.get(id)!;
      if (to.x !== from.x || to.y !== from.y) moves.set(id, { from, to });
    }
    if (!moves.size) return;

    const duration = 600;
    const started = performance.now();
    const animation = {
      frame: 0,
      routingNodes: nodes,
      movingIds: new Set(moves.keys()),
    };
    arrangement.current = animation;
    setArranging(true);
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      if (progress < 1) {
        const eased = 1 - (1 - progress) ** 3;
        setNodes((old) =>
          old.map((node) => {
            const move = moves.get(node.id);
            if (!move) return node;
            const { from, to } = move;
            return {
              ...node,
              position: {
                x: from.x + (to.x - from.x) * eased,
                y: from.y + (to.y - from.y) * eased,
              },
            };
          }),
        );
        animation.frame = requestAnimationFrame(step);
        return;
      }
      arrangement.current = null;
      setArranging(false);
      const changes: NodeChange<SceneNode>[] = [];
      for (const { id } of latest.current.scenes) {
        const move = moves.get(id);
        if (move) changes.push({ type: 'position', id, position: move.to });
      }
      if (!changes.length) return;
      pendingArrange.current = {
        expectedContentRevision: project.contentRevision,
        expectedLayoutRevision: project.layoutRevision,
        positions: new Map([...moves].map(([id, move]) => [id, move.to])),
      };
      onChanges(changes);
    };
    animation.frame = requestAnimationFrame(step);
  }
  const focus = useCallback(
    (ids: string[]) => {
      const existing = flow.getNodes().filter((n) => ids.includes(n.id));
      if (existing.length)
        void flow.fitView({
          nodes: existing,
          padding: 0.35,
          duration: 450,
          maxZoom: 1,
        });
    },
    [flow],
  );
  useEffect(() => {
    if (!expanded) return;
    const timer = setTimeout(() => focus([expanded]), 340);
    return () => clearTimeout(timer);
  }, [expanded, focus, focusRequest]);
  const results = project.scenes.filter((s) =>
    s.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="canvas-shell">
      <ReactFlow<SceneNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onChanges}
        onNodeDragStart={(_, n) => dragging.current.add(n.id)}
        onNodeDragStop={(_, n) => {
          dirty.current[n.id] = n.position;
          dragging.current.delete(n.id);
          void persist();
        }}
        onNodeClick={(_, n) => toggle(n.id)}
        onPaneClick={() => setExpanded(null)}
        nodesDraggable={!arranging}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        minZoom={0.1}
        maxZoom={2}
        fitView={!initialViewport}
        fitViewOptions={{ padding: 0.18, maxZoom: 0.85 }}
        defaultViewport={initialViewport ?? undefined}
        onMoveEnd={(_, v) => {
          setZoom(v.zoom);
          void api(`projects/${project.id}/viewport`, 'PUT', v).catch((e) =>
            notify(`View not saved: ${(e as Error).message}`),
          );
        }}
        proOptions={{ hideAttribution: false }}
        colorMode="dark"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="#303640"
        />
      </ReactFlow>
      <div className="canvas-caption">
        <span className="canvas-caption-title">Story canvas</span>
        <span>
          {project.scenes.length} scenes <span className="small-dot" />{' '}
          {project.connections.length} connections
        </span>
      </div>
      <div className="canvas-tools">
        <button
          className="tool-button"
          aria-label="Find a scene"
          onClick={() => setSearchOpen((v) => !v)}
        >
          <Search size={17} />
          <span>Find a scene</span>
        </button>
        {recent.length > 0 && (
          <button
            className="tool-button recent-focus"
            onClick={() => focus(recent)}
          >
            <LocateFixed size={16} /> Show updates
          </button>
        )}
      </div>
      {searchOpen && (
        <div className="scene-search">
          <div className="search-input">
            <Search size={16} />
            <input
              autoFocus
              placeholder="Search scene titles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchOpen(false);
              }}
            />
            <button
              className="icon-button"
              aria-label="Close scene search"
              onClick={() => setSearchOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="search-results">
            {results.length ? (
              results.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setExpanded(s.id);
                    setNodes((old) =>
                      old.map((node) => ({
                        ...node,
                        selected: node.id === s.id,
                      })),
                    );
                    // Reuse the card-opening transition, even if this scene is already open.
                    setFocusRequest((request) => request + 1);
                    setSearchOpen(false);
                  }}
                >
                  {s.title}
                  <ArrowUpRight size={14} />
                </button>
              ))
            ) : (
              <p>No scenes match that title.</p>
            )}
          </div>
        </div>
      )}
      <div className="canvas-bottom">
        <span className="canvas-hint">
          Drag to arrange <span /> Scroll to zoom
        </span>
        <div className="zoom-tools">
          <button
            className="icon-button"
            aria-label="Zoom out"
            onClick={() => void flow.zoomOut({ duration: 200 })}
          >
            <Minus size={17} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            aria-label="Zoom in"
            onClick={() => void flow.zoomIn({ duration: 200 })}
          >
            <Plus size={17} />
          </button>
          <i />
          <button
            className="icon-button"
            aria-label="Arrange scenes"
            title="Arrange scenes by their connections"
            disabled={nodes.length < 2 || arranging || saving || saveError}
            onClick={arrange}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Fit all scenes"
            onClick={() =>
              void flow.fitView({ padding: 0.18, duration: 450, maxZoom: 1 })
            }
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
      {(saving || saveError) && (
        <div className="layout-status">
          {saveError ? (
            <button onClick={() => void persist()}>Retry save</button>
          ) : (
            'Saving arrangement…'
          )}
        </div>
      )}
    </div>
  );
}
