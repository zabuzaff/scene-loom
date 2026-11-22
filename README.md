# Scene Loom

A local, agent-maintained storyboard studio for software projects. Discuss ideas in your preferred agent harness; agents populate and revise a storyboard canvas that you explore visually.

The first usable version is implemented: one canvas per storyboard, text and image cards with animated details, branches and loops, persisted arrangement, targeted prompt copying, live updates, and an agent CLI with validated batches and local recovery.

Use the project switcher’s **Storyboards** list to choose the Baseline or a named storyboard. Enter a name and select **Create copy** to start from the open storyboard with independent scenes, layout, and revision history. Copied prompts carry the exact storyboard target and scene.

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

### Start the whole studio

```sh
npm run up              # start whichever of the three services is not running
npm run up -- --status  # only print the table
```

`npm run up` starts Scene Loom, Mesh Foundry (`npm start`, port 4323) and Scene Rehearsal (`npm start`, port 4331) from their sibling checkouts (`../mesh-foundry`, `../scene-rehearsal`; override with `MESH_FOUNDRY_CHECKOUT` and `SCENE_REHEARSAL_CHECKOUT`). A service that is already running for its data directory is left alone, and nothing is ever stopped. Each checkout must be installed and built first; the script says so if not. Service output goes to `$TMPDIR/scene-loom-up/`. The table shows each service's URL, pid, data directory and code revision. A running service is marked `stale` when its reported revision differs from its checkout's current git revision (`+uncommitted` means a dirty working tree). Mesh Foundry does not report a revision, so it can never be marked stale. Scene Loom and Scene Rehearsal report one through `runtime.json` or `npm start -- --status`. The usual overrides (`SCENE_LOOM_DATA_DIR`, `MESH_FOUNDRY_DATA_DIR`, `SCENE_REHEARSAL_DATA_DIR` and the matching `*_PORT` variables) apply to the status read and to every service it starts.

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

Use **Copy new project starter prompt** in the project menu, or the empty-studio starting prompt. Paste it into your agent and fill in your rough idea; the other fields are optional. The agent develops the concept, asks a few questions, presents a Project Vision and full connected text storyboard for approval, then publishes them together. Games and projects with core 3D work also approve a visualization for Project Vision. **Project Vision** opens the saved brief and a prompt to define or refine it. Edit and Continue can take your direction or use agent judgment when left blank. Research and image generation require capabilities in your external agent; naming web checks are preliminary, not legal clearance. See [the enhancement scope](docs/project-vision-scope.md).

### Agent and harness compatibility

Scene Loom uses a local CLI and versioned JSON schemas, not a particular AI provider. Use any agent harness that can execute the CLI on the machine running the studio (with the same data directory). A remote agent needs an explicitly configured way to execute locally; copying a prompt alone does not provide machine access. Browsing and image generation are optional external capabilities: agents can publish text-only scenes and attach imported images later. Plain-text questions work without harness-specific interactive controls.

### Optional Mesh Foundry handoff

Turn on **Mesh Foundry handoff** in the active storyboard's project menu to use **Copy asset suggestion prompt** in Project Vision. The agent saves suggestions linked to scenes. Those scenes offer **Copy asset-generation prompt** for approved reuse or concept generation in the project's shared Mesh Foundry library. Results are pinned to the active storyboard version.
