# Progress and continuation

## Project Vision visualization prompt — 2026-11-13

- The starter asks for distinct frames of the finished experience in use for games and projects with core 3D work. The agent chooses the viewpoint, art direction, and moment.

## Named storyboards — 2026-11-12

- Healthy copies remain selectable during Baseline recovery. Reselecting the open project keeps its active storyboard, and copy prompts use the current owning project title. Covered by the Node suite and targeted Chrome regressions.

- The project picker lists storyboards as keyboard-accessible rows with a checkmark on the active storyboard. Both Chrome picker scenarios passed after the change.

- Existing canvas data and history stay on the Baseline. The project switcher creates a named copy from the open storyboard and remembers the selected target across reloads.
- Copies carry source provenance and start independent content and layout revisions. The service stages complete copies before publishing. Damaged copies keep their identity for recovery and reserve their names.
- Scene, vision, repository, and Mesh Foundry prompts carry exact target IDs and CLI reads. Mesh Foundry resolves images from the selected storyboard's manifest and asset directory. Live Kairo and Scene Rehearsal work is deferred.
- Independent review and verification covered legacy state, atomic failure, copy isolation, recovery, keyboard navigation, selection persistence, and the real clipboard-to-CLI handoff with fictional data. Build, lint, formatting, 18 Node tests, and 5 Chrome scenarios passed. Inspected the storyboard picker at 1440 × 960 and 390 × 650.

## Project switcher refinement — 2026-11-11

- The header switcher opens with title search, a bounded scrolling project list, and an active-project indicator. The starter prompt stays in the footer, alongside the Project actions control for repository prompts and Mesh Foundry handoff.
- Browser coverage exercises a long library in a short window, narrow viewport placement, filtering, arrow-key navigation, a single Tab stop for results, focus-leave dismissal, and project-specific prompts and settings.
- Build, lint, formatting, 16 automated tests, and all 4 Chrome scenarios passed. Rendered checks covered a 900 × 450 window and a 390px-wide viewport.

## Project Vision implementation — 2026-11-06

- Owner authorized implementation of the scoped enhancement. Added optional validated Project Vision to version-1 projects; existing models/snapshots remain valid without it. `project.vision.set` uses existing atomic content batches, revisions, deduplication, snapshots, and notifications, synchronizing title to the chosen name.
- Added new-project starter prompts, existing-project vision adoption, refinement, and a dedicated saved-vision first-scene resume prompt. Optional name/type/audience/experience/visual direction/features/boundaries/start fields support software projects beyond games. Prompts specify adaptive questions, naming collision research with limits, confirmed decisions versus assumptions, vision-first saving, and autonomous one-scene Edit/Continue defaults.
- Added Project Vision panel with focus restoration, Escape/close, long-form sections, safe external reference links, naming notes, and live updates. Persistent new-project action never targets the selected project. Generalized game-only positioning in product/readme/metadata/guidance and documented the new operation and limits.
- Integration coverage includes pre-vision models/snapshots, dry runs, atomic rejection, stale revisions, replay, restart persistence, combined vision/scene batches, and recovery. Chrome coverage includes prompt targets, existing-project adoption, first-scene resume, live refinement, panel focus, long content, narrow layout, reload, and vision publication during dragging alongside existing scene regressions.
- Independent read-only review found a saved-vision resume path that restarted discovery; fixed with a dedicated prompt and clipboard regression. Follow-up review found no additional confirmed blocking defects. Narrow-header overlap found by rendered inspection was corrected.
- Verification: build/typecheck, lint, formatting, 11 integration tests, and 4 Chrome regressions pass. Final strengthened drag/vision regression also passes (4 Chrome tests, 27.6 seconds). Screenshots under ignored test-results include vision-desktop.png, vision-laptop.png, and vision-narrow.png. All test services use isolated temporary data; no owner project content was changed.
- Remaining human judgment: real external-agent game and web-system creative trials have not been performed. Prompt compliance, reference usefulness, naming quality, and illustrated scene quality depend on the chosen agent and tools. No guarantee of name availability or working software is implied. No commits, pushes, or deployment.

## Enhancement scope — 2026-11-06

- Prepared [Project Vision and creative starter scope](project-vision-scope.md) at the owner's request. Covers software projects beyond games, a low-effort starter template, external-agent discovery, persistent vision, first-scene publication, and vision-aware Edit/Continue prompts.
- Includes boundaries, compatibility/recovery requirements, delivery sequence, acceptance checks, useful additions, and explicit deferrals. Scope preparation only; application implementation has not begun or been authorized by this checkpoint.
- Added optional project naming: meaningful concept-aligned suggestions, preliminary web collision screening when no name is supplied, creator/delegated selection, and consistent project title/vision naming. Unchecked suggestions and legal-availability limits must be explicit.
- Owner confirmed all five proposed additions as core scope: decisions versus assumptions, explicit exclusions, vision-first saving, one-scene defaults, and existing-project adoption. Deferred features remain deferred; no application changes made.

## Current checkpoint — 2026-11-05

First usable version implemented, reviewed, and successfully tested by the owner with fish.exe. Source root is /Users/zaffran/vibed/scene-loom. The owner authorized the initial commit and push to the private GitHub repository zabuzaff/scene-loom. No deployment requested.

## Completed phases

- Foundation: pinned React/TypeScript/Vite, Fastify, Zod, sharp, and CLI tooling; complete-model validation, owned images/thumbnails/source bytes, atomic project writes, request deduplication, layout/content revisions, local session/origin/host checks, and a single-service lock.
- First useful canvas: one canvas per project, image cards, labeled branches/joins/loops, pan/zoom/fit, persisted arrangement, Motion-expanded details, supporting images, Continue/Edit copy prompts, and automatic updates preserving positions/viewport.
- Refinement: title search/focus, recent-update focus, explicit save/connection errors, 20 recovery snapshots, normal and corrupt-state restore, locally hosted fonts, lazy-loaded canvas, and opt-in four-image example seeder.
- Actual commands and agent usage documented in README.md, AGENTS.md, and docs/agent-interface.md.

## Verification

- Passing: npm run typecheck, npm run lint, npm run build, npm test (8 integration tests), npm run test:browser (2 Chrome tests), and final formatting/dependency checks.
- Chrome workflow uses the actual CLI, tests expansion and both copied prompts, dragging while an agent edits, persistence after reload, search/fit, and 100 scenes/150 connections.
- Separate test stops and restarts a real service and checks viewer reconnection, image display, preserved layout, and data-root-aware prompts.
- Actual panning smoke sample on this machine: 31 animation frames across roughly 500 ms, median interval 16.7 ms. This is a short local observation, not a sustained performance guarantee.
- Development command separately smoke-tested through Chrome with empty-state onboarding, starting-prompt clipboard content, and help. No browser runtime errors in the captured checks.
- Independent read-only review found two defects: placement beyond schema bounds and recovery requiring readable current state. Both fixed with regression tests. Follow-up disposition: ship for owner review, with no additional blocking findings at the reviewed source/static-capture scope.
- Final captures reviewed at 1440×960, 1280×800, and 900×700. Expanded cards focus into view without rearranging other cards. Details and supporting images remain readable and proportional. See verification.md for capture paths and photo provenance.
- Impeccable's launcher was not executable in its global installation. Used its written new-work/craft-floor guidance and an independent review; no detector/comp-led approval claim.

## Local data and stopped preview

- The **Tideglass — example** project was removed at the owner's request, including its owned images, thumbnails, and backups. Verified project ID: project_1e98f1ed-5b6c-4cbc-8686-da84862e9ba1. The temporary preview data directory now contains no projects.
- Normal personal storage is ~/Library/Application Support/Scene Loom. It was empty when the example was removed; the owner subsequently began fish.exe testing. No other project data was removed.
- Agent-launched previews and test services were stopped. An owner-started service on port 4318 was present during the later After Hours update and was left running.
- Historical QA screenshots remain outside Git at /private/tmp/scene-loom-preview/screenshots. They are evidence, not loaded project records, and may disappear during temporary-file cleanup.
- Impeccable is installed globally at ~/.codex/skills/impeccable, not vendored.

## Next useful step

The owner reported that the real fish.exe Codex-to-studio workflow worked perfectly, completing the previously outstanding real-world workflow check. Continue based on actual creative use and owner feedback. The selected After Hours theme and stronger type are the current approved visual direction.

## Deliberate limits

Desktop Chrome verified; no cross-browser/mobile-first claim. No built-in AI/chat, manual scene-content editor, cloud sync, 3D asset studio, automatic global rearrangement, or reduced-motion work. No automatic asset garbage collection; retained asset files protect backups. Source Git history and local storyboard recovery are separate.

## Follow-up — studio identity

- Added an original linked-scene-frame SVG mark, used in both header and empty state. Added SVG/ICO/32px PNG favicon variants, 180px Apple touch icon, and a reusable 512px app icon. Generated from the vector through npm run icons; no raster-generation service required.
- Added application/description metadata, matched browser theme to the header, and made tab titles reflect the active game.
- Verified production build/typecheck, lint, formatting, real Chrome icon loading, six asset routes and MIME types, PNG dimensions, ICO header, active-game tab title, and metadata. Header capture: /private/tmp/scene-loom-preview/screenshots/brand-desktop.png. No browser runtime errors.
- Scope is browser identity only; no new data features or portable project export added. No commits, push, or deployment.

## Follow-up — review fixes and example cleanup

- Keyboard card movement now persists through the same revision-aware save path as dragging. Dirty bookkeeping is outside the React state updater. Moves queued during a post-save refresh are drained before the save lock is released.
- Stored-state validation now covers the top-level document and request receipt structure. Null documents, non-object documents, and malformed receipts are classified as CORRUPT_PROJECT and can use explicit backup recovery.
- Project listings isolate damaged/missing/unreadable project files, return a structured recovery entry, and preserve healthy projects. The picker disables damaged entries, shows a recovery notice, and falls back to readable projects instead of trying to load a broken saved selection.
- Regression coverage: malformed-state classification and actual backup restore; HTTP listing with healthy and corrupt projects; repeated keyboard moves and reload; an intentionally blocked post-save refresh followed by another move; browser selection/recovery notice with independently created temporary fixtures.
- Removed only the verified Tideglass example project. Default personal storage and preview storage are empty. The optional example seeder remains available but never runs automatically.
- Independent review cleared the backend changes and identified the additional save-refresh window; the loop was fixed and its regression strengthened to block both SSE and save refresh requests.
- Final verification: production build/typecheck, lint, formatting, 10 integration tests, and 3 Chrome browser tests. Test services are stopped after completion. No commits, pushes, or deployment.

## Follow-up — After Hours and expressive typography

- Owner chose After Hours from three interactive previews and requested flashier fonts. Applied graphite/grey/off-white surfaces with pale blue accents; replaced warm olive/beige styling across the canvas, cards, menus, help, notifications, and browser identity.
- Installed locally hosted Syne Variable for expressive headings/wordmark and DM Sans Variable for readable controls/body copy; removed the superseded Manrope/Cormorant packages. Updated the icon set and theme metadata to match.
- Centralized remaining old palette literals into theme tokens, aligned React Flow's background and connection styling, and shortened the canvas heading to Story canvas.
- Verification: production build/typecheck, lint, and all 3 Chrome browser regressions pass. Isolated visual inspection covers empty, overview, expanded, compact, and narrow header states. Loaded fonts confirmed; primary card text contrast 13.6:1 and secondary canvas text 7.9:1. No browser runtime errors.
- QA fixture and service on port 4331 were removed/stopped. The owner's service on port 4318 and their game data were not changed by verification. No example project was reintroduced into personal storage.
- Independent source/static-capture review disposition: ship, no material visual findings. A narrow screenshot artifact after sequential resizes was resolved with a fresh 390px browser capture; one header and correct toolbar positioning verified. Final formatting and Markdown checks pass. No commits, push, or deployment.

## Source publication

- Owner authorized committing and pushing the completed studio to https://github.com/zabuzaff/scene-loom.
- Verified the repository is private, empty, and writable. Configured origin to git@github.com:zabuzaff/scene-loom.git, using the existing personal SSH key through repository-local Git configuration. Global SSH settings were not changed.
- Initial source scope: application, CLI, tests, build/dependency configuration, generated browser icons and their vector source, and project documentation. Personal game projects/assets/backups, runtime credentials, node_modules, build output, and QA captures stay outside the commit.
- Final publication checks: current typecheck, all 10 integration tests, and formatting pass; the preceding After Hours build/lint and all 3 Chrome browser regressions pass. Intended files were inspected for accidentally included credentials with no findings.
- Initial commit message: [FE] build agent-driven storyboard studio

## Follow-up — search field and scene activation

- Removed the heavy outline on the scene-search text field, as requested; the caret and search layout remain. Other controls retain their existing focus treatment.
- Selecting a search result now selects and expands the scene through the same delayed animated focus path as canvas activation. Searching for an already-expanded scene refocuses it without collapsing it. The search panel closes after selection.
- Verified production build/typecheck, lint, and all 3 Chrome browser regressions. The search regression checks expansion, selection, panel dismissal, matching camera placement after a normal canvas click, and refocusing an already-open scene. Capture: test-results/search-scene-focus.png.
- Reviewed the resulting diff locally. Verification used temporary test projects; the owner's fish.exe project and running service were not used for tests. Owner reviewed this follow-up and authorized its commit and push to main.

## Harness neutrality — 2026-11-06

- Owner clarified support for any compatible agent harness. Replaced remaining Codex-specific recovery/clipboard messaging and active product/setup/interface guidance with agent-neutral wording. Historical checkpoints retain their actual verification context; the installed Codex skill location remains an environment fact.
- Shared copied-prompt guidance explicitly avoids requiring Codex-specific tools/skills, supports plain-text question options, and explains missing CLI access. README documents local execution/data-root requirements and external capability limits. Existing CLI/service architecture already has no Codex runtime dependency.

## Review patches — 2026-11-06

- Existing-project vision adoption now treats the current title as the supplied name, preserving it unless the creator explicitly requests renaming. Blank name fields no longer authorize new naming suggestions. A previously copied adoption prompt also preserves a vision saved by another session and asks for refinement direction.
- The onboarding browser fixture uses a unique title and removes only its own project in `finally`, including on failure. Clipboard assertions cover the naming and existing-vision safeguards.
- Verified production build/typecheck, lint, formatting, diff checks, and two consecutive runs of the targeted Chrome regression (2 passed, 7.9 seconds). Reviewed the patch locally; no commits or pushes.

## Mesh Foundry asset concept handoff — 2026-11-09

- Scene cards copy a harness-neutral prompt to inspect the current scene image and vision, propose assets and reuse candidates, and confirm the list and exact Mesh Foundry destination with the creator. After confirmation the prompt requests only image-backed 2D Concepts. Individual progression and approval take place in Mesh Foundry.
- Build/typecheck, lint, formatting, and all four Chrome regressions passed. The scene-card regression passed again with the final styling. Rendered inspection covered collapsed and expanded cards, and browser assertions verified the clipboard target, confirmation and stage instructions, and unchanged scene data after copying.
- Actual concept generation and publication through an external agent remain to be tested with a creator-approved list. Verification used isolated Scene Loom fixtures.

## Standalone mode — 2026-11-09

- Mesh Foundry handoff is off by default. Start with `SCENE_LOOM_MESH_FOUNDRY=1` to expose the asset prompt. The service reports the setting in agent info and standalone cards retain Continue and Edit.
- Build/typecheck, lint, formatting, and all four Chrome regressions passed. Chrome exercises both service configurations and verifies that standalone cards hide the handoff action and retain Edit.

- Review follow-up: the handoff prompt explicitly rereads the source after approval and before publication. A material change pauses the handoff for renewed confirmation. Build, lint, formatting, and the targeted Chrome clipboard regression passed.

## Per-project Mesh Foundry preference — 2026-11-09

- The project menu now saves **Mesh Foundry handoff** for the active project. This replaces the startup environment flag. Projects without the preference default to off. The service serializes preference writes alongside content and layout writes and preserves the current preference during normal restore.
- Build/typecheck, lint, formatting, 11 integration tests, and four Chrome tests passed. Verified toggling on and off, reload persistence, isolation between projects, unchanged revisions, and restore behavior. Inspected the rendered project menu and completed an independent read-only review with no defects found.

- Review follow-up: moved the Mesh Foundry switch above the independently scrollable project list. At 900 × 450, Chrome verified that the switch stays fully visible while scrolling to the last of 24 added project rows. Build, lint, formatting, and all four Chrome tests passed. Inspected the short-window capture.

## Repository workflow prompts

- Added project-menu actions to start development from the complete storyboard and resync the board from verified repository behavior. Development starts with a coherent implementation slice. Resync preserves planned scenes and uses revision-checked, evidence-backed updates. Agents resolve the software repository from the workspace or creator direction.
- Build, lint, formatting, and all four Chrome tests passed. Verified clipboard contents, active-project targeting, empty-board behavior, and reachability in a short window. External agent execution remains to be tried on a real repository.

- The development prompt authorizes web research before coding and delegates framework, database, and UI library selection. It asks the agent to use maintained dependencies and follow documented conventions. Build, lint, formatting, and the targeted Chrome clipboard test passed.

- Development now distinguishes new or unsynced storyboard references from an existing synced baseline. The prompt encourages original visual decisions for new work while carrying forward confirmed requirements. The Chrome clipboard regression passed with both cases covered in the copied instructions.

- Review follow-up: resync instructs the agent to record per-scene repository verification in notes, including for scenes whose images already match. Development checks that evidence or follows explicit creator direction. Build, lint, formatting, and the targeted Chrome clipboard regression passed.

- Development defaults to working end-to-end implementation even when storyboard material uses demo or prototype wording. Demo-only work requires explicit current creator direction. Build, lint, formatting, and the targeted Chrome clipboard regression passed.

- Weekbeam review showed that opening all storyboard images and using the full board as a product brief anchored the implementation to its mockups. Development now extracts goals and confirmed requirements, leaves unverified images unopened by default, treats provisional visual prose as illustrative, and records an independent design direction before coding. Verified scenes serve as a baseline within the scope supported by evidence. Build, lint, formatting, and the targeted Chrome clipboard regression passed.

- Storyboard creation and revision prompts now default to paper wireframes for interface projects and game-style illustrations for gameplay. The interface guidance calls for black lines on white, simple layout blocks and labels, and imagery placeholders. Project Vision carries provisional art direction separately. Build, lint, formatting, and all four Chrome regressions passed, with clipboard checks for Starter, First Scene, Edit, and Continue.

## Text-only planning scenes

- Planned interface scenes now default to text with user goals, actions, system responses, and relevant states. Sketches are available on request. Gameplay illustrations remain the default when available. Resync can attach a verified screenshot to the same card.
- The scene model accepts an omitted or null main image. Non-null image references still pass existing asset validation. Text cards show a description preview, retain scene actions, and offer Mesh Foundry handoff once a main image is attached.
- Build, lint, formatting, 12 integration tests, and all four Chrome tests passed. Browser coverage verifies the text card, later image attachment during a nearby drag, and prompt defaults. Inspected the rendered mixed board. Independent review found outdated illustration wording, which was corrected and checked against the generated starter prompt.

- Review follow-up: resync now instructs the agent to attach a verified screenshot to scenes with missing, outdated, or speculative imagery. It publishes the screenshot reference and verification notes together and marks outdated imagery unverified if capture is unavailable. Build, lint, formatting, and the targeted Chrome regression passed.

- Start Development now requires a maintained UI component library for frontend work and asks the agent to verify its use in rendered screens. Build, lint, formatting, and the targeted Chrome clipboard regression passed.

- Start Development now requires browser verification of the primary frontend flow, including real application behavior, applicable persistence, intended viewport sizes, and keyboard operation. The agent reports observed results or marks verification incomplete with a blocker. Build, lint, formatting, and the targeted Chrome clipboard regression passed.

- Start Development now directs agents to make the normal local app ready to try with repeatable, non-destructive fictional data and test-account seeding where needed. Storyboard preview and demo labels no longer invite a separate application mode. Browser verification exercises the normal startup path. Build, lint, formatting, and the targeted Chrome clipboard regression passed.

- Review follow-up: Start Development requires checking the effective datastore before automatic seeding, manual seeding, and browser writes. Seeding, browser checks, and startup instructions use the same verified local configuration. Typecheck, lint, formatting, and direct prompt checks passed.

- Start Development now scopes reference websites to broad aesthetic cues by default. For new visual work, agents research comparable products online for workflow patterns and develop an original interface. Typecheck, lint, formatting, and direct prompt checks passed.

- Review follow-up: design research now applies to new or explicitly redesigned surfaces, and recent examples require dated visual evidence showing the pattern. Typecheck, lint, formatting, and direct prompt checks passed.

## Four-sided canvas connections

- Scene cards have a connection point on each side. The canvas routes arrows from current card positions and measured bounds, preferring an axis with clear space between cards. Opposing arrows take separate paths and self-loops wrap around the top-right corner.
- Build, lint, formatting, and all four Chrome tests passed. The routing checks verify vertical ports, a return path, a self-loop, and live rerouting after a layout change. Inspected the rendered fixture. Independent review identified the overlapping-bounds case, which was corrected before the final Chrome run.

## Arrange scenes

- Added an explicit Arrange scenes action beside Fit all. It places connected groups in columns, accounts for measured card sizes, and grids disconnected scenes below the flows. Positions save through the existing layout queue and the canvas frames the result.
- Build, lint, formatting, and all four Chrome tests passed. After independent review, cycle fallback was corrected to start within a cycle instead of a downstream card. The cycle example and targeted Chrome arrange/restart test passed against the final code. Inspected the arranged branch fixture. If an agent inserts a scene while the arrangement is being saved, its independently assigned position can overlap an arranged card.

- Arrange scenes now routes return wires along the outside of their source row or column. Chrome verified the new endpoints after arrangement for the forward, return, and join edges. Inspected the final arrangement and passed build, lint, and formatting checks.

- The Weekbeam screenshot exposed labels wider than the card gaps and wires crossing nearby cards. Labels now have a compact width with the full text on hover. Routing checks card bounds, including endpoints, and tries alternate connectors when its preferred curve crosses a card. Return arrows reserve the forward arrow’s actual port pair. Build, lint, formatting, routing regressions, and the final targeted Chrome test passed. Inspected the arranged fixture with a long label.

- Arrange scenes now interpolates card positions over 600 ms. Wires follow the moving endpoints and choose their final ports when the cards settle. Only final positions enter the layout save queue. All four Chrome tests passed, and the final targeted check confirmed intermediate positions and one layout save. Independent review led to preserving transient positions only for moving cards during live updates.

- Patched the Arrange review findings. The save checks both revisions from the board used to calculate the layout. A conflict discards only the stale arrangement, restores saved positions, and prompts the user to arrange again. Wire collision checks now test line segments between curve samples. Build, lint, formatting, all 16 tests, and all four Chrome tests passed. Chrome inserted a scene immediately before the arrangement write and verified rejection followed by a successful rerun.

## Starter storyboard and resync numbering

- New projects and empty projects with a saved vision use the same starter guidance. It asks for three to six scenes covering one core journey, published with their connections in one batch. Planned interface scenes still default to text.
- Starter and resync prompts use hierarchical title prefixes to show primary branches. Labeled connections describe alternate entries and cross-branch relationships. The arrange action currently uses the connection graph.

## Development planning and review

- The project menu now copies separate prompts for planning, independent review, and implementation. Planning puts researched decisions and acceptance checks in the target repo's Markdown. Review returns findings and a verdict tied to the files it read. Start development requires a matching review before coding.

- Review follow-up. Start development requires a Ready verdict with a matching SHA-256 digest for every plan file. Planning and review cover the same applicable build requirements. Cards with hierarchical title prefixes display that number once, while older titles retain their positional badge.

## Project Vision visualization approval — 2026-11-12

- The starter asks how many visualizations to review per round, defaults to three, and supports repeat rounds in the external agent conversation. Explicit creator approval gates one content batch for the selected visualization, vision, and connected text storyboard. Existing storyboard adoption preserves its scenes.
- Project Vision displays the selected project-owned image. The service rejects missing vision images and prevents the selected image from appearing in scene attachments. Scene prompts reserve new attachments for real project imagery and preserve legacy attachments during text edits.
- Build, lint, formatting, 19 automated tests, and all five Chrome checks passed. Inspected the approved image in the desktop and narrow Project Vision panels.
- Follow-up review tightened asset provenance. New scene attachments require the declared `project-image` kind, and new vision image references require `visualization`. Reimports preserve the original classification, and existing unclassified scene attachments remain editable. The starter, scene, and resync prompts now specify the appropriate import kind and distinguish planned scenes from verified scenes with available imagery.

## Storyboard-scoped Mesh Foundry handoff — 2026-11-12

- Project Vision offers the asset suggestion prompt on enabled storyboard versions. Draft suggestions persist on the exact version, link to one or more scenes, and expose their rationale and pinned revision in scene details. A linked text-only scene can copy its generation prompt.
- Generation uses the Mesh Foundry scoped pin contract. Scene Loom checks the live toggle for suggestion and result mutations, supports repeat result writes, and copies drafts without copying result pins to a new storyboard target.
- The starter drafts the full agreed text storyboard and requests a saved visualization for games and projects with core 3D work. Development plans and reviews carry both stable IDs.
- Follow-up review added draft retirement, ordered result writeback using the Mesh Foundry library version, and publication checks for every linked scene. Retired drafts retain their recorded results and disappear from the active handoff.

## Scene rehearsal prep — 2026-11-15

- Enabled storyboards now offer a rehearsal prep prompt on every scene card. The agent reviews the full Foundry library and proposes spatial layout, asset selection, clip needs, and scenario cues.
- The scene patch contract saves a reviewable draft brief on the exact scene. Expanded cards display the draft. Foundry animation requests and rehearsal publishing are follow-on work.
- The prep prompt handles unresolved Foundry libraries explicitly. Saved briefs now show a review notice after storyboard content changes or when their source revision is unknown.
- Saved briefs offer **Copy rehearsal review prompt** for an independent production review in a fresh agent session.
- The saved brief adds **Copy rehearsal handoff prompt**. It uses the independent review to stage a new blockout or continue an existing rehearsal with the verified scope.

- 2026-11-16: Added the scene-scoped rehearsal event contract, visible next actions, and fixture coverage from draft review through model acceptance, fit corrections, and stale evidence. External Kairo integration remains a separate test.
- Follow-up review added adoption of an existing Foundry revision, fresh review and fit after replacement, and status text for unresolved failures from earlier rehearsal revisions.

## Scene card development and resume — 2026-11-16

- Planning saves ordered development slices and exact plan fingerprints to the storyboard. Independent Ready review unlocks card actions. Shared slices, dependencies, exclusive claims, and checkpoints use the atomic CLI batch path; changing the plan retains old evidence and invalidates old claims.
- Compact cards show the active or next slice. Expanded game cards add **Where you left off**, required asset fit, rehearsal and implementation indicators, and per-asset actions. Foundry review clearance, owner acceptance, current rehearsal fit, and implementation verification remain separate. Missing direct links fall back to the exact recorded identities.
- Fixtures: run `npm run build` then `npm run test:browser -- progress.spec.ts` (add `--headed` to watch). Booking Studio: use **Copy start development prompt** on Search appointments, **Open Search appointments** on Confirm appointment, then **Copy continue development prompt** on Choose a time after the shared checkpoint. Tide Garden: use **Open Enter the garden**, then **Copy Foundry revision request** for Gate. In Foundry use **Copy developed model review prompt**, **Copy developed model correction prompt** if needed, and **Acceptance → Accept this revision** after clearance. Back in Scene Loom use **Copy Foundry acceptance verification prompt**, **Copy rehearsal fit-check prompt**, and **Copy rehearsal correction request** for an authorable issue. A saved capability blocker links to the affected rehearsal.
- The fixture walkthrough uses isolated Scene Loom data and recorded stand-ins for external revisions. Live Kairo data and a live three-app trial are reserved for follow-up.
- Verification: build, lint, formatting, 22 automated tests, and all seven Chrome tests passed. Inspected the compact ordinary and game cards and the expanded game card. The final fixture rerun verified the game card’s top correction action, preserved card position on expansion, saved dragging, canvas zoom, and scroll isolation. Independent review caught an incompatible Foundry verdict; the final record uses the existing candidate event shape with additive clearance evidence.
- Review fixes let a prerequisite link select its exact slice even when another slice on the same card is active. Collapsed game cards count unmeasured required assets, and collapsed non-game cards summarize multiple asset handoffs. The Chrome fixtures cover exact slice selection and the open count after the measured asset passes.

- Bound reviewed development plans to the target Git repository, including its linked worktrees. Plan replacement now rejects active claims until the agents checkpoint them.

- Game scenes and scenes with rehearsal history open in a viewport-sized dialog. The canvas node stays compact and opening the dialog leaves the canvas zoom and position alone.
- The scene dialog now opens with motion from the selected card. Its resume summary and progress sit side by side on desktop and stack on narrow screens. Asset actions are grouped by asset.
- Production cards now wait for the canvas camera to focus the selected card before beginning the expansion animation.
- Expanded scene cards use After Hours copy controls and accessible progress tracks that animate both on opening and when saved progress changes.

- Candidate review history supports owner overrides of exact rejected revisions. The service checks current Mesh Foundry owner acceptance before saving the override. Rehearsal fit still requires a separate check.

## Scene orchestration checkpoint — 2026-11-17

- Scene cards now sync accepted Foundry assets, preview and decide on an orchestration plan, then publish and independently review a placeholder-only draft. A reviewed draft carries exact plan, model, placement, cue and runtime-check evidence into the game handoff. Legacy review and fit records are still readable.
- Independent review led to durable pin retention across failed syncs, a browser owner-decision route, exact Rehearsal plan-head verification, live acceptance checks before plan decisions and publication, and distinct planner, builder and reviewer provenance.
- Applied the dry-run-verified append-only reset to Kairo's **3D Research Office (Cozy 3D)**, scene `office`, at content revision 19. The card shows 12 required and five optional prototype pins verified. **Practice Account ledger** remains a required gap because the linked Foundry library has no matching asset. The available action is **Copy accepted-asset sync prompt** after resolving that selection. Once verified, **Copy scene orchestrator planner prompt** becomes available. No plan or draft was created for Kairo.
- Verified the 17 earlier Loom records, the exact historical Rehearsal head, Market Desk model 1 and its owner override, all eight other project/storyboard targets, scene layout and the unchanged backup list. The running Kairo Rehearsal service still reports its legacy library API and will need a reload from the updated Rehearsal checkout before the eventual v3 publication.
- Verification covered typecheck, production build, lint, formatting, 24 unit tests, and seven Chrome tests. The Chrome fixture checked copied planner IDs and intent, owner changes and approval, draft correction and re-review, and stale plan and draft rejection. An isolated run against the actual updated Rehearsal service also verified grouped placeholder publication, exact final approval, and Loom advancing to the game handoff.
- Review follow-up added same-plan ancestry recovery after missed publication writebacks, a live Foundry approval check before draft approval and game handoff, routing from draft review back to planning, and duplicate-name protection for unpinned selections.

- At Cozy 3D content revision 21, saved the 17 verified Foundry pins as the explicit office asset selection. The Practice Account ledger originated in the legacy rehearsal brief, and the combined researcher rig was replaced by the four separate character assets. The asset selection and sync used the targeted no-snapshot path. Live readback advanced the card to planning and confirmed the backup list was unchanged. No plan or draft was created.
