import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  Check,
  ArrowUpRight,
  X,
  FolderOpen,
  CircleHelp,
} from 'lucide-react';
const Canvas = lazy(() =>
  import('./Canvas').then((module) => ({ default: module.Canvas })),
);
import {
  api,
  starterPrompt,
  visionPrompt,
  firstScenePrompt,
  type AgentInfo,
} from './api';
import { VisionPanel } from './VisionPanel';
import type {
  ProjectData,
  ViewportData,
  ProjectSummary,
} from '../shared/schema';
export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [project, setProject] = useState<ProjectData | null>(null),
    [viewport, setViewport] = useState<ViewportData | null>(null),
    [info, setInfo] = useState<AgentInfo | null>(null),
    [active, setActive] = useState<string | null>(
      localStorage.getItem('scene-loom-project'),
    ),
    [picker, setPicker] = useState(false),
    [savingSettings, setSavingSettings] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(false),
    [loading, setLoading] = useState(true),
    [recent, setRecent] = useState<string[]>([]),
    [help, setHelp] = useState(false),
    [visionOpen, setVisionOpen] = useState(false);
  const closeVision = useCallback(() => setVisionOpen(false), []);
  useEffect(() => {
    document.title = project
      ? `${project.title} — Scene Loom`
      : 'Scene Loom — Storyboard studio';
  }, [project?.title]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const requestVersion = useRef(0),
    viewportLoaded = useRef<string | null>(null),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const list = await api<ProjectSummary[]>('projects');
    const available = list.filter((p) => p.status === 'ready');
    if (version !== requestVersion.current) return;
    setProjects(list);
    const id =
      activeRef.current && available.some((p) => p.id === activeRef.current)
        ? activeRef.current
        : (available[0]?.id ?? null);
    if (id !== activeRef.current) {
      activeRef.current = id;
      setActive(id);
    }
    if (id) {
      const [p, v] = await Promise.all([
        api<ProjectData>(`projects/${id}`),
        viewportLoaded.current !== id
          ? api<ViewportData | null>(`projects/${id}/viewport`)
          : Promise.resolve(undefined),
      ]);
      if (version !== requestVersion.current || activeRef.current !== id)
        return;
      if (v !== undefined) {
        setViewport(v);
        viewportLoaded.current = id;
      }
      setProject(p);
      localStorage.setItem('scene-loom-project', id);
    } else {
      setProject(null);
      setViewport(null);
      viewportLoaded.current = null;
      localStorage.removeItem('scene-loom-project');
    }
    setLoading(false);
    setError('');
  }, []);
  useEffect(() => {
    let disposed = false,
      events: EventSource | undefined,
      retry: ReturnType<typeof setTimeout> | undefined;
    async function connect() {
      try {
        await api('session');
        const agent = await api<AgentInfo>('agent-info');
        if (disposed) return;
        setInfo(agent);
        await refresh();
        if (disposed) return;
        events = new EventSource('/api/events');
        events.addEventListener('ready', () => {
          setConnected(true);
          void refresh().catch((e) => setError(e.message));
        });
        events.addEventListener('change', (event) => {
          const change = JSON.parse((event as MessageEvent).data);
          if (
            change.projectId === activeRef.current &&
            change.kind === 'content'
          )
            setRecent(change.affectedIds ?? []);
          void refresh().catch((e) => setError(e.message));
        });
        events.onerror = () => {
          setConnected(false);
          events?.close();
          retry = setTimeout(() => void connect(), 2000);
        };
      } catch (e) {
        if (disposed) return;
        setConnected(false);
        setLoading(false);
        setError((e as Error).message);
        retry = setTimeout(() => void connect(), 3000);
      }
    }
    void connect();
    return () => {
      disposed = true;
      events?.close();
      clearTimeout(retry);
      clearTimeout(noticeTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (!info) return;
    setRecent([]);
    void refresh().catch((e) => {
      setLoading(false);
      setError(e.message);
    });
  }, [active, info, refresh]);
  async function toggleMeshFoundry() {
    if (!project || project.id !== activeRef.current || savingSettings) return;
    setSavingSettings(true);
    try {
      await api(`projects/${project.id}/settings`, 'PUT', {
        meshFoundryEnabled: !project.meshFoundryEnabled,
      });
      await refresh();
    } catch (error) {
      notify(`Could not update project settings. ${(error as Error).message}`);
    } finally {
      setSavingSettings(false);
    }
  }
  async function copyStart(existing = false, refine = false) {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(
        refine && project
          ? visionPrompt(info, project)
          : existing && project?.vision
            ? firstScenePrompt(info, project)
            : starterPrompt(info, existing ? project?.id : undefined),
      );
      notify('Prompt copied. Paste it into your agent.');
    } catch {
      notify('Clipboard unavailable. Allow clipboard access and try again.');
    }
  }
  return (
    <main className="studio">
      <header className="studio-header">
        <a className="wordmark" href="/" aria-label="Scene Loom home">
          <img
            className="brand-mark"
            src="/scene-loom-mark.svg"
            width="26"
            height="26"
            alt=""
            aria-hidden="true"
          />
          <span>
            scene loom<span className="wordmark-period">.</span>
          </span>
        </a>
        <div className="header-divider" />
        <div className="project-picker">
          <button
            className="project-trigger"
            aria-expanded={picker}
            onClick={() => setPicker((v) => !v)}
          >
            <span>{project?.title ?? 'Your projects'}</span>
            <ChevronDown size={15} />
          </button>
          {picker && (
            <div className="project-menu">
              {project && project.id === active && (
                <button
                  className="project-setting"
                  role="switch"
                  aria-checked={project.meshFoundryEnabled ?? false}
                  disabled={savingSettings}
                  onClick={() => void toggleMeshFoundry()}
                >
                  <span>Mesh Foundry handoff</span>
                  <small aria-hidden="true">
                    {project.meshFoundryEnabled ? 'On' : 'Off'}
                  </small>
                </button>
              )}
              <div className="project-menu-list">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    disabled={p.status === 'unreadable'}
                    title={
                      p.status === 'unreadable' ? p.error.suggestion : undefined
                    }
                    onClick={() => {
                      activeRef.current = p.id;
                      setActive(p.id);
                      setPicker(false);
                    }}
                  >
                    <span>
                      {p.title}
                      <small>
                        {p.status === 'ready'
                          ? `${p.sceneCount} scenes`
                          : 'Needs recovery'}
                      </small>
                    </span>
                    {active === p.id && <Check size={15} />}
                  </button>
                ))}
                {!projects.length && <p>No projects yet.</p>}
              </div>
              <button
                disabled={!info}
                onClick={() => {
                  void copyStart();
                  setPicker(false);
                }}
              >
                Copy new project starter prompt <ArrowUpRight size={15} />
              </button>
              <div className="project-menu-note">
                Projects are created through your agent.
              </div>
            </div>
          )}
        </div>
        {project && (
          <button
            className="vision-toggle"
            aria-expanded={visionOpen}
            onClick={() => {
              setVisionOpen((v) => !v);
              setHelp(false);
            }}
          >
            Project Vision
          </button>
        )}
        <span className="header-canvas-label">Canvas</span>
        <div className="header-right">
          <span className={`connection-status ${connected ? 'online' : ''}`}>
            <i />
            {connected ? 'Local studio' : 'Reconnecting'}
          </span>
          <button
            className="icon-button help-toggle"
            aria-label="How to use Scene Loom"
            onClick={() => {
              setHelp((v) => !v);
              setVisionOpen(false);
            }}
          >
            <CircleHelp size={19} />
          </button>
        </div>
      </header>
      {projects.some((p) => p.status === 'unreadable') && (
        <div className="error-banner" role="status">
          {projects
            .filter((p) => p.status === 'unreadable')
            .map((p) => p.title)
            .join(', ')}
          : needs recovery.{' '}
          {projects.some((p) => p.status === 'ready')
            ? 'Other projects remain available.'
            : 'Use your agent to recover your projects or start a new one.'}
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            onClick={() => void refresh().catch((e) => setError(e.message))}
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <div className="empty-state">
          <span className="loading-mark" />
          <p>Opening the worktable…</p>
        </div>
      ) : project?.scenes.length && info ? (
        <Suspense
          fallback={
            <div className="empty-state">
              <p>Opening the canvas…</p>
            </div>
          }
        >
          <Canvas
            key={project.id}
            project={project}
            initialViewport={viewport}
            info={info}
            recent={recent}
            notify={notify}
            refresh={refresh}
          />
        </Suspense>
      ) : (
        <section className="empty-state">
          <div className="empty-composition">
            <div />
            <img
              className="brand-mark"
              src="/scene-loom-mark.svg"
              width="52"
              height="52"
              alt=""
              aria-hidden="true"
            />
            <div />
          </div>
          <h1>
            {project
              ? project.vision
                ? 'Your vision is ready. Make it visible.'
                : 'Give this project its first scene.'
              : 'Every idea starts\nwith a scene.'}
          </h1>
          <p>
            Bring an idea to your agent. Your agent builds the storyboard.
            <br />
            Come here to see how it all connects.
          </p>
          <button
            className="primary-button"
            disabled={!info}
            onClick={() => void copyStart(!!project)}
          >
            {project?.vision
              ? 'Copy first scene prompt'
              : 'Copy a starting prompt'}{' '}
            <ArrowUpRight size={17} />
          </button>
          <span className="empty-footnote">
            One project. One canvas. Room for every possibility.
          </span>
        </section>
      )}
      {visionOpen && project && (
        <VisionPanel
          key={project.id}
          project={project}
          close={closeVision}
          copy={() => void copyStart(true, !!project.vision)}
        />
      )}
      <AnimatePresence>
        {notice && (
          <motion.div
            className="toast"
            role="status"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
          >
            <Check size={16} />
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice('')}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {help && (
          <motion.aside
            className="help-panel"
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 30, opacity: 0 }}
          >
            <div className="help-heading">
              <h2>Your creative loop</h2>
              <button
                className="icon-button"
                aria-label="Close help"
                onClick={() => setHelp(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Develop your project with your agent.
              <br />
              See it take shape here.
            </p>
            <ol>
              <li>
                <strong>Prompt your agent</strong>
                <span>
                  Describe a screen, workflow, or gameplay moment. The agent
                  supplies images, details, and connections.
                </span>
              </li>
              <li>
                <strong>Explore the flow</strong>
                <span>
                  Drag to arrange, scroll to zoom, and open cards for the full
                  scene.
                </span>
              </li>
              <li>
                <strong>Keep the story moving</strong>
                <span>
                  Copy Continue or Edit from a card, paste into your agent, and
                  optionally add your direction.
                </span>
              </li>
            </ol>
            <button className="primary-button" onClick={() => void copyStart()}>
              Copy a starting prompt <ArrowUpRight size={16} />
            </button>
            <div className="help-local">
              <FolderOpen size={15} />
              <span>Images and canvas data stay on this computer.</span>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </main>
  );
}
