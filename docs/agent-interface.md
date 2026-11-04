# Agent interface

Scene Loom is fed by agents from Codex chats. Use the CLI and versioned JSON schemas; do not edit project files directly. Image generation happens externally with whatever tools the agent has available.

## Connect and discover

Start the service as described in [README](../README.md). Run from this repository, or use the complete command copied from a scene card. For machine-readable output, keep npm's `--silent` flag:

```sh
npm --silent run cli -- --help
npm --silent run cli -- schema batch
npm --silent run cli -- schema project
npm --silent run cli -- project list
```

Schemas are available for `batch`, `project`, `layout`, `createProject`, `importAsset`, `restore`, and `viewport`. `schema` and help work without the service. Other commands read `runtime.json` from the active data directory. Set the same absolute `SCENE_LOOM_DATA_DIR` used by the service; no explicit token or port is needed in a prompt.

Project listing returns a summary per project with `status: "ready"` for readable projects, including `sceneCount` and `updatedAt`. Damaged or missing project files return `status: "unreadable"` with the project folder ID and a structured `error`; they do not block other projects. Use the listed ID with backup/recovery commands. The studio marks unreadable entries as needing recovery and selects only readable projects.

All results use `{ "success": true, "data": ... }`. Errors use `{ "success": false, "error": { "code", "message", "location"?, "suggestion" } }` and a nonzero exit status. Transport/input failures use `CLI_ERROR`. Write creative text into JSON files or stdin, not interpolated shell arguments. Every mutation takes a JSON file path or `-` for stdin.

## Create a project and import images

```sh
npm --silent run cli -- project create /absolute/project-input.json
npm --silent run cli -- project read PROJECT_ID
npm --silent run cli -- asset import PROJECT_ID /absolute/asset-input.json
```

Project input: `{ "id": "my_game", "title": "My game" }`. ID is optional on creation; keep the returned ID.

Asset input: `{ "path": "/absolute/local/image.png" }`. Use static PNG, JPEG, WebP, or AVIF, at most 30 MB and 40 million pixels. The service decodes the image, owns its copies, generates a thumbnail, and returns an asset ID. SVG and animated images are rejected. Reimporting the same bytes returns the existing ID and repairs missing derived files. Main images are required; supporting images are optional.

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

Scene creation requires all fields shown above. A patch can reuse the existing image; omitted fields remain unchanged. IDs accept letters, numbers, hyphens, underscores, begin with a letter/number, and are at most 96 characters. A batch accepts up to 1000 operations within a 4 MB request body. Unknown input fields are rejected.

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

Read `layoutRevision` first and submit only intended positions. Content and layout revisions are independent; stale layout patches fail. Viewport is saved separately by the viewer. Copied Continue/Edit prompts preserve unrelated content and positions and include the guide path and data-root-aware CLI invocation. No prompt is sent automatically.

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
