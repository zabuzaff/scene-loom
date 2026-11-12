# Scene Loom repository guidance

## Commands and boundaries

- Node.js 22.12+; `npm ci` installs the pinned lockfile. `npm run dev` serves the local studio through Vite; `npm run build` typechecks and builds; `npm start` serves the built application. Default URL: http://127.0.0.1:4318. Development requires refresh for client changes and restart for server changes.
- Verified checks: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and `npm run test:browser`. Browser checks require Google Chrome and free ports 4319/4320. Build before browser checks. `npm run icons` regenerates browser icons from public/scene-loom-mark.svg; commit the generated public assets alongside their source when committing is authorized.
- Read PRODUCT.md and relevant plan sections before changing behavior; DESIGN.md for UI; docs/agent-interface.md for data changes. Update docs/progress.md at usable checkpoints.
- Implementation approved on 2026-11-05. Do not commit, push, or deploy without authorization. GitHub remote: git@github.com:zabuzaff/scene-loom.git (private repository).

## Architecture and invariants

- React/TypeScript/Vite client, React Flow custom scene nodes, Motion transitions; Fastify local service; Zod shared schemas; sharp image ingestion; CLI communicates with the same service as the UI.
- Keep Scene Loom independent of software repositories. A software project can have a Baseline and named storyboard copies. Each storyboard has one canvas, with no board hierarchy. Users browse, reposition cards, and copy prompts; agents supply content and connections.
- Support text-only scenes. Validate all attached images as imported, decoded assets. Validate whole durable models and complete graphs before atomic publication. Reject invalid batches without partial content changes.
- Content and layout revisions are separate. Agent edits preserve user positions by default. Never use full-project replacement from the UI or CLI.
- Personal data defaults to ~/Library/Application Support/Scene Loom. Tests must use an absolute temporary SCENE_LOOM_DATA_DIR. Do not commit data, assets, backups, runtime.json, service.lock, credentials, dist/, or test artifacts.
- Only the service writes project data; do not edit a running project's JSON directly. Keep single-service locking, origin/host checks, authentication, and CLI-only local-file import intact.
- Use the approved Impeccable skill for frontend design/review; project brief takes precedence. Owner explicitly excluded reduced-motion work. The globally installed skill is not vendored or assumed available on other machines.
- Client opening/dragging/scrolling, live reconciliation, recovery, and idempotency need meaningful regression checks when modified. Small cosmetic work needs rendered inspection rather than mirrored implementation tests.
