# Scene Loom

A local, agent-maintained storyboard studio for software projects. Discuss ideas in your preferred agent harness; agents populate and revise an image-led canvas that you explore visually.

The first usable version is implemented: one canvas per software project, image cards with animated details, branches and loops, persisted arrangement, targeted prompt copying, live updates, and an agent CLI with validated batches and local recovery.

## Run locally

Requires Node.js 22.12+ and npm. From this repository:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4318. No account or AI API key is needed. The studio starts empty; use **Copy a starting prompt** and paste it into your agent to create your first project.

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

Scene Loom has no dependency on fish.exe or any other software repository. No cloud deployment is part of this version.

## Develop a project vision

Use **Copy new project starter prompt** in the project menu, or the empty-studio starting prompt. Paste it into your agent and fill in your rough idea; the other fields are optional. The agent develops the concept, asks a few questions, saves a Project Vision, and generates the first illustrated scene when its tools allow. **Project Vision** opens the saved brief and a prompt to define or refine it. Edit and Continue can take your direction or use agent judgment when left blank. Research and image generation require capabilities in your external agent; naming web checks are preliminary, not legal clearance. See [the enhancement scope](docs/project-vision-scope.md).

### Agent and harness compatibility

Scene Loom uses a local CLI and versioned JSON schemas, not a particular AI provider. Use any agent harness that can execute the CLI on the machine running the studio (with the same data directory). A remote agent needs an explicitly configured way to execute locally; copying a prompt alone does not provide machine access. Browsing and image generation are optional external capabilities: without image generation/import access, an agent can still save a vision but cannot publish an imageless scene. Plain-text questions work without harness-specific interactive controls.
