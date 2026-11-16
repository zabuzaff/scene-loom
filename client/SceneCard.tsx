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
import {
  assetNextAction,
  fitIsCurrent,
  rehearsalState,
  sceneNextAction,
  type Handoff,
} from '../shared/rehearsal';
import type { AssetPromptAction } from './api';
import type { sceneDevelopment } from '../shared/development';
import {
  DevelopmentAction,
  DevelopmentDetails,
  ExternalRevision,
  GameResume,
  isRequiredAsset,
  requiredRehearsalAssets,
} from './SceneProgress';

export type CardData = {
  scene: SceneData;
  projectId: string;
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
      | 'development'
      | 'continue'
      | 'edit'
      | 'assets'
      | 'rehearsal'
      | 'rehearsal-review'
      | 'rehearsal-handoff'
      | AssetPromptAction,
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
          <h3>Draft rehearsal brief</h3>
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
                {event.kind === 'review'
                  ? `Brief review: ${event.blockout}`
                  : event.kind === 'draft'
                    ? `Rehearsal: ${event.draft.revisionId}`
                    : event.kind === 'candidate'
                      ? `Candidate${event.clearedReview ? ' review cleared' : ''}: ${event.model.revisionId}`
                      : event.kind === 'candidate-review'
                        ? `Foundry review: ${event.verdict}`
                        : `Fit check: ${event.verdict.replace('-', ' ')}`}
              </summary>
              <p>Record: {event.eventId}</p>
              {event.kind === 'review' && (
                <p>
                  {event.scope} · Model import: {event.imports}
                </p>
              )}
              {event.kind === 'draft' && (
                <>
                  <p>Rehearsal reference: {event.draft.link}</p>
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

const actionLabels = {
  rehearsal: 'Copy rehearsal prep prompt',
  'rehearsal-review': 'Copy rehearsal review prompt',
  'rehearsal-handoff': 'Copy rehearsal handoff prompt',
  foundry: 'Copy Foundry revision request',
  'adopt-candidate': 'Copy existing-model review prompt',
  'candidate-review': 'Copy Foundry candidate review prompt',
  fit: 'Copy rehearsal fit-check prompt',
  'rehearsal-correction': 'Copy rehearsal correction request',
} as const;

function RehearsalActions({ data }: { data: CardData }) {
  const { id, title, rehearsalBrief, rehearsalEvents } = data.scene;
  const state = rehearsalState(rehearsalEvents);
  const { review, head, assets } = state;
  const next = sceneNextAction(
    !!rehearsalBrief,
    data.rehearsalInputRevision,
    state,
  );
  const copy = (
    action: keyof typeof actionLabels,
    asset?: Handoff,
    text: string = actionLabels[action],
    secondary = false,
  ) => (
    <button
      className={secondary ? 'rehearsal-secondary' : undefined}
      aria-label={`${text} for ${asset?.requirement.name ?? title}`}
      onClick={(event) => {
        event.stopPropagation();
        data.copy(id, action, asset?.requirement.id);
      }}
    >
      {text}
    </button>
  );
  const { required, unmeasured } = requiredRehearsalAssets(data.scene, assets);
  const compact =
    !data.expanded &&
    (data.production
      ? assets.length > 0 || unmeasured.length > 0
      : assets.length > 1);
  const openChecks =
    required.filter(
      (asset) => !(fitIsCurrent(asset, head) && asset.fit?.verdict === 'pass'),
    ).length + unmeasured.length;
  return (
    <section
      className="scene-rehearsal-actions scene-asset-action nodrag"
      aria-label="Rehearsal next action"
      onClick={(event) => event.stopPropagation()}
    >
      <p>
        {!rehearsalBrief
          ? 'Rehearsal · Prepare brief'
          : next === 'rehearsal-review'
            ? review
              ? 'Review outdated · Repeat independent review'
              : 'Brief saved · Independent review'
            : next === 'rehearsal'
              ? 'Blockout blocked · Revise brief'
              : next
                ? 'Review ready · Stage rehearsal'
                : 'Review ready · Rehearsal saved'}
      </p>
      {next ? (
        copy(
          next,
          undefined,
          next === 'rehearsal' && rehearsalBrief
            ? 'Copy rehearsal brief correction'
            : undefined,
        )
      ) : compact ? (
        <p>
          {openChecks} required asset fit{' '}
          {openChecks === 1 ? 'check' : 'checks'} open · Open scene for actions
        </p>
      ) : assets.length && head ? (
        <>
          {assets.map((asset) => {
            const currentFit = fitIsCurrent(asset, head);
            const action = assetNextAction(asset, head);
            const model = asset.candidate?.model ?? asset.requirement.source;
            const modelLink = asset.candidate
              ? asset.candidate.modelLink
              : asset.requirement.sourceLink;
            const verified = currentFit && asset.fit?.verdict === 'pass';
            return (
              <div className="rehearsal-asset-row" key={asset.requirement.id}>
                <strong>
                  {asset.requirement.name}
                  {!isRequiredAsset(data.scene, asset.requirement) &&
                    ' · Optional'}
                </strong>
                <p>
                  Foundry:{' '}
                  {asset.acceptance?.verdict === 'accepted'
                    ? 'Accepted'
                    : asset.acceptance?.verdict === 'needs-revision'
                      ? 'Needs revision'
                      : asset.candidate?.clearedReview
                        ? asset.candidate.clearedReview.ownerAcceptance ===
                          'pending'
                          ? 'Review cleared · Owner acceptance pending'
                          : 'Review cleared · Owner acceptance unverified'
                        : asset.candidate
                          ? 'Candidate awaiting review'
                          : 'Revision needed'}
                </p>
                <p>
                  In-scene fit:{' '}
                  {currentFit
                    ? asset.fit?.verdict === 'pass'
                      ? 'Verified'
                      : asset.fit?.verdict === 'model-defect'
                        ? 'Model defect'
                        : 'Rehearsal issue'
                    : asset.fit?.verdict === 'model-defect'
                      ? 'Earlier rehearsal · Model correction needed'
                      : asset.fit?.verdict === 'rehearsal-issue'
                        ? 'Earlier rehearsal · Repeat fit check'
                        : asset.fit
                          ? 'Outdated · Repeat fit check'
                          : 'Untested'}
                </p>
                <p>
                  <ExternalRevision link={modelLink}>
                    Open Mesh Foundry revision {model?.revisionId}
                  </ExternalRevision>
                  {!modelLink && (
                    <>
                      {' '}
                      ({model?.libraryId} / {model?.assetId})
                    </>
                  )}
                </p>
                {action === 'candidate-review' && (
                  <p>
                    {asset.candidate?.clearedReview &&
                    asset.candidate.clearedReview.ownerAcceptance === 'pending'
                      ? 'Mesh Foundry → Acceptance → Accept this revision. Then verify acceptance in Scene Loom.'
                      : asset.candidate?.clearedReview
                        ? 'Verify owner acceptance for this revision in Mesh Foundry.'
                        : 'Mesh Foundry → Copy developed model review prompt. If review finds a defect, use Copy developed model correction prompt.'}
                  </p>
                )}
                {action === 'foundry' && (
                  <p>
                    Scene Loom → Copy Foundry revision request.{' '}
                    {asset.candidate &&
                      'For a reviewed defect, Mesh Foundry also offers Copy developed model correction prompt.'}
                  </p>
                )}
                {action === 'fit' &&
                  (!currentFit || asset.fit?.verdict !== 'pass') && (
                    <p>
                      Scene Loom → Copy rehearsal fit-check prompt for the
                      accepted model and current rehearsal.
                    </p>
                  )}
                {action === 'rehearsal-correction' && (
                  <p>
                    Scene Loom → Copy rehearsal correction request to fix
                    placement or playback in Scene Rehearsal.
                  </p>
                )}
                {action === 'capability-blocked' ? (
                  <p>
                    Scene Rehearsal capability blocker:{' '}
                    {asset.fit?.capabilityBlocker}.{' '}
                    <ExternalRevision link={head.link}>
                      Open rehearsal {head.revisionId}
                    </ExternalRevision>
                  </p>
                ) : !verified ? (
                  copy(
                    action,
                    asset,
                    action === 'candidate-review' &&
                      asset.candidate?.clearedReview
                      ? 'Copy Foundry acceptance verification prompt'
                      : undefined,
                  )
                ) : data.expanded ? (
                  copy('fit', asset, 'Copy rehearsal fit-check prompt', true)
                ) : null}
                {(action === 'fit' || action === 'rehearsal-correction') &&
                  !verified && (
                    <p>
                      <ExternalRevision link={head.link}>
                        Open rehearsal {head.revisionId}
                      </ExternalRevision>
                    </p>
                  )}
                {data.expanded &&
                  copy('adopt-candidate', asset, undefined, true)}
              </div>
            );
          })}
          {data.expanded &&
            copy(
              'rehearsal-handoff',
              undefined,
              'Copy rehearsal continuation prompt',
              true,
            )}
        </>
      ) : (
        copy(
          'rehearsal-handoff',
          undefined,
          'Copy rehearsal continuation prompt',
        )
      )}
      {next && data.expanded && assets.length > 0 && (
        <details className="rehearsal-earlier-assets">
          <summary>Asset evidence awaiting rehearsal review</summary>
          {assets.map((asset) => {
            const model = asset.candidate?.model ?? asset.requirement.source;
            return (
              <p key={asset.requirement.id}>
                <strong>{asset.requirement.name}:</strong> Earlier handoff
                evidence ·{' '}
                <ExternalRevision
                  link={
                    asset.candidate?.modelLink ??
                    (!asset.candidate
                      ? asset.requirement.sourceLink
                      : undefined)
                  }
                >
                  Open Mesh Foundry revision {model.revisionId}
                </ExternalRevision>
              </p>
            );
          })}
        </details>
      )}
    </section>
  );
}
