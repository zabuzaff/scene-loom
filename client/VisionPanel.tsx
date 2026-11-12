import { useEffect, useRef } from 'react';
import { X, ArrowUpRight } from 'lucide-react';
import type { ProjectData } from '../shared/schema';
const sections = [
  ['summary', 'Summary'],
  ['originalIdea', 'Original idea'],
  ['purpose', 'Purpose'],
  ['audience', 'Who it is for'],
  ['projectType', 'Project type'],
  ['platforms', 'Platforms'],
  ['coreExperience', 'Core experience'],
  ['essentialFeatures', 'Essential features'],
  ['exclusions', 'Out of scope'],
  ['creativePillars', 'Creative pillars'],
  ['visualDirection', 'Visual direction and tone'],
  ['constraints', 'Constraints'],
  ['confirmedDecisions', 'Confirmed decisions'],
  ['assumptions', 'Agent assumptions'],
  ['openQuestions', 'Open questions'],
] as const;
export function VisionPanel({
  project,
  close,
  copy,
}: {
  project: ProjectData;
  close: () => void;
  copy: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      previous?.focus();
    };
  }, [close]);
  const vision = project.vision;
  return (
    <aside className="help-panel vision-panel" aria-label="Project Vision">
      <div className="help-heading">
        <h2>Project Vision</h2>
        <button
          ref={closeButton}
          className="icon-button"
          aria-label="Close Project Vision"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <p className="vision-project-name">{project.title}</p>
      <button className="primary-button" onClick={copy}>
        {vision ? 'Copy refine vision prompt' : 'Copy define vision prompt'}
        <ArrowUpRight size={16} />
      </button>
      {!vision ? (
        <p>
          No vision yet. Develop one with your agent using your idea and any
          existing scenes. Your storyboard stays in place.
        </p>
      ) : (
        <>
          <section>
            <h3>Project name</h3>
            <p>{vision.nameMeaning || vision.name}</p>
            <small>
              {vision.nameStatus === 'confirmed'
                ? 'Creator-confirmed name'
                : 'Provisional agent choice'}
            </small>
          </section>
          {vision.visualizationAssetId && (
            <section>
              <h3>Approved visualization</h3>
              <img
                className="vision-visualization"
                src={`/api/projects/${project.id}/assets/${vision.visualizationAssetId}`}
                alt={vision.visualDirection || 'Approved project visualization'}
              />
            </section>
          )}
          {sections.map(([key, label]) =>
            vision[key] ? (
              <section key={key}>
                <h3>{label}</h3>
                <p>{vision[key]}</p>
              </section>
            ) : null,
          )}
          <section>
            <h3>References</h3>
            {vision.references.length ? (
              <ul>
                {vision.references.map((reference, index) => (
                  <li key={index}>
                    <a href={reference.url} target="_blank" rel="noreferrer">
                      {reference.url}
                    </a>
                    <p>{reference.relevance}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No references recorded.</p>
            )}
          </section>
          <section>
            <h3>Naming research</h3>
            {vision.namingCheck.checkedAt && (
              <small>Checked {vision.namingCheck.checkedAt}</small>
            )}
            <p>{vision.namingCheck.notes || 'No web check recorded.'}</p>
            <small>
              Preliminary screening; legal availability is not established.
            </small>
          </section>
        </>
      )}
    </aside>
  );
}
