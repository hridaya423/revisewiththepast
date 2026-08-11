# Revise with the Past: Polished Document Workspace

## Product direction

Revise with the Past is a calm, document-led GCSE workspace. The generated paper is the central visual object across marketing, building, marking, and print. The product should feel like a polished productivity tool: crisp, spacious, and precise rather than decorative or dashboard-heavy.

Copy stays factual and concise. Do not invent results, testimonials, metrics, source claims, or student progress. Indigo means action or current state, mint means ready or confirmed, amber means review, and red is reserved for errors.

## Color

- Primary action: `#4747D8`
- Primary pressed state: `#3535B2`
- Ready action and confirmation: `#62E2B6`
- Marketing hero canvas: `#ECE9E1`
- Application canvas: `#F5F1E8`
- Neutral sections: `#F8F7F4`
- Paper: `#FFFFFF`
- Ink: `#0D1734`
- Body: `#35415F`
- Muted text: `#657087`
- Hairline: `rgba(13, 23, 52, 0.12)`
- Footer: `#101A38`
- Earned evidence: `#0A6B4F`
- Missing evidence: `#946200`

Indigo is the primary action color. Mint is reserved for confirmed or ready states rather than primary navigation. Subject colors may tint small embossed subject icons but should not wash across whole sections.

## Typography

- Use Manrope for product UI and marketing copy.
- Use Newsreader only for exam questions, source excerpts, and paper content.
- Use Geist Mono only for codes, labels, marks, dates, and tabular data.
- Marketing display type is 42–76px. Application page titles are 34–48px.
- Product body copy is 14–17px. Persistent metadata must not be smaller than 12px.
- Avoid marketing eyebrow copy. Small labels are reserved for functional metadata such as paper codes, marks, and workflow state.

## Layout and surfaces

- The hero uses the warm off-white canvas, a concise promise on the left, one indigo action, a quiet secondary link, and a large document artifact anchored on the right.
- Application screens use a flush 64px white shell and a 1440px maximum working width.
- The builder begins with an exam-board-grouped Subject step. Topics use a two-pane specification browser on desktop and an accordion on mobile. Paper setup uses a form-and-summary split without reserving space for a speculative live preview.
- The marking workspace uses a 52/28/20 response-to-evidence-to-decision split.
- Workflow, subject directories, saved papers, and evidence lists are flat rule-separated structures.
- Evidence examples are clearly illustrative and never presented as live student results.
- Product artifacts may use real source-page or generated-paper imagery for marketing proof, but the builder should not imply that an exact paper preview exists before generation.
- Subjects are generated from the enabled paper-maker subject registry and displayed as compact entries with embossed subject icons and direct board links.
- Avoid nested card walls. Use flat tone changes, borders, and one restrained paper shadow to establish hierarchy.
- The footer is deep navy and contains only useful navigation and a concise product description.

## Shape, elevation, and motion

- Major sections have square corners.
- Paper uses 2–4px corners; controls use 4–8px; menus and dialogs use at most 10px.
- Only paper, scanned responses, menus, and dialogs may cast a shadow.
- Treat the paper as the persistent object across preview, building, generation, saving, and marking.
- Use motion only for immediate feedback, spatial continuity, progress, and completion.
- Press feedback lasts 70–120ms, local control transitions last 160–240ms, and shared paper transitions last 280–420ms.
- Forward builder movement travels slightly left, back movement mirrors it, and same-place content changes crossfade.
- Core content must be visible before JavaScript runs. Motion enhances the rendered state rather than revealing an initially blank page.
- Infinite motion is allowed only while an operation is actively running.
- Reduced motion removes translation, scale, blur, and loops while preserving color and opacity feedback.
- Never use decorative floating loops, persistent glow, glassmorphism, page-wide particle fields, or spring-heavy entrances.

## Accessibility and responsive behavior

- Keep a descriptive page heading, landmark structure, visible focus styles, and keyboard-accessible links.
- Keep primary actions large enough for touch input and preserve readable line lengths.
- Keep the primary generation and confirmation actions reachable on mobile.
- Never crop student response scans.
- Respect reduced-motion preferences for shared interaction styles.

## Do not

- Do not introduce gradients, pill spam, fake analytics, badges without state meaning, or repeated rounded containers.
- Do not claim source material is official unless the product can substantiate that claim.
- Do not present AI-suggested marks as confirmed marks.
- Do not show a generated-question preview as exact before the generation process has selected the questions.
