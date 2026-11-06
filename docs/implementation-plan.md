# Implementation plan — approved 2026-11-05

## First useful outcome

An agent creates a complete image-backed branching storyboard from an external agent harness; the owner opens it locally, reads the flow, expands scenes, moves cards, and copies targeted follow-up prompts. The agent revises a card and the viewer updates without losing the owner's arrangement.

## Proposed architecture

- Desktop-browser application served on loopback only; no native wrapper or hosted service for v1.
- React + TypeScript + Vite frontend. React Flow is the approved graph interaction layer; use custom scene nodes and directed edges. Motion is the approved animation layer, isolated from canvas positioning transforms.
- Small Node.js/TypeScript local service, proposed with Fastify. It serves the built frontend, owns persistence, imports assets, validates mutations, and emits successful-change notifications through server-sent events.
- A local CLI is the primary agent entry point. It talks to the same service as the viewer. Structured JSON input/output, schema/help discovery, stable IDs, dry runs, and atomic batches are mandatory. No database-file or JSON-file editing by agents during normal use.
- Shared versioned schemas, proposed with Zod, for CLI/service validation. React Flow objects remain a presentation mapping, not the durable data format.
- Use ordinary folders in one repository (client, server, shared, CLI); avoid monorepo tooling and plugin frameworks. Pin compatible versions when scaffolding and document actual commands then.

The owner approved implementation on 2026-11-05. The supporting stack is now implemented; see README.md for verified commands and progress.md for delivery status. This document preserves the original delivery sequence.

## Local data and assets

Default data root: ~/Library/Application Support/Scene Loom, with a configurable absolute override for development/tests and future relocation. It is separate from ~/vibed/scene-loom and from game source repositories.

Each project directory contains a versioned project.json, assets/, thumbnails/, and backups/. project.json contains metadata, scenes, connections, and persisted positions. Store viewport separately per project so viewing state does not conflict with agent content revisions. Asset references use relative internal IDs/paths, never temporary external URLs.

The service copies locally supplied images into project-owned assets, validates decoded image type/size, and generates display thumbnails. A missing or invalid main image rejects publication. Import supporting images through the same path. Preserve originals for detailed viewing. Generate opaque IDs and prevent path traversal; agents may import explicit local files, but browser requests must not expose arbitrary filesystem paths.

Persist through serialized service writes and atomic file replacement. Prepare assets first, validate the entire resulting graph, save a recovery snapshot, then publish the new project revision. Failure must preserve the prior valid project. Unreferenced staged assets may be cleaned later; do not delete assets still needed by snapshots. Start with bounded snapshots (proposed: last 20 successful content mutations). Retention and recovery are operational safeguards, not visible idea variants.

The CLI and browser share one service write path. Protect loopback mutations against cross-origin browser requests with origin validation and a local session token; do not expose an unauthenticated mutation endpoint to the LAN. No user-account system needed.

## Ingestion and layout

See agent-interface.md. Agents submit complete required content on creation, but patch only intended fields on revision. Content and layout revisions are separate so an agent's content edit cannot overwrite a simultaneous drag. The service serializes writes, rejects stale content revisions, and returns actionable retry information. Newly created cards get deterministic nearby free positions; existing positions never change implicitly. No global layout engine is needed initially.

After a committed mutation, notify the viewer. Reconcile fresh content while preserving selection, viewport, and unsaved movement; do not refit or steal focus. New scenes remain discoverable through a recent-update focus action.

## Phased delivery

### 1. Foundation and agent ingestion

Scaffold the proposed stack, record verified commands, implement storage/schema/asset import and the CLI/service mutation path. Deliver project creation, reading, scene upsert, connections, validation, and backups before visual polish.

Exit: a CLI batch creates a project with images and branching/looping connections; reopening reproduces the same data. Invalid batches and stale revisions leave valid state intact. Document an executable example with fixtures.

### 2. First useful canvas

Build project selection, image cards, directed labeled connections, pan/zoom/fit, persisted dragging, inline details, and the two copy-prompt actions. Use the approved visual direction and Motion. Connect live service updates.

Exit: complete the first-use workflow end to end through the actual CLI and browser. A content revision preserves dragged positions and viewport, and copied prompts identify the correct project and scene.

### 3. Refinement and recovery

Add title search/focus, recent-update focus, practical error feedback, recovery command, thumbnail/loading performance, and Impeccable-assisted visual review. Do not expand into a general-purpose editor.

Exit: verification below passes, docs cover setup and agent use, and rendered screenshots show the actual interface with representative scene artwork. Owner reviews the result before further scope.

## Practical verification criteria

- Required-image validation covers nonexistent/corrupt images, not just a nonempty filename. Optional supporting images persist too.
- Directed graph supports a branch, join, cycle, and a self-loop; reject dangling references and duplicate IDs. Deleting a scene handles its connections explicitly and atomically.
- Repeated request IDs do not duplicate scenes. Stale content revisions produce a clear conflict and no partial change.
- Simultaneous agent edits and user drags preserve both intended content and latest positions. Dragging while notifications arrive remains stable.
- Restart the service and browser: images, details, graph, positions, and saved viewport survive. Work offline after images are imported.
- Copy both prompts and use them from a separate agent session: the documented CLI location and project IDs resolve without relying on this conversation.
- Updates appear without manual refresh; reconnect after a stopped service fetches current state. Report connection/save errors visibly.
- Automated integration tests cover atomic batches, asset validation, conflict behavior, persistence, and backup restoration. Browser tests cover opening, dragging, copy text, and live refresh where they provide regression value.
- Inspect the rendered UI with representative imagery at a normal laptop window. Confirm details remain readable, arrows follow expanded cards, buttons do not trigger dragging, and images do not stretch during animation.
- Proposed performance fixture: 100 scenes and 150 connections with thumbnails, measured on the owner's machine. Panning and opening cards must remain responsive; record observed results rather than promising a frame rate in advance.
- Run the implemented typecheck, build, lint, and relevant tests. Review the final diff and exclude runtime data and accidental files.

## Boundaries and approval

Application implementation and dependencies were authorized on 2026-11-05. Deliver incrementally and update progress.md at each usable checkpoint. Commits, pushes, and deployment still require separate authorization. The GitHub remote is git@github.com:zabuzaff/scene-loom.git; source publication was authorized after owner testing and review. Source Git history is separate from local storyboard backups.
