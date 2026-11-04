# Scene Loom

A local, agent-maintained storyboard studio for game development. Discuss ideas in Codex; agents populate and revise an image-led canvas that you explore visually.

The first usable version is implemented: one canvas per game project, image cards with animated details, branches and loops, persisted arrangement, targeted prompt copying, live updates, and an agent CLI with validated batches and local recovery.

## Run locally

Requires Node.js 22.12+ and npm. From this repository:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4318. No account or AI API key is needed. The studio starts empty; use **Copy a starting prompt** and paste it into Codex to create your first project.

For development, use `npm run dev` instead. It serves source through Vite on the same local address. Refresh after client edits; restart after server edits.

Default project data: `~/Library/Application Support/Scene Loom`. Override with an absolute `SCENE_LOOM_DATA_DIR`; both service and CLI must use the same value. `SCENE_LOOM_PORT` changes the service port (default 4318). Keep data directories outside the source repository.

## Agent use

Read [the agent interface guide](docs/agent-interface.md). Start with:

```sh
npm --silent run cli -- --help
npm --silent run cli -- schema batch
npm --silent run cli -- project list
```

The service must be running for data operations. The CLI discovers its address and credentials locally; never copy runtime tokens into prompts. Scene cards copy a complete CLI reference, including the active data directory, to make follow-up chats reliable.

An optional example seeder accepts four real local image files:

```sh
npm run demo -- /absolute/arrival.jpg /absolute/forest.jpg /absolute/shore.jpg /absolute/beacon.jpg
```

It creates a separate **Tideglass — example** project through the actual CLI. It does not run at startup or download images.

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:browser
```

Browser tests use installed Google Chrome, ports 4319/4320, and temporary data. They exercise the CLI/viewer, live updates during dragging, 100 scenes/150 connections, and a real service restart. Source, schemas, and docs are tracked by Git; personal assets and runtime state are not.

## Project records

- [Product and scope](PRODUCT.md)
- [Design direction](DESIGN.md)
- [Implementation plan and delivery phases](docs/implementation-plan.md)
- [Agent interface and recovery](docs/agent-interface.md)
- [Progress and remaining work](docs/progress.md)
- [Verification evidence](docs/verification.md)

Scene Loom has no dependency on fish.exe or any other game repository. No cloud deployment is part of this version.
