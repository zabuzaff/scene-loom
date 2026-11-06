import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  BaseEdge,
  getBezierPath,
  MarkerType,
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
  LocateFixed,
  ArrowUpRight,
} from 'lucide-react';
import type { PointData, ProjectData, ViewportData } from '../shared/schema';
import { api, RequestError, scenePrompt, type AgentInfo } from './api';
import { SceneCard, type SceneNode } from './SceneCard';
const nodeTypes = { scene: SceneCard };
function StoryEdge(props: EdgeProps) {
  let path: string, x: number, y: number;
  if (props.source === props.target) {
    const top = Math.min(props.sourceY, props.targetY) - 240;
    path = `M ${props.sourceX} ${props.sourceY} C ${props.sourceX + 180} ${top}, ${props.targetX - 180} ${top}, ${props.targetX} ${props.targetY}`;
    x = (props.sourceX + props.targetX) / 2;
    y = top + 62;
  } else if (props.targetX < props.sourceX) {
    const lower = Math.max(props.sourceY, props.targetY) + 240;
    path = `M ${props.sourceX} ${props.sourceY} C ${props.sourceX + 190} ${lower}, ${props.targetX - 190} ${lower}, ${props.targetX} ${props.targetY}`;
    x = (props.sourceX + props.targetX) / 2;
    y = lower - 30;
  } else [path, x, y] = getBezierPath({ ...props, curvature: 0.4 });
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      style={props.style}
      label={props.label}
      labelX={x}
      labelY={y}
      labelStyle={{
        fill: 'var(--soft)',
        fontSize: 11,
        fontFamily: 'DM Sans Variable',
      }}
      labelShowBg
      labelBgStyle={{ fill: 'var(--ground)', fillOpacity: 0.98 }}
      labelBgPadding={[9, 5]}
      labelBgBorderRadius={4}
    />
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
    [saveError, setSaveError] = useState(false);
  const flow = useReactFlow<SceneNode>();
  const latest = useRef(project);
  latest.current = project;
  const dirty = useRef<Record<string, PointData>>({}),
    dragging = useRef(new Set<string>()),
    sending = useRef(false),
    mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const toggle = useCallback(
    (id: string) => setExpanded((old) => (old === id ? null : id)),
    [],
  );
  const copy = useCallback(
    async (id: string, action: 'continue' | 'edit') => {
      const p = latest.current,
        s = p.scenes.find((s) => s.id === id);
      if (!s) return;
      try {
        await navigator.clipboard.writeText(scenePrompt(info, p, s, action));
        notify(
          `${action === 'continue' ? 'Continue' : 'Edit'} prompt copied. Paste it into your agent.`,
        );
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
            position: dirty.current[scene.id] ??
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
            },
          };
        }),
      ),
    [project, expanded, recent, toggle, copy],
  );
  const edges = useMemo<Edge[]>(
    () =>
      project.connections.map((c) => ({
        id: c.id,
        source: c.sourceSceneId,
        target: c.targetSceneId,
        label: c.label,
        type: 'story',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 17,
          height: 17,
          color: '#929baa',
        },
        style: { stroke: 'var(--edge)', strokeWidth: 1.5 },
      })),
    [project.connections],
  );
  const persist = useCallback(async () => {
    if (sending.current || !Object.keys(dirty.current).length) return;
    sending.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      do {
        while (Object.keys(dirty.current).length) {
          const positions = { ...dirty.current };
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
                expectedLayoutRevision: fresh.layoutRevision,
                positions: surviving,
              });
            } catch (e) {
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
        setSaveError(true);
        notify(`Position not saved: ${(e as Error).message} Use Retry save.`);
      }
    } finally {
      sending.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [project.id, notify, refresh]);
  const onChanges = useCallback(
    (changes: NodeChange<SceneNode>[]) => {
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
