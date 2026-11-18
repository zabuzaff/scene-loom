import { developmentLabels, developmentTargetKey } from '../shared/development';
import { orchestrationState } from '../shared/orchestration';
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

export function SceneStatusResync({ data }: { data: CardData }) {
  const { scene, rehearsalInputRevision } = data;
  return (
    <div className="scene-status-resync">
      <button
        type="button"
        className="studio-copy-action nodrag"
        onClick={() => data.copy(scene.id, 'resync-status')}
      >
        Copy scene status resync prompt
      </button>
      {scene.statusReport && (
        <details>
          <summary>
            Last resync ·{' '}
            <time dateTime={scene.statusReport.checkedAt}>
              {new Date(scene.statusReport.checkedAt).toLocaleString()}
            </time>
            {scene.statusReport.inputRevision !== rehearsalInputRevision &&
              ' · Storyboard inputs changed'}
          </summary>
          <dl>
            <dt>Foundry</dt>
            <dd>{scene.statusReport.foundry}</dd>
            <dt>Rehearsal</dt>
            <dd>{scene.statusReport.rehearsal}</dd>
            <dt>Implementation</dt>
            <dd>{scene.statusReport.implementation}</dd>
            <dt>Next</dt>
            <dd>{scene.statusReport.next}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

export function GameResume({ data }: { data: CardData }) {
  const { scene, rehearsalInputRevision, development } = data;
  const { sync, current, next } = orchestrationState(
    scene.rehearsalEvents,
    rehearsalInputRevision,
  );
  const required = sync?.entries.filter((entry) => entry.required) ?? [];
  const verified = required.filter((entry) => entry.source).length;
  const latest = development?.latest;
  const checkpoint = development?.next.latest;
  const slices = development?.slices ?? [];
  const blocker =
    development?.next.prerequisite?.name ??
    (checkpoint?.planRevision === development?.planRevision
      ? checkpoint?.checkpoint.blocker
      : undefined);
  const rehearsalStatus = {
    sync: 'Asset sync pending',
    resolve: 'Required assets unresolved',
    plan: 'Plan proposal pending',
    publish: 'Placeholder draft pending',
    handoff: 'Draft ready. Accept it in Rehearsal, then start implementation',
  }[next];
  return (
    <section className="game-resume">
      <div className="game-resume-summary">
        <h3>Where you left off</h3>
        <p className="game-resume-result">
          {latest?.planRevision !== development?.planRevision && latest
            ? 'Earlier plan · '
            : ''}
          {latest?.checkpoint.changed ??
            (data.rehearsalEnabled
              ? rehearsalStatus
              : 'No development checkpoint saved yet.')}
        </p>
        {blocker && (
          <p>
            <strong>Blocker</strong> · {blocker}
          </p>
        )}
        {checkpoint &&
          checkpoint.planRevision === development?.planRevision && (
            <p>Resume · {checkpoint.checkpoint.resume}</p>
          )}
        <SceneStatusResync data={data} />
      </div>
      <dl className="game-progress">
        {data.rehearsalEnabled && (
          <>
            <div>
              <dt>Required asset acceptance</dt>
              <dd>
                {current && required.length
                  ? `${verified} of ${required.length} required assets verified`
                  : current
                    ? 'No required assets selected'
                    : 'Current sync pending'}
                {current && required.length > 0 && (
                  <StudioProgress
                    label="Required asset acceptance"
                    value={verified}
                    max={required.length}
                  />
                )}
              </dd>
            </div>
            <div>
              <dt>Rehearsal</dt>
              <dd>{rehearsalStatus}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Implementation</dt>
          <dd>
            {slices.length
              ? `${slices.filter((slice) => slice.status === 'verified').length} of ${slices.length} slices verified`
              : 'No development slices mapped'}
            {slices.length > 0 && (
              <StudioProgress
                label="Implementation"
                value={
                  slices.filter((slice) => slice.status === 'verified').length
                }
                max={slices.length}
              />
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
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
