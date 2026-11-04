# Verification record

Date: 2026-11-05. Local macOS development machine, Node 22.21.1, npm 10.9.4, installed Google Chrome in headless Playwright.

## Checks

- TypeScript, production build, ESLint, storage/service tests, and browser workflow checks pass. Exact final counts and repeat-run status are recorded in progress.md.
- Integration checks cover complete image decoding, owned bytes, invalid batches, idempotency, branches/joins/cycles/self-loops, content/layout conflict isolation, bounded backups, normal restore, placement boundary limits, corrupt-state recovery, and host/origin/session checks.
- Browser checks use the real CLI and local service: ingest scenes, expand details, copy both prompts, drag during a live edit, persist/reload, find/focus, and fit all.
- Separate browser check stops and restarts a real service, verifies reconnection, preserved layout and image display, and confirms copied prompts include the active data directory.
- A 100-scene/150-connection fixture exercises large-canvas rendering and panning. Frame intervals are an observed local smoke measurement, not a performance guarantee.
- No external AI provider is required by the app. Browser fonts and all imported images are served locally.

## Rendered inspection

Example board: **Tideglass — example**, four image-backed scenes with a branch and join. This is illustrative material, not fish.exe content. It was used in the isolated temporary data root at /private/tmp/scene-loom-preview/data and has since been removed at the owner's request. Historical screenshots remain as QA evidence.

Captures are local QA artifacts under /private/tmp/scene-loom-preview/screenshots (outside Git): canvas-desktop.png, scene-open-desktop.png, scene-open-laptop.png, canvas-compact.png, and empty-desktop.png. Reviewed at 1440×960, 1280×800, and 900×700. Final capture status is recorded in progress.md.

Scene photos were downloaded only into the temporary example directory. Sources:

- Arrival: Brandon Griggs, https://unsplash.com/photos/Y3PW7OtsmpY
- Forest: https://images.unsplash.com/photo-1448375240586-882707db888b
- Shore: Patrick Konior, https://unsplash.com/photos/j0zWo6ui3Bo
- Beacon: Thomas Dewey, https://unsplash.com/photos/0mG5QuKHYpE

These photos are reference imagery for checking the viewer, not generated game artwork. Source media is not vendored. The optional seeder downloads nothing.

## Review and limits

An independent read-only code reviewer found an out-of-bounds auto-placement bug and recovery dependence on valid current JSON. Both were fixed with regression tests. Final review disposition is recorded in progress.md.

The owner subsequently tested the actual fish.exe agent workflow and reported that it worked perfectly. Automated checks exercise the same CLI and copied context; the real-world confirmation is owner-reported. Continue evaluating the creative feel through use. Browser tests target desktop Chrome; no cross-browser or mobile-first claim is made. No commits, GitHub push, or deployment were performed.

## Review-fix regression coverage

The current suite has 10 integration tests and 3 Chrome browser tests. New cases cover keyboard-driven saves and reload, moves queued while post-save/SSE refreshes are blocked, malformed document/receipt recovery, resilient project listings, and falling back from a damaged saved selection to a readable game. Recovery UI capture: test-results/project-recovery-notice.png (ignored local artifact). The actual example project was removed; test fixtures create and clean up their own data.

## After Hours visual update

Theme selection and expressive type were implemented after owner approval. Syne Variable and DM Sans Variable are locally hosted and verified loaded in Chrome. Empty, overview, expanded-card, 900px compact, and 390px header captures live at /private/tmp/scene-loom-after-hours-qa. Computed colors match the approved preview; primary card text measured 13.6:1 contrast and secondary canvas text 7.9:1. The isolated QA fixture was removed after capture, and the owner's active fish.exe session was not used for verification. Existing browser regressions pass with the new font metrics.
