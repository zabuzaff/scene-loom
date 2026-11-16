import { Copy } from 'lucide-react';
import { developmentLabels, developmentTargetKey } from '../shared/development';
import {
  assetNextAction,
  fitIsCurrent,
  rehearsalState,
  sceneNextAction,
} from '../shared/rehearsal';
import type { SceneData } from '../shared/schema';
import type { Handoff } from '../shared/rehearsal';
import type { CardData } from './SceneCard';

export function DevelopmentAction({ data }: { data: CardData }) {
  const target = data.development;
  if (!target) return null;
  const { next, reviewed } = target;
  const prerequisite = next.prerequisite;
  const pickup =
    prerequisite?.sceneIds.find((id) => id !== data.scene.id) ??
    prerequisite?.sceneIds[0];
  const action =
    next.status === 'planned' && !next.latest
      ? 'Copy start development prompt'
      : 'Copy continue development prompt';
  return (
    <section
      className="scene-progress-action scene-asset-action nodrag"
      aria-label="Development next action"
      onClick={(event) => event.stopPropagation()}
    >
      <p>
        <strong>
          {!reviewed
            ? 'Plan needs review'
            : prerequisite
              ? 'Blocked'
              : developmentLabels[next.status]}
        </strong>{' '}
        · {next.name}
      </p>
      {!reviewed ? (
        <p>Use Copy review development plan prompt in Project actions.</p>
      ) : prerequisite && pickup ? (
        <>
          <p>Waiting for {prerequisite.name}</p>
          <button onClick={() => data.openScene(pickup, prerequisite.id)}>
            Open {data.sceneTitles[pickup]}
          </button>
        </>
      ) : next.status !== 'verified' ? (
        <button
          onClick={() =>
            data.copy(
              data.scene.id,
              'development',
              developmentTargetKey(target),
              next.id,
            )
          }
        >
          {action}
        </button>
      ) : null}
    </section>
  );
}

export function DevelopmentDetails({ data }: { data: CardData }) {
  if (!data.development) return null;
  const { slices, next, planRevision } = data.development;
  return (
    <section className="scene-development-details">
      <h3>Development slices</h3>
      {slices.map(({ id, name, status, latest, prerequisite }) => (
        <details key={id} className="nodrag">
          <summary>
            {name} · {developmentLabels[status]}
          </summary>
          {prerequisite && <p>Waiting for {prerequisite.name}.</p>}
          {data.development?.reviewed &&
            id !== next.id &&
            !prerequisite &&
            status !== 'verified' && (
              <button
                className="scene-inline-action nodrag"
                onClick={() => data.openScene(data.scene.id, id)}
              >
                Select {name}
              </button>
            )}
          {latest ? (
            <>
              {latest.planRevision !== planRevision && (
                <p>Earlier plan evidence · Recheck under the current plan.</p>
              )}
              <p>
                <strong>Changed:</strong> {latest.checkpoint.changed}
              </p>
              <p>
                <strong>Remaining:</strong> {latest.checkpoint.remaining}
              </p>
              <p>
                <strong>Resume:</strong> {latest.checkpoint.resume}
              </p>
              {latest.checkpoint.blocker && (
                <p>
                  <strong>Blocker:</strong> {latest.checkpoint.blocker}
                </p>
              )}
              <p>
                <strong>Verification:</strong>{' '}
                {latest.checkpoint.evidence.length
                  ? latest.checkpoint.evidence.join('; ')
                  : 'No evidence saved'}
              </p>
            </>
          ) : (
            <p>
              {id === next.id
                ? 'No checkpoint yet.'
                : 'No development evidence saved.'}
            </p>
          )}
        </details>
      ))}
    </section>
  );
}

export function ExternalRevision({
  link,
  children,
}: {
  link?: string;
  children: React.ReactNode;
}) {
  return link && /^https?:\/\//i.test(link) ? (
    <a href={link} target="_blank" rel="noreferrer" className="nodrag">
      {children}
    </a>
  ) : (
    <span>{children} · Link unavailable</span>
  );
}

export function isRequiredAsset(
  scene: SceneData,
  requirement: Handoff['requirement'],
) {
  if (requirement.optional !== undefined) return !requirement.optional;
  const entry = scene.rehearsalBrief?.assets.find(({ source, name }) =>
    source
      ? source.libraryId === requirement.source.libraryId &&
        source.assetId === requirement.source.assetId
      : name === requirement.name,
  );
  return entry?.decision !== 'optional' && entry?.decision !== 'leave out';
}

export function requiredRehearsalAssets(scene: SceneData, assets: Handoff[]) {
  const required = assets.filter(({ requirement }) =>
    isRequiredAsset(scene, requirement),
  );
  const unmeasured = (scene.rehearsalBrief?.assets ?? []).filter(
    (item) =>
      (item.decision === 'use' || item.decision === 'missing') &&
      !assets.some(({ requirement }) =>
        item.source
          ? item.source.libraryId === requirement.source.libraryId &&
            item.source.assetId === requirement.source.assetId
          : item.name === requirement.name,
      ),
  );
  return { required, unmeasured };
}

export function GameResume({ data }: { data: CardData }) {
  const { scene, rehearsalInputRevision, development } = data;
  const state = rehearsalState(scene.rehearsalEvents);
  const { head, assets, review } = state;
  const stage = sceneNextAction(
    !!scene.rehearsalBrief,
    rehearsalInputRevision,
    state,
  );
  const current = data.rehearsalEnabled && !stage && !!head;
  const { required, unmeasured } = requiredRehearsalAssets(scene, assets);
  const fit = current
    ? required.filter(
        (asset) => fitIsCurrent(asset, head) && asset.fit?.verdict === 'pass',
      ).length
    : 0;
  const total = required.length + unmeasured.length;
  const sliceTotal = development?.slices.length ?? 0;
  const verified =
    development?.slices.filter(({ status }) => status === 'verified').length ??
    0;
  const latest = development?.latest;
  const nextCheckpoint = development?.next.latest;
  const checkpoint = latest?.checkpoint;
  const issues = assets.filter(({ fit }) => fit?.verdict === 'rehearsal-issue');
  const latestHandoff = scene.rehearsalEvents?.at(-1);
  const handoffResult =
    latestHandoff &&
    ('evidence' in latestHandoff
      ? latestHandoff.evidence[0]
      : latestHandoff.kind === 'candidate'
        ? (latestHandoff.clearedReview?.evidence[0] ??
          'Foundry candidate recorded.')
        : latestHandoff.kind === 'draft'
          ? 'Rehearsal saved.'
          : latestHandoff.findings[0]);
  const currentIssue = issues.find(
    (asset) => current && fitIsCurrent(asset, head),
  );
  const blocker =
    development?.next.prerequisite?.name ??
    (nextCheckpoint?.planRevision === development?.planRevision
      ? nextCheckpoint?.checkpoint.blocker
      : undefined) ??
    currentIssue?.fit?.capabilityBlocker ??
    (review?.blockout === 'needs-revision' ? review.findings[0] : undefined);
  const unfinished = required.find(
    (asset) => !fitIsCurrent(asset, head) || asset.fit?.verdict !== 'pass',
  );
  const action = unfinished && assetNextAction(unfinished, head);
  const nextAsset =
    unfinished && action
      ? {
          foundry: 'Copy Foundry revision request',
          'candidate-review':
            unfinished.candidate?.clearedReview?.ownerAcceptance === 'pending'
              ? 'Accept this revision in Mesh Foundry'
              : unfinished.candidate?.clearedReview
                ? 'Copy Foundry acceptance verification prompt'
                : 'Copy developed model review prompt in Mesh Foundry',
          fit: 'Copy rehearsal fit-check prompt',
          'rehearsal-correction': 'Copy rehearsal correction request',
          'capability-blocked':
            'Open the affected rehearsal for the capability blocker',
        }[action] + ` · ${unfinished.requirement.name}`
      : undefined;
  const nextHandoff = !data.rehearsalEnabled
    ? undefined
    : stage === 'rehearsal'
      ? rehearsalPreparationLabel(!!scene.rehearsalBrief)
      : stage === 'rehearsal-review'
        ? 'Copy rehearsal review prompt'
        : stage === 'rehearsal-handoff'
          ? 'Copy rehearsal handoff prompt'
          : (nextAsset ??
            (unmeasured.length
              ? 'Copy rehearsal continuation prompt to measure required assets'
              : undefined));
  const nextCopy =
    stage ??
    (!unfinished
      ? unmeasured.length
        ? 'rehearsal-handoff'
        : undefined
      : action === 'capability-blocked' ||
          (action === 'candidate-review' &&
            (!unfinished.candidate?.clearedReview ||
              unfinished.candidate.clearedReview.ownerAcceptance === 'pending'))
        ? undefined
        : action);
  const nextLink =
    !stage &&
    (action === 'capability-blocked'
      ? head?.link
      : action === 'candidate-review' && !nextCopy
        ? unfinished?.candidate?.modelLink
        : undefined);
  return (
    <section className="game-resume">
      <div className="game-resume-summary">
        <h3>Where you left off</h3>
        <p className="game-resume-result">
          {checkpoint &&
            latest?.planRevision !== development?.planRevision &&
            'Earlier plan · '}
          {checkpoint?.changed ??
            handoffResult ??
            'No checkpoint or rehearsal result saved yet.'}
        </p>
        {blocker && (
          <p>
            <strong>Blocker:</strong> {blocker}
          </p>
        )}
        {nextCheckpoint &&
          nextCheckpoint.planRevision === development?.planRevision && (
            <p>
              <strong>Resume:</strong> {nextCheckpoint.checkpoint.resume}
            </p>
          )}
        {checkpoint && handoffResult && (
          <p>
            <strong>Handoff update:</strong> {handoffResult}
          </p>
        )}
        {nextHandoff && (
          <p>
            <strong>Next handoff:</strong>{' '}
            {nextCopy ? (
              <button
                className="scene-inline-action studio-copy-action nodrag"
                onClick={() =>
                  data.copy(
                    scene.id,
                    nextCopy,
                    stage ? undefined : unfinished?.requirement.id,
                  )
                }
              >
                <Copy size={14} aria-hidden="true" />
                {nextHandoff}
              </button>
            ) : nextLink ? (
              <ExternalRevision link={nextLink}>{nextHandoff}</ExternalRevision>
            ) : (
              nextHandoff
            )}
          </p>
        )}
      </div>
      <dl className="game-progress">
        <div>
          <dt>Required asset fit</dt>
          <dd>
            {total
              ? `${fit} of ${total} required assets fit the current rehearsal`
              : 'No required assets recorded'}
            {total > 0 && (
              <StudioProgress
                label="Required asset fit"
                value={fit}
                max={total}
              />
            )}
          </dd>
        </div>
        <div>
          <dt>Rehearsal</dt>
          <dd>
            {!data.rehearsalEnabled
              ? 'Mesh Foundry handoff is off'
              : current
                ? 'Current rehearsal recorded'
                : head
                  ? 'Saved rehearsal needs re-review'
                  : 'No rehearsal recorded'}
            {data.rehearsalEnabled && (
              <StudioProgress
                label="Rehearsal preparation"
                value={
                  current
                    ? 3
                    : stage === 'rehearsal-handoff'
                      ? 2
                      : stage === 'rehearsal-review'
                        ? 1
                        : 0
                }
                max={3}
              />
            )}
            {head && (
              <p>
                <ExternalRevision link={head.link}>
                  Open rehearsal {head.revisionId}
                </ExternalRevision>
              </p>
            )}
          </dd>
        </div>
        <div>
          <dt>Implementation</dt>
          <dd>
            {sliceTotal
              ? `${verified} of ${sliceTotal} slices verified`
              : 'No development slices mapped'}
            {sliceTotal > 0 && (
              <StudioProgress
                label="Implementation"
                value={verified}
                max={sliceTotal}
              />
            )}
          </dd>
        </div>
      </dl>
      {issues.length > 0 && (
        <details className="nodrag">
          <summary>Open rehearsal issues ({issues.length})</summary>
          <ul>
            {issues.map((asset) => (
              <li key={asset.requirement.id}>
                {asset.requirement.name}:{' '}
                {asset.fit!.capabilityBlocker ?? asset.fit!.evidence.join('; ')}
                {!current || !fitIsCurrent(asset, head)
                  ? ' (earlier rehearsal)'
                  : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {unmeasured.length > 0 && (
        <ul className="game-missing-assets">
          {unmeasured.map((item, index) => (
            <li key={index}>
              {item.name}: No fit requirement saved. Scene Loom →{' '}
              {stage === 'rehearsal-review'
                ? 'Copy rehearsal review prompt'
                : stage === 'rehearsal'
                  ? 'Copy rehearsal brief correction'
                  : stage === 'rehearsal-handoff'
                    ? 'Copy rehearsal handoff prompt'
                    : 'Copy rehearsal continuation prompt'}
              .
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function rehearsalPreparationLabel(hasBrief: boolean) {
  return hasBrief
    ? 'Copy rehearsal brief correction'
    : 'Copy rehearsal prep prompt';
}

function StudioProgress({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  return (
    <div
      className="studio-progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuenow={value}
      aria-valuemax={max}
    >
      <span style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}
