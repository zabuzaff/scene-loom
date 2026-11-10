import { Fragment, memo } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, PencilLine, ChevronDown, Shapes } from 'lucide-react';
import type { SceneData } from '../shared/schema';
export type CardData = {
  scene: SceneData;
  projectId: string;
  number: number;
  expanded: boolean;
  recent: boolean;
  meshFoundryEnabled: boolean;
  toggle: (id: string) => void;
  copy: (id: string, action: 'continue' | 'edit' | 'assets') => void;
};
export type SceneNode = Node<CardData, 'scene'>;
export const SceneCard = memo(function SceneCard({
  id,
  data,
  selected,
}: NodeProps<SceneNode>) {
  const update = useUpdateNodeInternals();
  const { mainAssetId, description } = data.scene;
  const hasNumberedTitle = /^[1-9]\d*(?:\.[1-9]\d*)* — \S/.test(
    data.scene.title,
  );
  const fallbackNumber = hasNumberedTitle
    ? ''
    : String(data.number).padStart(2, '0');
  const showAssetAction = data.meshFoundryEnabled && !!mainAssetId;
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
            title="Plan assets from this scene, then create 2D concepts in Mesh Foundry"
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
