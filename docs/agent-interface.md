# Agent interface

Scene Loom is fed by external agents through any harness that can run its local CLI. No Codex-specific API, plugin, or chat session is required. Use the CLI and versioned JSON schemas; do not edit project files directly. Image generation happens externally with whatever tools the agent has available.

## Connect and discover

Start the service as described in [README](../README.md). Run from this repository, or use the complete command copied from a scene card. For machine-readable output, keep npm's `--silent` flag:

```sh
npm --silent run cli -- --help
npm --silent run cli -- schema batch
npm --silent run cli -- schema project
npm --silent run cli -- project list
```

Schemas are available for `batch`, `project`, `layout`, `createProject`, `createStoryboard`, `importAsset`, `restore`, and `viewport`. `schema` and help work without the service. Other commands read `runtime.json` from the active data directory. Set the same absolute `SCENE_LOOM_DATA_DIR` used by the service; no explicit token or port is needed in a prompt.

Project listing returns a summary per project with `status: "ready"` for readable projects, including `sceneCount` and `updatedAt`. Damaged or missing project files return `status: "unreadable"` with the project folder ID and a structured `error`; they do not block other projects. Use the listed ID with backup/recovery commands. The studio marks unreadable entries as needing recovery and selects only readable projects.

All results use `{ "success": true, "data": ... }`. Errors use `{ "success": false, "error": { "code", "message", "location"?, "suggestion" } }` and a nonzero exit status. Transport/input failures use `CLI_ERROR`. Write creative text into JSON files or stdin, not interpolated shell arguments. Every mutation takes a JSON file path or `-` for stdin.

## Create and target a named storyboard

An existing project ID also addresses its Baseline storyboard. `project list` groups named copies under the owning project's optional `storyboards` array, with each copy's ID, name, and readiness. The CLI commands that take a project ID also accept a storyboard target ID. For batches, use that same target ID in the `projectId` field and read the target's current revision before publishing.

```sh
npm --silent run cli -- storyboard create SOURCE_TARGET_ID /absolute/storyboard-input.json
npm --silent run cli -- project read STORYBOARD_TARGET_ID
npm --silent run cli -- scene read STORYBOARD_TARGET_ID SCENE_ID
```

Use `{"name":"3D Research Office"}` as the creation input. Names are unique within the software project, including the reserved Baseline name. The result includes the new target ID and `storyboard` metadata identifying the owning project, source target, and source content revision at copy time. A copy starts with its own revision counters, backups, and viewport. It inherits scenes, connections, card positions, vision, settings, and owned images. Later changes are independent. Shared scene IDs can exist on multiple storyboards, so use the exact target from the prompt for every read and write. Resolve owned image paths under `SCENE_LOOM_DATA_DIR/projects/STORYBOARD_TARGET_ID/`.

## Create a project and import images

```sh
npm --silent run cli -- project create /absolute/project-input.json
npm --silent run cli -- project read PROJECT_ID
npm --silent run cli -- asset import PROJECT_ID /absolute/asset-input.json
```

Project input: `{ "id": "my_game", "title": "My game" }`. ID is optional on creation; keep the returned ID.

Asset input: `{ "path": "/absolute/local/image.png", "kind": "project-image" }`. Use `project-image` for verified screenshots and actual project assets. Use `visualization` for creative visualizations. New scene attachments require `project-image`, and new Project Vision image references require `visualization`. Imports without a kind remain unclassified until reimported with an explicit kind. Existing attachments can stay in place. The service enforces the declared kind, which callers must supply accurately. Use static PNG, JPEG, WebP, or AVIF, at most 30 MB and 40 million pixels. The service decodes the image, owns its copies, generates a thumbnail, and returns an asset ID. SVG and animated images are rejected. Reimporting the same bytes returns the existing ID and repairs missing derived files. Once classified, an image cannot be reimported with a conflicting kind in the same storyboard. Main and supporting images are optional. Every referenced image must be imported.

Import all needed images before reading the revision and preparing a batch. Import updates the asset manifest but does not advance the storyboard content revision. Exact supplied bytes are retained as `.source`; normalized display copies are WebP. The viewer's full-image link opens the full-resolution display copy.

## Publish an atomic scene batch

```sh
npm --silent run cli -- project apply PROJECT_ID /absolute/batch.json --dry-run
npm --silent run cli -- project apply PROJECT_ID /absolute/batch.json
```

Replace `asset_imported` below with the returned image ID. Read the project first to get `contentRevision` and existing IDs.

```json
{
  "schemaVersion": 1,
  "projectId": "my_game",
  "requestId": "create_arrival_001",
  "expectedContentRevision": 0,
  "operations": [
    {
      "type": "scene.create",
      "scene": {
        "id": "arrival",
        "title": "Arrival",
        "description": "The player reaches a silent station.",
        "notes": "Let the player explore before the next beat.",
        "mainAssetId": "asset_imported",
        "supportingAssetIds": []
      }
    }
  ]
}
```

Supported operations:

| Operation           | Fields                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `scene.create`      | `scene`; optional `placement: { "nearSceneId": "existing_scene" }`        |
| `scene.patch`       | `id`, `changes` containing only intended scene fields (excluding ID)      |
| `scene.delete`      | `id`                                                                      |
| `connection.create` | `connection: { "id", "sourceSceneId", "targetSceneId", "label"? }`        |
| `connection.patch`  | `id`, `changes` containing only intended connection fields (excluding ID) |
| `connection.delete` | `id`                                                                      |

Scene creation requires the fields shown above except `mainAssetId`, which may be omitted or set to `null` for a text-only scene. Pass an empty `supportingAssetIds` array when there are no supporting images. In a patch, omission preserves the existing image, an imported ID attaches or replaces it, and `null` clears it. IDs accept letters, numbers, hyphens, underscores, begin with a letter/number, and are at most 96 characters. A batch accepts up to 1000 operations within a 4 MB request body. Unknown input fields are rejected.

Connections may branch, join, loop, or point back to the same scene. Endpoints must exist in the final graph, including scenes created in this batch. Deleting a scene requires explicit deletion of its incident connections in the same batch. A dry-run validates without saving scenes, backups, or request receipts.

The service validates the complete resulting model, assets, and graph, then publishes atomically. The result contains `projectId`, `contentRevision`, `affectedIds`, and `warnings`. New cards are placed in unoccupied nearby positions; existing positions are unchanged. Prefer referencing an earlier/existing scene for placement.

Use a unique `requestId` per intended mutation. The most recent **100 successful request IDs per project** are persisted. Replaying identical input within that window returns its original result; reusing the ID with different input is an error. On a conflict, reread current state and prepare a new request with a new ID. Never blindly overwrite or repeatedly replay an ID outside the deduplication window.

```sh
npm --silent run cli -- scene read PROJECT_ID SCENE_ID
```

## Explicit layout changes

Users arrange cards in the studio. Only change positions if asked:

```sh
npm --silent run cli -- layout patch PROJECT_ID /absolute/layout.json
```

```json
{
  "expectedLayoutRevision": 0,
  "positions": { "arrival": { "x": 0, "y": 0 } }
}
```

Read `layoutRevision` first and submit only intended positions. Use optional `expectedContentRevision` when the positions depend on the scene graph you reviewed. The service rejects stale content revisions before writing. Content and layout revisions are independent; stale layout patches fail. Viewport is saved separately by the viewer. Copied Continue/Edit prompts preserve unrelated content and positions and include the guide path and data-root-aware CLI invocation. No prompt is sent automatically.

## Backups and recovery

```sh
npm --silent run cli -- backup list PROJECT_ID
npm --silent run cli -- backup restore PROJECT_ID /absolute/restore.json
```

Normal restore input:

```json
{
  "backupId": "RETURNED_BACKUP_FILENAME.json",
  "expectedContentRevision": 3,
  "expectedLayoutRevision": 1
}
```

A content update snapshots the prior project; keep the latest 20 snapshots. Restoration snapshots the current state and advances both revisions. Imported assets are retained, including those needed by backups. There is no automatic asset garbage collection in v1. Recovery is not a visible alternate-idea workflow.

If `project.json` is corrupt, backup listing still works. Explicit corrupt-state restore input:

```json
{
  "backupId": "RETURNED_BACKUP_FILENAME.json",
  "recoverCorrupt": true
}
```

This mode works only when current JSON/schema is unreadable, validates the selected backup, preserves damaged bytes in `recovery/`, and assigns fresh revisions that invalidate stale clients. It cannot bypass revision checks on a healthy project. Inspect the selected backup and owner intent before an intentional rollback; never silently undo creative work.

For an executable branching example, run `npm run demo -- IMAGE1 IMAGE2 IMAGE3 IMAGE4` with four absolute local image paths while the service runs. It uses this CLI to create an explicitly labeled example project.

## Project Vision and creative starter

Scene Loom supports software projects beyond games: websites, web systems, mobile/desktop apps, and developer tools. Scenes represent screens, workflow steps, interactions, or gameplay moments. The studio's New project action copies a starter template with a required rough idea and optional name, type, audience, experience, visual direction, must-haves, boundaries, and starting point. Research and generation happen in the external agent, not the studio.

Discover the complete vision schema with `schema project` or `schema batch`. Existing version-1 projects and backups may omit `vision`; no migration or compulsory setup is needed. New optional fields remain strictly validated. A batch operation replaces the complete vision and synchronizes the project title to its name:

```json
{
  "type": "project.vision.set",
  "vision": {
    "name": "Working project name",
    "nameMeaning": "Why this name fits",
    "nameStatus": "provisional",
    "originalIdea": "The creator's original words",
    "summary": "A concise developed concept",
    "purpose": "What it achieves",
    "audience": "Who uses it",
    "projectType": "Web system",
    "platforms": "Desktop and mobile browsers",
    "coreExperience": "The main user journey or loop",
    "essentialFeatures": "Essential scope",
    "exclusions": "What it will not include",
    "creativePillars": "Principles guiding creative choices",
    "visualDirection": "Aesthetic and tone",
    "constraints": "Relevant limits",
    "confirmedDecisions": "Creator-confirmed requirements",
    "assumptions": "Unconfirmed agent choices",
    "openQuestions": "Remaining questions",
    "references": [],
    "namingCheck": {
      "notes": "Unchecked working name; no availability claim"
    }
  }
}
```

All fields shown are required. The optional `visualizationAssetId` references a decoded image imported into the same storyboard target. It appears in Project Vision and cannot be used as a scene attachment in that storyboard. Text fields accept up to 50,000 characters except `name` and `projectType` (200); references accept up to 50 HTTP(S) URLs with relevance notes (2,000 characters). `namingCheck.checkedAt` is an optional ISO date (`YYYY-MM-DD`). Use `nameStatus: "confirmed"` for a creator-confirmed name; delegated agent choices may remain `provisional`. References store naming research links as well as design inspiration, with relevance notes identifying their purpose. The existing 4 MB batch limit applies.

Use the normal `project apply` command with a unique request ID and current content revision. Dry runs, deduplication, conflicts, atomicity, notifications, and recovery snapshots work exactly as for scenes. Vision-only mutations return no scene IDs in `affectedIds`. They preserve layout and viewport. Vision and scenes can also be published in one atomic batch after importing images.

For discovery, ask a few consequential questions with concrete suggested answers, a recommendation, and free-text/delegate options. Preserve original intent and distinguish confirmed decisions from assumptions. If no name is supplied, develop meaningful expressive options and screen the web for obvious exact/near-name collisions with established related products when browsing is available. Record links, date, and limits; never claim legal availability from web searching.

The starter publishes a written vision and full connected text storyboard after explicit approval. Games and projects with core 3D work also review and approve a visualization. The starter defaults to three image options per round for those projects. Import only the chosen image and publish its reference in the same content batch. Existing-project vision adoption preserves existing scenes.

Edit/Continue prompts read current vision and content. Blank direction delegates creative judgment: improve the selected scene deliberately or add one useful connected next scene, respectively. Respect confirmed foundations and exclusions, preserve unrelated content/positions, and reuse images for appropriate text-only changes. Refine vision updates only the brief unless scene changes are explicitly requested; explain possible scene mismatches in the external conversation.

## Mesh Foundry handoff

Enable **Mesh Foundry handoff** on the exact storyboard target. The Project Vision panel copies the suggestion prompt. It reads the full storyboard, written vision, and approved visualization when present. The agent uses the read-only Mesh Foundry lookup to propose reuse and saves draft suggestions through `asset-suggestion.upsert`. Each suggestion has an `id`, `name`, `description`, `explanation`, and one or more distinct existing `sceneIds`. Read them in `project read STORYBOARD_ID` under `assetSuggestions`. One draft can link multiple scenes.

Scenes with linked suggestions offer **Copy asset-generation prompt**, including text-only scenes. The agent confirms the intended work, then uses Mesh Foundry's scoped batch to pin an existing revision or publish and pin a 2D concept. Mesh Foundry owns one library per source project and pins per exact storyboard and suggestion. The agent writes back the result through `asset-suggestion.result.set` with `id` and `result` containing `libraryId`, `assetId`, `revisionId`, and `libraryVersion` from the same Foundry lookup as the pin. Older or conflicting results are rejected. Use `asset-suggestion.retire` with the draft ID to remove it from the active workflow while keeping its recorded history. Reconcile an ambiguous writeback from the stored Foundry pin. Identical result-only batches leave the revision unchanged.

Both mutations require the exact target's live toggle and a current content revision. Use the ordinary atomic batch and dry run. Copying a storyboard carries over draft suggestions and drops result pins for the new target. Deleting scenes removes their links and removes suggestions left without scenes. Existing projects can omit suggestions. Both prompts verify the live toggle and exact project and storyboard IDs before doing work.

## Storyboard image fidelity

Starter, First Scene, Edit, and Continue reserve scene image slots for real project imagery. Planned and unverified scenes default to text describing the user goal, action, system response, and relevant states. The approved generated visualization belongs in Project Vision. Resync can attach verified screenshots to the same scene later.

## Development and repository resync

The project menu copies two prompts that use the active Scene Loom project's stable ID and the current CLI configuration. Paste one into an agent session in the software repository or add the target path to the prompt. Scene Loom does not store a repository association.

**Copy plan development prompt** asks an agent to read the storyboard, Project Vision, and target repository, research current technical and design options, and select a stack and a coherent first slice. It writes or updates planning Markdown in that repository and reports the paths. The plan records confirmed requirements, existing behavior, assumptions, open decisions, sources, and acceptance checks. The planning run ends before implementation.

**Copy review development plan prompt** asks a fresh agent to check the current plan against the storyboard, implementation, and cited sources. It gives a Ready or Needs revision verdict with findings and a SHA-256 fingerprint of each plan file reviewed. Send material findings back to the planning agent and review the revised files. Pass the Ready result and plan paths to the implementation agent.

**Copy start development prompt** requires a Ready verdict and matching paths and SHA-256 fingerprints for the current Markdown, then implement the reviewed scope. A missing plan, missing review, or unresolved material finding stops the run before coding. The agent documents routine technical adjustments and sends material changes back through planning and review. It builds through the normal startup path, verifies the effective local datastore before writing data, and provides startup and sign-in instructions. Frontend work uses the planned accessible component library, shared layouts, and route transitions where applicable. The agent verifies the primary flow in a running browser, including relevant viewports and keyboard use, and reports observed results or blockers. The three development actions are available once the board has scenes.

**Copy resync with repository prompt** asks the agent to inspect the code and update the storyboard with verified behavior. Planned scenes remain visible. Resync reviews hierarchical title prefixes across the board, preserving numbers that still fit and using labeled connections for cross-branch relationships. Resync writes or updates a Repository verification block in the notes of each verified scene, even when the scene already matches. It records the repository revision, relevant working-tree changes, evidence, verified scope, and main image asset ID when present. Development uses current verification or explicit creator direction to identify baseline scenes. A representative screenshot fills an empty main image or replaces an outdated or speculative one. The batch publishes the new image reference and verification notes together. When capture is unavailable, resync preserves the existing image state and marks outdated or speculative imagery as unverified. The agent submits evidence-backed patches through the CLI with a dry run and the content revision it actually reviewed. If that revision advances, the agent rereads the storyboard and recomputes the affected changes before retrying. Resync is also available on an empty board so it can document an existing implementation.
