import {
  Fragment,
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, PencilLine, ChevronDown, Shapes, X } from 'lucide-react';
import type { ProjectData, SceneData } from '../shared/schema';
import { api, orchestrationActions, RequestError } from './api';
import {
  orchestrationState,
  type OrchestrationAction,
} from '../shared/orchestration';
import type { sceneDevelopment } from '../shared/development';
import {
  DevelopmentAction,
  DevelopmentDetails,
  ExternalRevision,
  GameResume,
} from './SceneProgress';

export type CardData = {
  scene: SceneData;
  projectId: string;
  contentRevision: number;
  number: number;
  expanded: boolean;
  recent: boolean;
  rehearsalEnabled: boolean;
  production: boolean;
  development: ReturnType<typeof sceneDevelopment>;
  sceneTitles: Record<string, string>;
  openScene: (id: string, sliceId?: string) => void;
  rehearsalInputRevision: number;
  assetSuggestions?: NonNullable<ProjectData['assetSuggestions']>;
  toggle: (id: string) => void;
  copy: (
    id: string,
    action:
      'development' | 'continue' | 'edit' | 'assets' | OrchestrationAction,
    requirementId?: string,
    sliceId?: string,
    report?: (message: string) => void,
  ) => void;
};
export type SceneNode = Node<CardData, 'scene'>;
export const SceneCard = memo(function SceneCard({
  id,
  data,
  selected,
}: NodeProps<SceneNode>) {
  const update = useUpdateNodeInternals();
  const card = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState('');
  const detailData: CardData =
    data.production && data.expanded
      ? {
          ...data,
          copy: (sceneId, action, key, sliceId) =>
            data.copy(sceneId, action, key, sliceId, setNotice),
        }
      : data;
  const { mainAssetId, description, rehearsalBrief } = data.scene;
  const hasNumberedTitle = /^[1-9]\d*(?:\.[1-9]\d*)* — \S/.test(
    data.scene.title,
  );
  const fallbackNumber = hasNumberedTitle
    ? ''
    : String(data.number).padStart(2, '0');
  const showAssetAction = !!data.assetSuggestions?.length;
  const image = (assetId: string, thumbnail = true) =>
    `/api/projects/${data.projectId}/assets/${assetId}${thumbnail ? '?thumbnail=true' : ''}`;
  const details = data.expanded ? (
    <div className="scene-detail-inner">
      {data.production && (
        <>
          <GameResume data={detailData} />
          <DevelopmentAction data={detailData} />
        </>
      )}
      {data.production && data.rehearsalEnabled && (
        <RehearsalActions data={detailData} />
      )}
      <DevelopmentDetails data={detailData} />
      <p>{data.scene.description}</p>
      {data.scene.notes && (
        <section>
          <h3>Creative notes</h3>
          <p>{data.scene.notes}</p>
        </section>
      )}
      {showAssetAction && (
        <section>
          <h3>Asset suggestions</h3>
          {data.assetSuggestions?.map((suggestion) => (
            <div key={suggestion.id}>
              <strong>{suggestion.name}</strong>
              <p>{suggestion.description}</p>
              <p>{suggestion.explanation}</p>
              {suggestion.result && (
                <p>Mesh Foundry revision {suggestion.result.revisionId}</p>
              )}
            </div>
          ))}
        </section>
      )}
      {rehearsalBrief && (
        <section className="scene-rehearsal-brief">
          <h3>Scene asset selections and earlier brief</h3>
          <p>{rehearsalBrief.layout}</p>
          <h4>Scenarios</h4>
          <ul>
            {rehearsalBrief.scenarios.map((scenario, index) => (
              <li key={index}>{scenario}</li>
            ))}
          </ul>
          {rehearsalBrief.assets.map((asset, index) => (
            <div key={index}>
              <strong>
                {asset.name} · {asset.decision}
              </strong>
              <p>{asset.rationale}</p>
              <p>{asset.behavior}</p>
              {asset.source && (
                <p>Mesh Foundry revision {asset.source.revisionId}</p>
              )}
            </div>
          ))}
          {rehearsalBrief.gaps.length > 0 && (
            <>
              <h4>Gaps</h4>
              <ul>
                {rehearsalBrief.gaps.map((gap, index) => (
                  <li key={index}>{gap}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {!!data.scene.rehearsalEvents?.length && (
        <section className="scene-rehearsal-brief">
          <h3>Rehearsal findings</h3>
          {[...data.scene.rehearsalEvents].reverse().map((event) => (
            <details key={event.eventId} className="nodrag">
              <summary>
                {event.kind === 'orchestration'
                  ? event.record.stage.replaceAll('-', ' ')
                  : event.kind === 'review'
                    ? `Brief review: ${event.blockout}`
                    : event.kind === 'draft'
                      ? `Rehearsal: ${event.draft.revisionId}`
                      : event.kind === 'candidate'
                        ? `Candidate${event.clearedReview ? ' review cleared' : ''}: ${event.model.revisionId}`
                        : event.kind === 'candidate-review'
                          ? `Foundry review: ${event.ownerOverride ? 'Owner override' : event.verdict}`
                          : `Fit check: ${event.verdict.replace('-', ' ')}`}
              </summary>
              <p>Record: {event.eventId}</p>
              {event.kind === 'orchestration' && (
                <pre className="orchestration-evidence">
                  {JSON.stringify(event.record, null, 2)}
                </pre>
              )}
              {event.kind === 'review' && (
                <p>
                  {event.scope} · Model import: {event.imports}
                </p>
              )}
              {event.kind === 'draft' && (
                <>
                  <p>
                    <ExternalRevision link={event.draft.link}>
                      Open historical rehearsal {event.draft.revisionId}
                    </ExternalRevision>
                  </p>
                  {event.requirements.map((requirement) => (
                    <div key={requirement.id}>
                      <h4>{requirement.name}</h4>
                      <p>
                        Source: {requirement.source.libraryId} /{' '}
                        {requirement.source.assetId} /{' '}
                        {requirement.source.revisionId}
                      </p>
                      <p>Objects: {requirement.objects.join(', ')}</p>
                      <ul>
                        {requirement.measurements.map(
                          ({ label, value, unit }, index) => (
                            <li key={index}>
                              {label}: {value} {unit}
                            </li>
                          ),
                        )}
                      </ul>
                      <p>Changes: {requirement.changes.join('; ')}</p>
                      <p>Preserve: {requirement.preserve.join('; ')}</p>
                      <p>Checks: {requirement.checks.join('; ')}</p>
                    </div>
                  ))}
                </>
              )}
              {'model' in event && (
                <p>
                  Model: {event.model.libraryId} / {event.model.assetId} /{' '}
                  {event.model.revisionId}
                </p>
              )}
              {event.kind === 'fit' && (
                <p>
                  Checked rehearsal:{' '}
                  {event.assembled?.revisionId ?? event.rehearsalRevisionId}
                  {event.assembled && <> · {event.assembled.link}</>}
                </p>
              )}
              {'requirementId' in event && (
                <p>Requirement: {event.requirementId}</p>
              )}
              {event.kind === 'candidate' && event.clearedReview && (
                <p>{event.clearedReview.evidence.join('; ')}</p>
              )}
              {event.kind === 'candidate-review' && event.ownerOverride && (
                <>
                  <p>
                    Overrides rejection {event.ownerOverride.rejectionEventId}
                  </p>
                  <p>{event.ownerOverride.reason}</p>
                </>
              )}
              {'evidence' in event && (
                <ul>
                  {event.evidence.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              )}
              {'findings' in event && (
                <ul>
                  {event.findings.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              )}
            </details>
          ))}
        </section>
      )}
      {data.scene.supportingAssetIds.length > 0 && (
        <section>
          <h3>Supporting visuals</h3>
          <div className="supporting-images">
            {data.scene.supportingAssetIds.map((a) => (
              <a
                key={a}
                href={image(a, false)}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={image(a)}
                  alt={`Supporting visual for ${data.scene.title}`}
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </section>
      )}
      {mainAssetId && (
        <a
          className="original-link"
          href={image(mainAssetId, false)}
          target="_blank"
          rel="noreferrer"
        >
          View full image <ArrowUpRight size={12} />
        </a>
      )}
    </div>
  ) : null;
  return (
    <article
      ref={card}
      className={`scene-card ${selected ? 'is-selected' : ''} ${data.expanded && !data.production ? 'is-open' : ''} ${data.recent ? 'is-recent' : ''}`}
      aria-label={data.scene.title}
    >
      {[Position.Left, Position.Right, Position.Top, Position.Bottom].map(
        (side) => (
          <Fragment key={side}>
            <Handle
              id={side}
              type="target"
              position={side}
              isConnectable={false}
            />
            <Handle
              id={side}
              type="source"
              position={side}
              isConnectable={false}
            />
          </Fragment>
        ),
      )}
      {mainAssetId ? (
        <div className="scene-image">
          <img
            src={image(mainAssetId)}
            alt={data.scene.title}
            loading="lazy"
            draggable={false}
          />
          {fallbackNumber && (
            <span className="scene-number">{fallbackNumber}</span>
          )}
          {data.recent && <span className="scene-updated">Updated</span>}
        </div>
      ) : (
        <div className="scene-text-meta">
          <span>{fallbackNumber && `${fallbackNumber} · `}Text scene</span>
          {data.recent && <span>Updated</span>}
        </div>
      )}
      <div className="scene-heading">
        <h2>{data.scene.title}</h2>
        <button
          className="icon-button nodrag"
          aria-label={`${data.expanded ? 'Collapse' : 'Open'} ${data.scene.title}`}
          aria-expanded={data.expanded}
          onClick={(e) => {
            e.stopPropagation();
            data.toggle(id);
          }}
        >
          <ChevronDown size={17} className={data.expanded ? 'rotated' : ''} />
        </button>
      </div>
      {!mainAssetId && (!data.expanded || data.production) && description && (
        <p className="scene-text-preview">{description}</p>
      )}
      <DevelopmentAction data={data} />
      {data.rehearsalEnabled && (
        <RehearsalActions
          data={data.production ? { ...data, expanded: false } : data}
        />
      )}
      {data.production && data.expanded && (
        <SceneDialog
          title={data.scene.title}
          origin={card}
          cover={mainAssetId ? image(mainAssetId) : undefined}
          close={() => {
            setNotice('');
            data.toggle(id);
          }}
          notice={notice}
        >
          {details}
        </SceneDialog>
      )}
      <AnimatePresence initial={false}>
        {!data.production && data.expanded && (
          <motion.div
            className="scene-detail nodrag nopan nowheel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            onUpdate={() => update(id)}
            onAnimationComplete={() => update(id)}
            onClick={(e) => e.stopPropagation()}
          >
            {details}
          </motion.div>
        )}
      </AnimatePresence>
      <div
        className={`scene-actions nodrag${showAssetAction ? '' : ' scene-actions-last'}`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.copy(id, 'continue');
          }}
          title="Copy a prompt to continue from this scene"
        >
          <ArrowUpRight size={14} /> Continue from here
        </button>
        <button
          aria-label={`Copy edit prompt for ${data.scene.title}`}
          onClick={(e) => {
            e.stopPropagation();
            data.copy(id, 'edit');
          }}
          title="Copy a prompt to revise this scene"
        >
          <PencilLine size={14} /> Edit
        </button>
      </div>
      {showAssetAction && (
        <div className="scene-asset-action nodrag">
          <button
            aria-label={`Copy asset-generation prompt for ${data.scene.title}`}
            title="Create 2D concepts from linked suggestions in Mesh Foundry"
            onClick={(e) => {
              e.stopPropagation();
              data.copy(id, 'assets');
            }}
          >
            <Shapes size={14} /> Copy asset-generation prompt
          </button>
        </div>
      )}
    </article>
  );
});

function cardTransform(dialog: HTMLElement, card: HTMLElement | null) {
  if (!card) return 'translateY(16px) scale(.96)';
  const source = card.getBoundingClientRect();
  const target = dialog.getBoundingClientRect();
  return `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`;
}

function SceneDialog({
  title,
  origin,
  cover,
  close,
  notice,
  children,
}: {
  title: string;
  origin: { current: HTMLElement | null };
  cover?: string;
  close: () => void;
  notice: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const motion = useRef<Animation | null>(null);
  const closing = useRef(false);

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    motion.current = element.animate(
      [
        { transform: cardTransform(element, origin.current) },
        { transform: 'none' },
      ],
      { duration: 320, easing: 'cubic-bezier(.22,.8,.24,1)' },
    );
    const source = origin.current;
    source?.classList.add('scene-card-expanded-away');
    return () => {
      motion.current?.cancel();
      source?.classList.remove('scene-card-expanded-away');
      element.close();
    };
  }, [origin]);

  function collapse() {
    if (closing.current) return;
    const element = dialog.current!;
    closing.current = true;
    const current = getComputedStyle(element).transform;
    motion.current?.cancel();
    element.dataset.collapsing = '';
    const animation = element.animate(
      [
        { transform: current },
        { transform: cardTransform(element, origin.current) },
      ],
      { duration: 220, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' },
    );
    motion.current = animation;
    void animation.finished.then(close, () => {});
  }

  return createPortal(
    <dialog
      ref={dialog}
      className="scene-production-dialog scene-detail"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        collapse();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close scene details"
          onClick={collapse}
        >
          <X size={20} />
        </button>
      </header>
      <div className="scene-production-body">
        {cover && <img className="scene-production-cover" src={cover} alt="" />}
        {children}
      </div>
      {notice && (
        <div role="status" className="scene-production-notice">
          {notice}
        </div>
      )}
    </dialog>,
    document.body,
  );
}

function RehearsalActions({ data }: { data: CardData }) {
  const {
    scene,
    rehearsalInputRevision,
    projectId,
    contentRevision,
    expanded,
  } = data;
  const { sync, plan, decision, draft, review, next, current } =
    orchestrationState(scene.rehearsalEvents, rehearsalInputRevision);
  const [feedback, setFeedback] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [staleFoundryPlanId, setStaleFoundryPlanId] = useState<string>();
  const unresolved = sync?.entries.filter((entry) => !entry.source) ?? [];
  const missing = unresolved.filter((entry) => entry.required);
  const recheck =
    next === 'decide' && plan?.eventId && staleFoundryPlanId === plan.eventId;
  const action =
    next === 'resolve' || recheck
      ? 'sync'
      : next === 'decide'
        ? undefined
        : next;
  const label = action && orchestrationActions[action];

  async function decide(verdict: 'approved' | 'changes-requested') {
    if (!plan || saving) return;
    setSaving(true);
    setStatus('');
    try {
      await api(`projects/${projectId}/plan-decision`, 'POST', {
        schemaVersion: 1,
        projectId,
        expectedContentRevision: contentRevision,
        requestId: crypto.randomUUID(),
        operations: [
          {
            type: 'rehearsal.record',
            id: scene.id,
            afterEventId: scene.rehearsalEvents?.at(-1)?.eventId ?? null,
            event: {
              kind: 'orchestration',
              eventId: crypto.randomUUID(),
              record: {
                stage: 'decision',
                planId: plan.eventId,
                verdict,
                ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
              },
            },
          },
        ],
      });
      setStatus(
        verdict === 'approved' ? 'Plan approved.' : 'Plan changes requested.',
      );
      setFeedback('');
    } catch (error) {
      if (
        error instanceof RequestError &&
        error.detail.code === 'STALE_FOUNDRY'
      )
        setStaleFoundryPlanId(plan.eventId);
      setStatus(
        error instanceof Error
          ? error.message
          : 'Could not save your decision.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scene-rehearsal-actions scene-asset-action nodrag">
      {expanded && <h3>Scene rehearsal</h3>}
      {next === 'resolve' && (
        <p>
          Waiting for {missing.map((entry) => entry.name).join(', ')}. Resolve
          the required selection before syncing again.
        </p>
      )}
      {next === 'decide' && !expanded && <p>Plan awaiting your decision</p>}
      {label && action && (
        <>
          <button
            type="button"
            className="studio-copy-action nodrag"
            onClick={(event) => {
              event.stopPropagation();
              data.copy(
                scene.id,
                action,
                recheck ? staleFoundryPlanId : undefined,
              );
            }}
          >
            <Shapes size={15} aria-hidden="true" /> {label.label}
          </button>
          {expanded && <p>{label.help}</p>}
        </>
      )}
      {expanded && sync && (
        <section className="orchestration-manifest">
          <h4>
            {current
              ? 'Accepted-model manifest'
              : 'Earlier accepted-model manifest'}
          </h4>
          <p>
            Foundry library <code>{sync.libraryId}</code>
          </p>
          {sync.entries.length ? (
            <ul>
              {[
                ...unresolved,
                ...sync.entries.filter((entry) => entry.source),
              ].map((entry, index) => (
                <li key={index}>
                  <strong>{entry.name}</strong>
                  {entry.required ? '' : ' · Optional'}
                  {entry.source ? (
                    <p>
                      <code>
                        {entry.source.assetId} / {entry.source.revisionId}
                      </code>
                    </p>
                  ) : (
                    <p>{entry.issue}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No assets selected for this scene.</p>
          )}
        </section>
      )}
      {expanded && current && plan && (
        <section className="orchestration-manifest" key={plan.eventId}>
          <h4>
            {decision?.verdict === 'approved'
              ? 'Approved orchestration plan'
              : 'Proposed orchestration plan'}
          </h4>
          <p>{plan.plan.intent}</p>
          {plan.plan.pieces.map((piece) => (
            <details key={piece.id}>
              <summary>{piece.label}</summary>
              <p>
                {piece.id}
                {piece.group && ` · Group ${piece.group}`}
              </p>
              <p>
                Center ({piece.position.join(', ')}) m · Size (
                {piece.size.join(', ')}) m
              </p>
              <p>
                Scale ({piece.scale.join(', ')}) · Rotation (
                {piece.rotation.join(', ')}) rad XYZ
              </p>
              <p>{piece.behavior}</p>
              {piece.source && (
                <p>
                  <code>
                    {piece.source.assetId} / {piece.source.revisionId}
                  </code>
                </p>
              )}
            </details>
          ))}
          <h5>Camera or traversal</h5>
          <ul>
            {plan.plan.cameraOrTraversal.map((cue, index) => (
              <li key={index}>{cue}</li>
            ))}
          </ul>
          <h5>Checks</h5>
          <ul>
            {plan.plan.checks.map((check, index) => (
              <li key={index}>{check}</li>
            ))}
          </ul>
          {plan.plan.references.length > 0 && (
            <>
              <h5>References</h5>
              <ul>
                {plan.plan.references.map((reference, index) => (
                  <li key={index}>{reference}</li>
                ))}
              </ul>
            </>
          )}
          {decision?.feedback && <p>Requested changes · {decision.feedback}</p>}
          {next === 'decide' && (
            <>
              <label>
                Changes to request
                <textarea
                  value={feedback}
                  maxLength={8000}
                  onChange={(event) => setFeedback(event.target.value)}
                />
              </label>
              <div className="orchestration-decisions">
                <button
                  type="button"
                  className="studio-copy-action"
                  disabled={saving}
                  onClick={() => void decide('approved')}
                >
                  Approve plan
                </button>
                <button
                  type="button"
                  className="studio-copy-action"
                  disabled={saving || !feedback.trim()}
                  onClick={() => void decide('changes-requested')}
                >
                  Request changes
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {expanded && current && draft && (
        <section className="orchestration-manifest">
          <h4>Placeholder draft</h4>
          <ExternalRevision
            link={`http://127.0.0.1:${draft.port}/revision/${draft.revisionId}/${draft.scenarioId}`}
          >
            Open draft {draft.revisionId}
          </ExternalRevision>
          {review && (
            <>
              <p>
                {review.verdict === 'approved'
                  ? 'Draft approved'
                  : review.verdict === 'plan-changes-requested'
                    ? 'Plan changes requested after draft review'
                    : 'Draft changes requested'}{' '}
                · {review.reviewer}
              </p>
              <ul>
                {review.findings.map((finding, index) => (
                  <li key={index}>{finding}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {expanded && status && <p role="status">{status}</p>}
    </section>
  );
}
