import { Fragment, memo, useState } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, PencilLine, ChevronDown, Shapes } from 'lucide-react';
import type { ProjectData, SceneData } from '../shared/schema';
import {
  assetNextAction,
  fitIsCurrent,
  rehearsalState,
  sceneNextAction,
} from '../shared/rehearsal';
import type { AssetPromptAction } from './api';

export type CardData = {
  scene: SceneData;
  projectId: string;
  number: number;
  expanded: boolean;
  recent: boolean;
  rehearsalEnabled: boolean;
  rehearsalInputRevision: number;
  assetSuggestions?: NonNullable<ProjectData['assetSuggestions']>;
  toggle: (id: string) => void;
  copy: (
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
  ) => void;
};
export type SceneNode = Node<CardData, 'scene'>;
export const SceneCard = memo(function SceneCard({
  id,
  data,
  selected,
}: NodeProps<SceneNode>) {
  const update = useUpdateNodeInternals();
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
  return (
    <article
      className={`scene-card ${selected ? 'is-selected' : ''} ${data.expanded ? 'is-open' : ''} ${data.recent ? 'is-recent' : ''}`}
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
      {!mainAssetId && !data.expanded && description && (
        <p className="scene-text-preview">{description}</p>
      )}
      {data.rehearsalEnabled && <RehearsalActions data={data} />}
      <AnimatePresence initial={false}>
        {data.expanded && (
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
            <div className="scene-detail-inner">
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
                        <p>
                          Mesh Foundry revision {suggestion.result.revisionId}
                        </p>
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
                              ? `Candidate: ${event.model.revisionId}`
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
                          Model: {event.model.libraryId} / {event.model.assetId}{' '}
                          / {event.model.revisionId}
                        </p>
                      )}
                      {event.kind === 'fit' && (
                        <p>
                          Checked rehearsal:{' '}
                          {event.assembled?.revisionId ??
                            event.rehearsalRevisionId}
                          {event.assembled && <> · {event.assembled.link}</>}
                        </p>
                      )}
                      {'requirementId' in event && (
                        <p>Requirement: {event.requirementId}</p>
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
  const [selected, select] = useState('');
  const { id, title, rehearsalBrief, rehearsalEvents } = data.scene;
  const state = rehearsalState(rehearsalEvents);
  const { review, head, assets } = state;
  const next = sceneNextAction(
    !!rehearsalBrief,
    data.rehearsalInputRevision,
    state,
  );
  const asset =
    assets.find(({ requirement }) => requirement.id === selected) ?? assets[0];
  const copy = (
    action: keyof typeof actionLabels,
    requirementId?: string,
    text: string = actionLabels[action],
    secondary = false,
  ) => (
    <button
      className={secondary ? 'rehearsal-secondary' : undefined}
      aria-label={`${text} for ${requirementId ? asset.requirement.name : title}`}
      onClick={(event) => {
        event.stopPropagation();
        data.copy(id, action, requirementId);
      }}
    >
      {text}
    </button>
  );
  const currentFit = asset && fitIsCurrent(asset, head);
  return (
    <section
      className="scene-rehearsal-actions scene-asset-action nodrag"
      aria-label="Rehearsal next action"
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
      ) : asset && head ? (
        <>
          {assets.length > 1 ? (
            <label>
              Asset
              <select
                className="nodrag"
                value={asset.requirement.id}
                onChange={(event) => select(event.target.value)}
              >
                {assets.map(({ requirement }) => (
                  <option value={requirement.id} key={requirement.id}>
                    {requirement.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <strong>{asset.requirement.name}</strong>
          )}
          <p>
            Foundry:{' '}
            {asset.acceptance?.verdict === 'accepted'
              ? 'Accepted'
              : asset.acceptance
                ? 'Needs revision'
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
                  ? 'Earlier rehearsal · Rehearsal correction needed'
                  : asset.fit
                    ? 'Outdated · Repeat fit check'
                    : 'Untested'}
          </p>
          {copy(assetNextAction(asset), asset.requirement.id)}
          {data.expanded &&
            copy('adopt-candidate', asset.requirement.id, undefined, true)}
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
    </section>
  );
}
