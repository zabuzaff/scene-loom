# Scene Loom design direction

## Approved direction

**After Hours**, selected by the owner from three interactive previews, with an explicit request for flashier fonts. Image-led and spacious: near-black graphite canvas, dark grey cards, off-white text, pale blue accents, and a bold, wide studio wordmark. The intended character is effortless confidence rather than the previous warm olive/serif boutique-studio treatment. Scene Loom retains its own identity regardless of the game's art style.

The canvas occupies the workspace. Avoid dashboard metrics, large navigation sidebars, decorative charts, marketing sections, excessive pill controls, and generic gradient-heavy styling. Scene cards are necessary product objects, not an anti-pattern to remove.

## Interaction proposal

- A collapsed scene shows its main image, title, and clearly discoverable prompt actions.
- Search results select and expand their scene with the same focus transition as canvas activation; selecting an already-open result refocuses it. The search field has no heavy input outline.
- Open details through a smoothly expanding card body. Keep the image visually anchored; descriptions, notes, and supporting images become readable at useful zoom.
- Opening details must not automatically rearrange the board. Evaluate overlap using a branched example before finalizing expansion behavior.
- Dragging must not accidentally open a card or trigger a copy button. Text selection and detail scrolling must not pan the canvas.
- Motion should make expansion, selection, copying, and updates understandable. Avoid idle moving arrows, constant glow effects, or transitions that delay interaction.
- Preserve keyboard focus, readable contrast, and useful button labels. Reduced-motion implementation is explicitly out of scope at the owner's request.

## References researched during discovery

- Milanote storyboarding: https://milanote.com/product/storyboarding — image-first visual material and generous workspace.
- React Flow custom nodes: https://reactflow.dev/learn/customization/custom-nodes — custom interactive image cards within a graph.
- Motion layout animations: https://motion.dev/docs/react-layout-animations — smooth size/position transitions. Test inside a transformed canvas; isolate Motion transforms from React Flow's positioning transforms.
- Impeccable: https://github.com/pbakaus/impeccable — approved design/refinement skill. Installed globally, not vendored; availability on a different machine is not guaranteed.

Use the references for specific interaction and craft decisions, not as templates. Review a rendered canvas with real scene images before claiming visual completion.

## Implemented canvas surface

Mode: Operate with artwork-led exploration. Main task: read a software storyboard, inspect one scene, and carry a targeted next instruction back to the creator’s preferred agent.

- Typography: locally hosted Syne Variable at weight 800 for the wordmark and welcome headline, 700 for canvas/help headings, and 600 for scene titles. Its widening at heavier weights gives the requested expressive identity without using effects or novelty lettering in long text. DM Sans Variable handles controls, descriptions, notes, and connection labels, carrying forward the readable UI voice in the approved preview.
- Tokens live in client/tokens.css: ground #101215, header #15181c, scene surface #20242b, raised surface #1b1f26, primary text #edf0f3, secondary text #a2a9b4, pale blue accent #abbcff, and borders #343a45. Supporting surfaces and interactive states use the same central token set.
- Card corners are 10px. Labels, text, and expansion affordances identify states independently of color; the owner has reported some color-vision difficulty. Avoid introducing color-only status distinctions.
- Cards are 300 canvas units wide with a fixed image area and natural-height details. Main images use proportional cover cropping; supporting images retain their own links to full display copies.
- Signature interaction: details expand inside the card over 280 ms; explicit expansion then smoothly focuses that scene. This changes the camera, never the saved card arrangement. Live agent updates do not trigger this focus behavior.
- React Flow owns outer positioning; Motion animates only the inner detail body. Connection measurements are refreshed during expansion. Only one card is expanded at a time.
- Desktop canvas controls recede around the art. Search and update focus are local canvas actions; the header switches game projects without adding board layers.

The final code-led surface and captured states were independently reviewed for consistency with this direction. There was no approved raster comp or automated design-detector run.

## Studio mark and browser identity

The original Scene Loom mark uses two linked scene frames in the pale blue accent color. Its code-native vector source is public/scene-loom-mark.svg; the same asset appears in the header and empty state. Browser variants use the charcoal ground behind the mark. Run npm run icons after changing the source to regenerate favicon.svg, favicon.ico, favicon-32.png, apple-touch-icon.png, and icon-512.png. Do not replace the mark with a stock UI icon.

The browser theme matches the header (#15181c), with application-name and description metadata. The active project title appears as “Game title — Scene Loom”; an empty studio uses “Scene Loom — Storyboard studio”.

## After Hours verification

Rendered inspection used isolated, disposable visual QA data, never the owner's game project. Captures at /private/tmp/scene-loom-after-hours-qa include empty-desktop.png, canvas-desktop.png, scene-open-laptop.png, canvas-compact.png, and header-narrow.png. Actual loaded fonts were verified as Syne Variable and DM Sans Variable. Measured text contrast: primary text on cards 13.6:1 and secondary text on the canvas 7.9:1. The 390px header fits within the viewport. Core browser regressions pass. See progress.md for final review status.

## Project Vision surface

Mode: Read within the studio's Operate workspace. The project-title area exposes Project Vision; the project picker exposes a persistent Copy new project starter prompt action. An accessible nonmodal side panel uses the existing raised surface, close/Escape behavior, focus restoration, and scrollable long-form content. The canvas remains mounted beneath it. Confirmed decisions, assumptions, exclusions, original intent, references, and naming research are separate readable sections. Missing vision shows an adoption prompt; a saved vision without scenes remains readable. Help and vision panels are mutually exclusive. New-project prompts never carry an existing project target.

With Mesh Foundry enabled, scene cards expose a full-width **Copy asset-generation prompt** action beneath Continue/Edit, keeping all three actions readable at the existing card width. It uses the same clipboard feedback and prevents card activation/dragging. Copying works in both collapsed and expanded states; it preserves expansion and layout.
