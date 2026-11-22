# Scene Loom product brief

## Purpose and audience

A personal local studio for seeing, understanding, and evolving software storyboards maintained by external AI agents through any compatible harness. The owner prompts the agent externally, then reviews the results visually. Scene Loom itself does not need an AI service or API key.

## Agreed workflow

1. Open a software project. Each storyboard has its own zoomable canvas. Use the project switcher to choose the Baseline or a named storyboard.
2. In your preferred agent harness, discuss ideas and request complete scene material, including images.
3. The agent imports images and submits structured scene and connection updates.
4. Scene Loom displays the successful update automatically without manual importing or reloading.
5. Pan, zoom, fit the canvas, drag cards, and open scene details. Positions persist.
6. Copy a card's Continue from here or Edit this scene prompt, paste into your agent, and optionally add direction.
7. The agent reads current state and revises the existing scene or adds connected scenes. Revisions update the selected storyboard. To explore a revamp separately, create a named copy of the current storyboard first.

## Content and interaction

- Each card represents a screen, interaction, workflow step, or gameplay moment, not necessarily a cinematic shot.
- Planned scenes start as text with the user goal, action, response, and relevant states. Scene attachments are reserved for real project imagery.
- A scene can have a main image and supporting images. Repository resync can attach verified screenshots to an existing text scene.
- Card details contain a description and notes; meaningful titles remain visible on the canvas.
- Arrows support branches, joins, loops, and optional short labels.
- Users can drag cards or choose Arrange scenes to organize connected flows. Agents preserve the saved arrangement unless explicitly asked to reorganize it.
- Copy buttons carry stable project, storyboard, and scene references and instructions to read current content, not stale copies of all notes. Nothing is automatically sent to a chat.

## Approved design and tools

After Hours: graphite, off-white, and pale blue with expressive display typography; creative studio character; animated card opening and interactions. React Flow and Motion approved. Impeccable approved and installed in the owner's Codex skills directory. No reduced-motion support work requested.

## First-version additions

Search/focus a scene, fit all, subtle recent-update feedback, and local recovery snapshots. Included through approval of the implementation plan on 2026-11-05.

## Exclusions

Built-in chat or image generation, game engine integration, 3D asset studio, multiplayer, cloud accounts/sync, hosting, mobile-first interface, nested boards, simultaneous comparison views, manual scene-content authoring UI, general drawing/whiteboard tools, background global rearrangement, and media timelines.

## Project Vision enhancement

Software projects include games, websites, web systems, mobile and desktop apps, and developer tools. Copy a new-project starter, provide a rough idea and optional name/type/audience/experience/visual direction/must-haves/boundaries/starting point. The external agent asks a few meaningful questions, researches references and naming collisions when available, develops a written vision and a full connected text storyboard. Games and projects with core 3D work also review visualization options. After explicit approval, the agent publishes the vision, storyboard, and any approved visualization reference in one content batch. Existing projects can define a vision without rewriting their scenes.

Project Vision preserves original intent, confirmed decisions, assumptions, exclusions, and research. Edit and Continue read it and exercise creative judgment when direction is blank, defaulting to one scene. Refine vision changes the brief only unless scene updates are requested. See docs/project-vision-scope.md for the delivery scope and limits.

## Asset concept handoff

When Mesh Foundry is enabled, Project Vision offers an asset suggestion prompt. The agent reads the active storyboard and vision, inspects its approved visualization when present, and saves draft suggestions linked to scenes. A scene with suggestions offers a generation prompt. After creator approval, the agent reuses a pinned revision or publishes a 2D concept in the project's shared Mesh Foundry library, then records the result on the exact storyboard version.

## Repository workflows

The project menu copies separate prompts to plan development, review the plan in a fresh agent session, and build from the reviewed plan. The agent researches and chooses the stack during planning. Planning Markdown lives in the software repository. The resync prompt updates the storyboard from verified repository behavior. Resync preserves planned scenes and distinguishes them from implemented behavior. The external agent resolves the target repository from the workspace or creator direction.

## Scene orchestration and rehearsal

With Mesh Foundry handoff enabled, the open scene card reads Foundry's current owner acceptance and shows exact revision IDs and unresolved selections, marked **Not live** with the last recorded state when Foundry cannot be read. A recorded sync is a snapshot kept as evidence. The owner can mark an unresolved required selection resolved from the card; Foundry's acceptance wins once it exists, and the earlier state stays in history. The agent preserves saved pins and the selected list. When every required selection is resolved, the planner proposes placement, camera or traversal, interactions, animation intent and checks, and saves the plan once the owner agrees in chat.

An agent then publishes a placeholder-only draft in Scene Rehearsal using the exact plan identity and stable piece IDs, records its link and content and spec digests on the card, and the owner reviews and accepts it in Rehearsal. The plan and accepted draft inform game implementation, where the implementer carries out model placement, collision, selection, final animation, and runtime checks. Rehearsal no longer imports or fits Foundry assets; earlier fit and candidate evidence remains available in scene history.
