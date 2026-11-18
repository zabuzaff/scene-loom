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

| Operation             | Fields                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene.create`        | `scene`; optional `placement: { "nearSceneId": "existing_scene" }`                                                                                                                                       |
| `scene.patch`         | `id`, `changes` containing only intended scene fields (excluding ID)                                                                                                                                     |
| `scene.status.record` | `id`, `report` with `foundry`, `rehearsal`, `implementation`, `next` summaries; must be the only operation in its batch. Shown under "Where you left off"; does not change workflow state or reopen work |
| `scene.delete`        | `id`                                                                                                                                                                                                     |
| `connection.create`   | `connection: { "id", "sourceSceneId", "targetSceneId", "label"? }`                                                                                                                                       |
| `connection.patch`    | `id`, `changes` containing only intended connection fields (excluding ID)                                                                                                                                |
| `connection.delete`   | `id`                                                                                                                                                                                                     |

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

The project menu copies repository prompts that use the active Scene Loom project's stable ID and the current CLI configuration. Paste one into an agent session in the software repository or add the target path to the prompt. Scene Loom does not store a repository association.

**Copy plan development prompt** asks an agent to read the storyboard, Project Vision, and target repository, research current technical and design options, and select a stack and coherent development slices. It writes or updates planning Markdown in that repository, maps its ordered slices in Scene Loom, and reports the paths. The plan records confirmed requirements, existing behavior, assumptions, open decisions, sources, and acceptance checks. The planning run ends before implementation.

**Copy review development plan prompt** asks a fresh agent to check the current plan against the storyboard, implementation, and cited sources. It gives a Ready or Needs revision verdict with findings and a SHA-256 fingerprint of each plan file reviewed. Send material findings back to the planning agent and review the revised files. For a mapped plan, save the independent verdict on the exact mapping. For a legacy plan with no map, pass the Ready result and plan paths to the implementation agent or map the plan to enable card actions.

**Copy start development prompt** in the project menu is available for an unmapped storyboard. It requires a Ready verdict and matching paths and SHA-256 fingerprints for the current Markdown, then implement the reviewed scope. A missing plan, missing review, or unresolved material finding stops the run before coding. The agent documents routine technical adjustments and sends material changes back through planning and review. It builds through the normal startup path, verifies the effective local datastore before writing data, and provides startup and sign-in instructions. Frontend work uses the planned accessible component library, shared layouts, and route transitions where applicable. The agent verifies the primary flow in a running browser, including relevant viewports and keyboard use, and reports observed results or blockers. The project menu keeps planning and review available once the board has scenes. On mapped boards, start and continue are on the cards.

**Copy resync with repository prompt** asks the agent to inspect the code and update the storyboard with verified behavior. Planned scenes remain visible. Resync reviews hierarchical title prefixes across the board, preserving numbers that still fit and using labeled connections for cross-branch relationships. Resync writes or updates a Repository verification block in the notes of each verified scene, even when the scene already matches. It records the repository revision, relevant working-tree changes, evidence, verified scope, and main image asset ID when present. Development uses current verification or explicit creator direction to identify baseline scenes. A representative screenshot fills an empty main image or replaces an outdated or speculative one. The batch publishes the new image reference and verification notes together. When capture is unavailable, resync preserves the existing image state and marks outdated or speculative imagery as unverified. The agent submits evidence-backed patches through the CLI with a dry run and the content revision it actually reviewed. If that revision advances, the agent rereads the storyboard and recomputes the affected changes before retrying. Resync is also available on an empty board so it can document an existing implementation.

### Development slice writeback

Keep the Markdown in the target software repository. Include the owning project and storyboard IDs, stable slice IDs and names, exact mapped scene IDs, prerequisite slice IDs, order, and observable acceptance checks. Reuse a slice ID only for the same intended scope. The Scene Loom model stores shared slices once, at the storyboard level. Named copies start without a development map because a source storyboard's independent review does not cover another target.

Read the exact target with `project read STORYBOARD_ID`. Use `schema batch` for operation shapes. Every development operation goes in its own batch with the target as `projectId`, the observed `expectedContentRevision`, and a unique `requestId`. Dry-run and apply via the existing CLI. Development changes advance the content revision without moving cards or invalidating rehearsal inputs.

| Operation                 | Writeback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `development.plan.set`    | Save `plan.files` (repository-relative `path` and SHA-256 `sha256` of each exact file) and ordered `plan.slices` (`id`, `name`, `sceneIds`, `dependencies`). Prerequisites must exist and cannot form a cycle. Update the map before deleting a referenced scene; an empty slice list withdraws the map’s active scope while preserving its history. Do not resubmit an unchanged map.                                                                                                                                                                                                   |
| `development.plan.review` | Record the observed `planRevision` and `review: { verdict, evidence }`. Independently inspect the exact files, fingerprints, scene links, order, and acceptance checks. Use `ready` only when clear of material findings; otherwise use `needs-revision`. If the files or map differ, have the planning agent save the revised mapping first.                                                                                                                                                                                                                                            |
| `development.start`       | Before editing, verify the exact reviewed file digests on disk and select the card’s default slice or another eligible slice in its expanded details. Send `planRevision`, `sceneId`, `sliceId`, a new `claimId`, and `afterClaimId` (the current slice's latest start/checkpoint claim, or null for an untouched slice on this plan). An existing open claim requires `replacesClaimId` with its exact ID; confirm the previous agent has stopped before taking over. Reread after a successful start to verify the claim is still current, especially after replaying a lost response. |
| `development.checkpoint`  | Use the same `planRevision`, `sliceId`, and `claimId`. Save `checkpoint: { status, changed, remaining, resume, evidence }`; include a `blocker` for `blocked`. Use `in-development` when pausing, `needs-verification` when checks remain, and `verified` only with concrete observed evidence. A checkpoint closes the claim, so continuation acquires a new one.                                                                                                                                                                                                                       |

Cards prefer an active or unfinished ready slice and otherwise start ready slices in plan order. A prerequisite must be Verified under the current review. Changing the map or a shared file digest creates a fresh mapping and clears its Ready review and current claims, conservatively requiring re-review and re-verification of the slices covered by the shared plan. Earlier plan metadata and checkpoints remain available in `development.priorPlans` and `development.records`. The service validates stored evidence and claim identity; the agent must compare files on disk. Stop when a digest changes even if Scene Loom has not yet received a revised map.

On conflict, reread. An unrelated content edit may allow a fresh batch after reconciling the same claim and plan. A replaced claim or plan must never receive old results. If a response was lost, replay the original batch with its original request ID, then check current state before acting.

## Scene orchestration and placeholder rehearsal

Start with the exact storyboard target and scene IDs. Read the project and scene before acting. Ensure Mesh Foundry handoff is enabled. Use `scene accepted-assets STORYBOARD_ID SCENE_ID` to preview verified live acceptance in the linked library. Existing selections use the legacy brief's `use`, `optional`, and `missing` entries until an owner-confirmed `selectedAssets` list is saved through `scene.patch`. Entries in `selectedAssets` have a name, a required flag, and an optional exact Foundry source. Save an explicit empty list for a scene with no selected assets. A missing required entry blocks planning. Valid GLB prototype and developed model pins are checked at their own Foundry stages. When a saved pin goes stale, resolve its replacement with the owner before changing the selection.

Use one `rehearsal.record` operation with `kind: orchestration`, a unique event ID, and a nested `record.stage`. The batch uses the current content revision and the exact preceding event ID. Dry-run first. On conflict, read back both services and reconcile before retrying.

The workflow has one draft per scene. The owner agrees to a plan in chat and accepts the draft in Scene Rehearsal. Loom stores only links.

| Stage   | Contract                                                                                                                                                                                                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`  | Save the exact accepted-assets preview, including gaps. Existing pins are preserved. A repeat with identical current inputs leaves the active workflow intact.                                                                                                                                                                                                       |
| `plan`  | Cite the current sync ID. Record planner identity, scene intent, stable pieces and groups, exact Foundry IDs, transforms in meters with Y-up and XYZ radians, behavior, camera or traversal, references and concrete checks. For a scene the game already implements, base the plan on what exists. A new plan replaces the previous plan and clears the draft link. |
| `draft` | Record the live Rehearsal draft for this exact scene: `builder`, the Rehearsal `url`, `draftId` (its stable digest) and a `scenarioId`. The service reads Rehearsal (found through its `runtime.json`) and checks that the draft's storyboard and scene IDs match. Later corrections overwrite the same Rehearsal draft and need no new record.                      |

`decision`, `publication` and `draft-review` are retired. Existing records stay readable as history and new ones are rejected with `LEGACY_STAGE`. Their old digests remain valid historical Rehearsal URLs.

Card actions follow `next`: `sync`, `plan`, `publish` (draft prompt), then `handoff` (**Copy start implementation prompt**). The handoff prompt has the implementer read the draft from Rehearsal, stop unless it carries the owner's final approval, implement or continue the scene, and mark the card implemented once the code roughly matches its scope. Use the development checkpoint flow when a development map exists and `scene.status.record` otherwise. A light check is enough and the agent states what it did not check.

For an owner-authorized legacy transition, use `legacyReset: true` on the first sync for that scene in a single-operation batch. Preview the exact target, prior event, active legacy draft and accepted models first. This append-only transition retires active legacy requirements and pending actions. It retains the brief, legacy events and the old Rehearsal revision. The transition writes atomically without making or pruning snapshots. Every other scene, storyboard and external service is outside the transition.

The game handoff reads the plan and the accepted Rehearsal draft with its references, accepted Foundry IDs and pending runtime checks. Use game implementation for model placement, collision, selection and final animation.

**Copy in-game scene review prompt** is available alongside the start implementation prompt once a draft exists. Once a game build is available, paste it into a fresh reviewer chat in the game workspace and append the prototype name for the scale reference. The reviewer measures the loaded reference after game transforms and returns a verdict, numbered annotated and original screenshots, measured findings and a paste-ready correction prompt in chat. Placement fixes go to the game builder. Geometry findings can supply instructions for a targeted Foundry revision.

## Legacy rehearsal compatibility

Earlier brief, review, candidate and fit records remain readable. The legacy writeback contract below applies to targets that have yet to transition. Current scene cards use the orchestration workflow above.

Save the draft via `scene.patch` with `changes.rehearsalBrief`. The fields are `layout`, `scenarios`, `assets`, and `gaps`. Each asset has `name`, `decision` (`use`, `optional`, `leave out`, or `missing`), `rationale`, and `behavior`. An optional `source` records `libraryId`, `assetId`, and `revisionId` for the inspected model. Use `schema batch` for the full contract. Omitting the field preserves the draft, and setting it to null clears it. A saved brief is review material. Its asset references are proposals and carry no external approval.

A named storyboard copy inherits its scenes' draft briefs as planning content. Recheck the layout and source revisions against the copied storyboard before reusing them.

Include `basis: { storyboardId, contentRevision }` using the target and revision read before writing. Submit the brief in its own batch. A draft with no basis, a different target, or a later storyboard content revision is marked for re-review. Layout-only changes do not affect this notice. If the Foundry lookup has no linked library, verify an owner-identified legacy library or ask for the intended library before saving asset decisions.

## Reviewed rehearsal and asset fit

Each handoff is scoped to the exact **storyboard target ID and scene ID**. Start with `project read STORYBOARD_ID` and `scene read STORYBOARD_ID SCENE_ID`. Read the scene's `rehearsalBrief` and ordered `rehearsalEvents`; an absent log is empty. Never use a similarly named scene or another storyboard's state. A storyboard copy inherits its brief, but starts with no rehearsal, review, or fit evidence.

Use `schema batch` for the event shapes. Submit workflow-only `rehearsal.record` operations with `id` (scene ID), `afterEventId` (last event observed, or null), and `event` (including a unique `eventId`). Use the enclosing batch's exact `projectId`, current `expectedContentRevision`, and unique `requestId`. Dry-run and apply through the CLI. The service validates events in order and publishes atomically. On conflict, reread both systems and repeat affected inspections; never relabel old evidence with new IDs or advance the predecessor just to make a stale write pass.

| Event              | Writeback and prerequisites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review`           | Independent review of the saved brief and current inputs. Use the observed `rehearsalInputRevision` (fall back to `contentRevision` when absent), separate blockout and model import verdicts, scope, and prioritized findings with corrections. A blocked blockout returns to prep.                                                                                                                                                                                                                                                                                                                                                                                 |
| `draft`            | Exact current cleared review event ID; prior recorded head revision or null; canonical absolute Rehearsal `dataDir`, resolved loopback `port`, published revision digest and link. Include measured asset requirements here. Each needs a fresh requirement ID, name, exact Foundry library/asset/source revision, scene proxy or object IDs, numeric measurements with units, requested changes, preservation list, and playback checks. The draft revision identifies the measurement basis. A new requirement for the same Foundry library and asset supersedes the older requirement; omitted requirements remain active unless named in `retireRequirementIds`. |
| `candidate`        | Active requirement ID, `basedOn` tuple for its source or latest candidate, and the exact Foundry model tuple. Use `adoptExisting: true` when adopting an already published model. A new candidate clears the current acceptance and fit, with prior evidence retained.                                                                                                                                                                                                                                                                                                                                                                                               |
| `candidate-review` | Exact active candidate tuple and requirement ID with evidence. Use `accepted` only after verifying Foundry's owner acceptance of that exact eligible model revision and its match to the requirements. Use `needs-revision` for a reviewed model that needs corrections. Record a cleared review without verified acceptance as described below.                                                                                                                                                                                                                                                                                                                     |
| `fit`              | Exact accepted model tuple, requirement ID, and current rehearsal revision. If this run publishes an assembled child, include its exact library, revision and link in `assembled`; evidence then covers that child, and this write advances the saved head. Otherwise evidence covers the supplied head. Record observed playback and measurements as `pass`, `model-defect`, or `rehearsal-issue`.                                                                                                                                                                                                                                                                  |

For a cleared review that does not yet verify owner acceptance, record a new `candidate` event reasserting the exact existing model in both `model` and `basedOn`, with `clearedReview: { ownerAcceptance, evidence }`. Use `pending` when Foundry confirms the owner has yet to accept, and `unverified` when acceptance could not be confirmed. This leaves the existing Foundry integration on the same candidate and never enables a fit write. After the owner uses **Acceptance → Accept this revision** in Foundry, use **Copy Foundry acceptance verification prompt** to confirm the exact revision and publish `candidate-review` with `accepted`.

When the owner explicitly accepts a candidate’s documented defect, append a new `candidate-review` with `verdict: "accepted"`, the same requirement and model tuple, and `ownerOverride: { rejectionEventId, reason }`. Cite the active rejection and record the owner’s reason and any outstanding rehearsal checks. Scene Loom verifies current acceptance of the exact non-fixture model through Mesh Foundry’s local service before saving. It reads the default Foundry datastore, or the absolute `MESH_FOUNDRY_DATA_DIR` configured on the Scene Loom service. If verification fails or Foundry is unavailable, the batch fails. The rejection stays in history and fit requires its own evidence.

Store `sourceLink` on a requirement and `modelLink` on a candidate only when a verified HTTP(S) link opens the exact revision. If Foundry cannot provide one, Scene Loom shows the saved revision and library/asset IDs. Mark optional measured requirements with `optional: true`; older records inherit an explicit optional brief decision when matched. Required brief assets without measured requirements remain unverified. For a current `rehearsal-issue` outside the authoring contract, include `capabilityBlocker` with the missing capability and reproduction. The card points to the affected rehearsal instead of offering a placement correction.

Storyboard content edits and recovery invalidate independent review; workflow writes and canvas layout changes do not. After a new review, record the advanced rehearsal or revalidate and re-record its existing head under that review before recording asset results. A new rehearsal head makes older fit evidence outdated, even for an unchanged model. Keep the history; recheck the current assembled rehearsal. Model defects route to Foundry at the exact defective model revision. Placement, camera, and playback problems route to Rehearsal. A fit pass never confers model acceptance, and Foundry acceptance never establishes in-scene fit.

Scene Loom owns the scene brief, fit requirements and handoff status. Foundry owns source and candidate publication, model eligibility and owner acceptance. Resolve Foundry through its supported Scene Loom lookup or an owner-confirmed library mapping; then read the exact library, asset and revision through its supported service or CLI. Scene Rehearsal owns draft playback, revision publication and measured fit evidence. Resolve it via the saved library and head, or verify a dedicated empty library for the initial publication; verify the exact scene provenance and parent under Rehearsal's contract. Use each app's supported writes and revision checks. Scene Loom checks its recorded identities and predecessors. Owner override writes also verify Foundry acceptance live. Check the external heads and exact model eligibility immediately before publishing and before recording evidence. If an external write succeeded but Scene Loom writeback failed, reconcile from the actual published revision and its parent rather than publishing another revision blindly.

Legacy v1/v2 Rehearsal drafts share a top-level head per datastore. The v3 contract above also has a separate head per approved plan tuple. Set `SCENE_REHEARSAL_DATA_DIR` and `SCENE_REHEARSAL_PORT` from the saved reference, confirm with `npm start -- --status`, and use `npm run cli -- list` and `read DIGEST` to verify its head and ancestry. The initial scene association is recorded in Loom; use a dedicated empty datastore unless the owner confirms an unambiguous existing mapping. Rehearsal `publish FILE` takes `{request, parent, scene, links}`, where `parent` is its actual head; Loom's `parentRevisionId` is the previously recorded head. For model binding, export the exact private Foundry bundle and use Rehearsal's `import-model REQUEST` with the expected project, asset, revision, hash and ordered clips. Use the returned `sourceKey` in the assembly. Verify live model-stage eligibility before fit; a later owner acceptance can supersede an earlier revision. If a correction is outside the Rehearsal authoring contract, save its reproduction as a rehearsal issue and leave fit unverified.

### Foundry lookup and writeback

The copied request supplies the owning project ID, storyboard target ID, scene ID and requirement ID. Run these commands from the indicated checkouts with the data directories for the active services.

```sh
# Scene Loom
npm --silent run cli -- project read STORYBOARD_ID
npm --silent run cli -- scene read STORYBOARD_ID SCENE_ID
npm --silent run cli -- schema batch

# Mesh Foundry
npm --silent run cli -- scene-loom SOURCE_PROJECT_ID STORYBOARD_ID
```

Use the Scene Loom reads to confirm the owning project and that `meshFoundryEnabled` is true. Find the requirement in the scene's `draft` events. Its enclosing `draft.revisionId` identifies the rehearsal that supplied the measurements. The requirement is active until a later draft retires its ID or replaces it with a fresh requirement for the same Foundry library and asset. Check that the latest independent review clears blockout, that its `inputRevision` matches the storyboard's rehearsal input revision, and that the latest draft references that review. Use the Foundry lookup to resolve the library. Verify the saved library, asset and revision through Foundry before editing. For a correction, start from the latest candidate for the active requirement and read the saved findings for that exact revision.

Publish the candidate through Foundry first. In Scene Loom, record the published identity using this example batch. Substitute the actual target, scene, requirement, revision, predecessor and request IDs. `basedOn` is the saved source for the first candidate and the latest recorded candidate for a correction.

```json
{
  "schemaVersion": 1,
  "projectId": "storyboard_office",
  "requestId": "record_sign_candidate_2",
  "expectedContentRevision": 12,
  "operations": [
    {
      "type": "rehearsal.record",
      "id": "lobby",
      "afterEventId": "sign_candidate_1_review",
      "event": {
        "kind": "candidate",
        "eventId": "sign_candidate_2",
        "requirementId": "sign_fit",
        "basedOn": {
          "libraryId": "office",
          "assetId": "sign",
          "revisionId": "model_1"
        },
        "model": {
          "libraryId": "office",
          "assetId": "sign",
          "revisionId": "model_2"
        }
      }
    }
  ]
}
```

```sh
npm --silent run cli -- project apply STORYBOARD_ID /absolute/batch.json --dry-run
npm --silent run cli -- project apply STORYBOARD_ID /absolute/batch.json
```

Record candidate review findings in a separate batch with the same operation envelope, a fresh request and event ID, and the observed revision and predecessor for that review. Use this event shape. Include observed measurements, the affected requirement, and the correction to make where applicable.

```json
{
  "kind": "candidate-review",
  "eventId": "sign_candidate_2_review",
  "requirementId": "sign_fit",
  "model": {
    "libraryId": "office",
    "assetId": "sign",
    "revisionId": "model_2"
  },
  "verdict": "needs-revision",
  "evidence": [
    "The housing measures 1.28 m against the 1.20 m limit. Narrow the housing while preserving the lettering."
  ]
}
```

Use `accepted` only when the exact model meets the saved requirements and Foundry confirms current model-stage owner acceptance. If the candidate meets the requirements and owner acceptance is pending, wait to record acceptance until Foundry confirms it. A cleared review with pending or unverified acceptance can be recorded with the compatible candidate event described above.

Keep the observed predecessor and identities from the start of the work. Scene Loom returns `CONTENT_CONFLICT` if its content revision advanced and `STALE_REHEARSAL` if the scene predecessor or recorded workflow prerequisites no longer match. Even with a fresh envelope, it rejects results against a retired or replaced requirement, an outdated candidate base, or a review of a superseded model. Reread both apps and repeat the affected checks. If Foundry already published a candidate, verify its identity and provenance before retrying the Scene Loom writeback. Retry an identical batch with its original request ID when the response was lost.

When Foundry supersedes a recorded acceptance, use the fit prompt's recovery instructions or copy the existing-model review prompt. To adopt a verified model already published in Foundry, record `candidate` with `adoptExisting: true`, the active requirement ID, the current `basedOn` tuple, and the exact existing `model` tuple. This can carry an earlier candidate into a replacement requirement, including when the revision is that requirement's source. The service rejects re-adopting a revision already recorded for the same requirement. Record fresh candidate review evidence, verify live owner acceptance, and run a fresh fit check. The earlier review and fit remain in the history.

Development mappings bind to `plan.repository`, the canonical absolute Git common directory. Resolve symlinks on the path from `git rev-parse --path-format=absolute --git-common-dir`. Linked worktrees share this identity. Review and start require a mapping with this field. Older maps remain readable and require remapping and review before new claims. An active claim blocks plan replacement until its owner checkpoints the work. An interrupted claim can use the existing explicit takeover flow on a repository-bound plan.
