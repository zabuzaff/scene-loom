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

## Design direction

Projects with a new frontend surface can carry an optional project-level `designDirection`, written by the planning agent in its own batch with `project.design-direction.set`. It is content, not approval, and it replaces the previous value. The repository plan prompt asks for it alongside the repository design brief. Fields: `name`, `summary`, `palette` (1-20 strings), `typePairing`, `layoutIdea`, `sources` (`[{url, observedTrait}]`, HTTP or HTTPS), `rejectedAlternatives` (strings) and `chosenAt` (ISO date-time). Older projects omit it and load unchanged. `project read` returns it, so the plan prompt has agents read it from the other Scene Loom projects (`project list`, then `project read`) in addition to sibling `DESIGN.md` files, and keep the new direction distinct. The Project Vision panel shows it read-only.

```json
{
  "type": "project.design-direction.set",
  "designDirection": {
    "name": "Signal Ledger",
    "summary": "Dense ink-on-paper tables with one hot accent.",
    "palette": ["#101418 ink", "#f2efe6 paper", "#ff4f1f accent"],
    "typePairing": "Space Grotesk headings, IBM Plex Mono data",
    "layoutIdea": "Left rail index with a wide ledger column.",
    "sources": [
      { "url": "https://example.com/ledger", "observedTrait": "Hairline rules" }
    ],
    "rejectedAlternatives": ["Glassy dashboard: too close to a sibling."],
    "chosenAt": "2026-11-22T10:00:00.000Z"
  }
}
```

## Mesh Foundry handoff

Enable **Mesh Foundry handoff** on the exact storyboard target. The Project Vision panel copies the suggestion prompt. It reads the full storyboard, written vision, and approved visualization when present. The agent uses the read-only Mesh Foundry lookup to propose reuse and saves draft suggestions through `asset-suggestion.upsert`. Each suggestion has an `id`, `name`, `description`, `explanation`, and one or more distinct existing `sceneIds`. Read them in `project read STORYBOARD_ID` under `assetSuggestions`. One draft can link multiple scenes.

Scenes with linked suggestions offer **Copy asset-generation prompt**, including text-only scenes. The agent confirms the intended work, then uses Mesh Foundry's scoped batch to pin an existing revision or publish and pin a 2D concept. Mesh Foundry owns one library per source project and pins per exact storyboard and suggestion. The agent writes back the result through `asset-suggestion.result.set` with `id` and `result` containing `libraryId`, `assetId`, `revisionId`, and `libraryVersion` from the same Foundry lookup as the pin. Older or conflicting results are rejected. Use `asset-suggestion.retire` with the draft ID to remove it from the active workflow while keeping its recorded history. Reconcile an ambiguous writeback from the stored Foundry pin. Identical result-only batches leave the revision unchanged.

Both mutations require the exact target's live toggle and a current content revision. Use the ordinary atomic batch and dry run. Copying a storyboard carries over draft suggestions and drops result pins for the new target. Deleting scenes removes their links and removes suggestions left without scenes. Existing projects can omit suggestions. Both prompts verify the live toggle and exact project and storyboard IDs before doing work.

## Storyboard image fidelity

Starter, First Scene, Edit, and Continue reserve scene image slots for real project imagery. Planned and unverified scenes default to text describing the user goal, action, system response, and relevant states. The approved generated visualization belongs in Project Vision. Resync can attach verified screenshots to the same scene later.

## Development and repository resync

The project menu copies repository prompts that use the active Scene Loom project's stable ID and the current CLI configuration. Paste one into an agent session in the software repository or add the target path to the prompt. Scene Loom does not store a repository association.

**Copy plan development prompt** asks an agent to read the storyboard, Project Vision, and target repository, research current technical and design options, and select a stack and coherent development slices. It writes or updates planning Markdown in that repository, maps its ordered slices in Scene Loom, and reports the paths. The plan records confirmed requirements, existing behavior, assumptions, open decisions, sources, and acceptance checks. The planning run ends before implementation.

**Design direction in repository prompts.** For new or redesigned surfaces the plan prompt requires three research lanes (same-task products, community-curated design sources such as Reddit, X, Dribbble, Awwwards and trending galleries, and one source from a completely different world), each with a dated link, what it shows and one borrowed trait. Reference pages remain evidence, creator references and brand requirements are honored, and unavailable browsing is stated. The agent writes at least three named candidate directions (palette, type pairing, layout idea), records the choice and why in the repository's design brief, and lists sibling local projects' palettes and fonts (from DESIGN.md files under the repository's parent directory) to choose a clearly distinct direction, avoiding default clusters such as warm cream, serif and terracotta or green. Impeccable's Direction contract must exist in the brief before any UI code; the review prompt flags its absence as a material finding and the start prompt writes it first. The component library stays mandatory for behavior and accessibility, but the plan specifies theme tokens (colour, radius, density, type) overriding library defaults and review checks rendered screens for default-looking components.

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

| Stage         | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`        | Save the exact accepted-assets preview, including gaps. Existing pins are preserved. A repeat with identical current inputs leaves the active workflow intact.                                                                                                                                                                                                                                                                                             |
| `plan`        | Cite the current sync ID. Record planner identity, scene intent, stable pieces and groups, exact Foundry IDs, transforms in meters with Y-up and XYZ radians, behavior, camera or traversal, references and concrete checks. For a scene the game already implements, base the plan on what exists. A new plan replaces the previous plan and clears the draft link.                                                                                       |
| `draft`       | Record the live Rehearsal draft for this exact scene: `builder`, the Rehearsal `url`, `draftId` (its stable digest), a `scenarioId`, and the optional hex `contentDigest` and `specDigest` from the spec export (records without them stay valid). The service reads Rehearsal (found through its `runtime.json`) and checks that the draft's storyboard and scene IDs match. Later corrections overwrite the same Rehearsal draft and need no new record. |
| `game-review` | Record an in-game review of the implemented scene: `draftId` (the current draft), `reviewer`, exact `build` and `route`, `verdict` (`ready` or `changes-requested`), `findings`, and structured `evidence`. A `ready` verdict is rejected without non-empty `propCaptures`, `scaleChecks` and `clipChecks`.                                                                                                                                                |

**Live acceptance.** Foundry decides what is accepted. `scene accepted-assets` and the card read it now, through the same Foundry read the service uses everywhere; a recorded `sync` is a snapshot kept as evidence and may be out of date. `GET /api/projects/ID/scenes/SCENE/workflow` returns `{ live, readAt, entries, recorded, drifted, next, action }`. `entries` are Foundry's current answer when `live` is true. When Foundry cannot be read, `live` is false, `reason` says why, and `entries` are the last recorded state; the card marks it **Not live** and never blocks the owner. If live entries differ from the recorded manifest, `drifted` is true and the next action is `sync`.

**Stale card actions.** An owner-clicked card action calls `POST .../scenes/SCENE/card-action {action}`. The service re-reads the project and Foundry. It answers `status: "current"` when the action still matches, or `status: "changed"` with the new current `action`; the card then refreshes and offers it. The check applies nothing. `sync` still matches while required selections are unresolved.

**Owner resolution.** The owner can mark an unresolved required selection resolved from the card (**Mark ... resolved (owner)**), recording an orchestration `owner-resolution` event with the `name`, optional exact `source` (the selection's pinned source by default), the `prior` manifest entry and an optional `reason`. The resolution fills a gap only: once Foundry supplies an accepted source for that selection, Foundry wins. It survives later syncs, and the earlier sync and its gap stay in history. Plans may omit a piece for a resolved selection that has no source. Agents cannot record or apply it: `POST .../owner-resolution` requires the browser session, and `apply` rejects the stage with `OWNER_DECISION_REQUIRED`.

`decision`, `publication` and `draft-review` are retired. Existing records stay readable as history and new ones are rejected with `LEGACY_STAGE`. Their old digests remain valid historical Rehearsal URLs.

The plan and draft prompts ask for what Rehearsal's per-asset spec export needs: a named `scene.scaleReference` (`asset`, `label`, `height` in metres); for every piece, metre dimensions, `build.anchor`, `build.walkable` and `build.clearance` notes (doors, routes); and cue `targets` with `interact` and `clip` for every piece a character uses or animates. After publishing, the builder runs `spec STORYBOARD_ID/SCENE_ID --unapproved` from Rehearsal, checks that no piece lacks dimensions and that `warnings` is clear, and records `source.contentDigest` and `specDigest` in the draft record's `contentDigest` and `specDigest` fields, not in notes. The asset-generation prompt starts 3D prototype work from the spec of the approved draft when one exists, using Foundry's `asset.spec` operation, and uses `--expect CONTENT_DIGEST` to detect staleness.

Card actions follow `next`: `sync`, `plan`, `publish` (draft prompt), then `handoff` (**Copy start implementation prompt**). The handoff prompt has the implementer read the draft from Rehearsal, stop unless it carries the owner's final approval, implement or continue the scene, and mark the card implemented once the code roughly matches its scope. Use the development checkpoint flow when a development map exists and `scene.status.record` otherwise. A light check is enough and the agent states what it did not check.

For an owner-authorized legacy transition, use `legacyReset: true` on the first sync for that scene in a single-operation batch. Preview the exact target, prior event, active legacy draft and accepted models first. This append-only transition retires active legacy requirements and pending actions. It retains the brief, legacy events and the old Rehearsal revision. The transition writes atomically without making or pruning snapshots. Every other scene, storyboard and external service is outside the transition.

The game handoff reads the plan and the accepted Rehearsal draft with its references, accepted Foundry IDs and pending runtime checks. Use game implementation for model placement, collision, selection and final animation.

**Copy in-game scene review prompt** is available alongside the start implementation prompt once a draft exists. The reviewer's report must include evidence: free-camera captures of every prop, scale checked against a named baseline asset, and every animation clip checked against the action using it, flagging anything moving while idle or gliding. The game starter prompt asks for observability: free camera, focus on selection, scene state as JSON, a screenshot endpoint, and a clip-to-action manifest. Once a game build is available, paste it into a fresh reviewer chat in the game workspace and append the prototype name for the scale reference. The reviewer measures the loaded reference after game transforms and returns a verdict, numbered annotated and original screenshots, measured findings and a paste-ready correction prompt in chat. The reviewer then records the result as an orchestration `game-review` record: `{stage:"game-review", draftId, reviewer, build, route, verdict:"ready"|"changes-requested", findings:[...], evidence:{propCaptures:[{piece,captureRef}], scaleChecks:[{piece,against,result}], clipChecks:[{piece,clip,action,result}]}}`. `draftId` must be the scene's current draft. `evidence` is optional in the schema (a changes-requested review needs findings only), but Loom rejects a `ready` verdict with `REVIEW_EVIDENCE_REQUIRED`, naming the missing categories, unless `propCaptures`, `scaleChecks` and `clipChecks` are each non-empty. A later sync, plan or draft record clears the review. The card shows prop-capture, scale-check and clip-check counts. Placement fixes go to the game builder. Geometry findings can supply instructions for a targeted Foundry revision.

## Legacy rehearsal compatibility

Earlier brief, review, candidate and fit records remain readable as history; new ones are rejected. Current scene cards use the orchestration workflow above. `rehearsalBrief` stays a planning aid and the fallback source of selections.

Save the draft via `scene.patch` with `changes.rehearsalBrief`. The fields are `layout`, `scenarios`, `assets`, and `gaps`. Each asset has `name`, `decision` (`use`, `optional`, `leave out`, or `missing`), `rationale`, and `behavior`. An optional `source` records `libraryId`, `assetId`, and `revisionId` for the inspected model. Use `schema batch` for the full contract. Omitting the field preserves the draft, and setting it to null clears it. A saved brief is review material. Its asset references are proposals and carry no external approval.

A named storyboard copy inherits its scenes' draft briefs as planning content. Recheck the layout and source revisions against the copied storyboard before reusing them.

Include `basis: { storyboardId, contentRevision }` using the target and revision read before writing. Submit the brief in its own batch. A draft with no basis, a different target, or a later storyboard content revision is marked for re-review. Layout-only changes do not affect this notice. If the Foundry lookup has no linked library, verify an owner-identified legacy library or ask for the intended library before saving asset decisions.

## Retired fit loop (history only)

Rehearsal no longer imports or fits Foundry assets: it locks placeholder layout and produces a per-asset spec. The `review`, `draft`, `candidate`, `candidate-review` (including `ownerOverride`) and `fit` rehearsal events, and their prompts, are retired. Scenes saved earlier keep them in `rehearsalEvents`; they still load, validate and display as history. The service rejects any new one with `LEGACY_RECORD`. Foundry owns model acceptance; Scene Loom reads it live (see above) and never rules on a candidate.

Development mappings bind to `plan.repository`, the canonical absolute Git common directory. Resolve symlinks on the path from `git rev-parse --path-format=absolute --git-common-dir`. Linked worktrees share this identity. Review and start require a mapping with this field. Older maps remain readable and require remapping and review before new claims. An active claim blocks plan replacement until its owner checkpoints the work. An interrupted claim can use the existing explicit takeover flow on a repository-bound plan.
