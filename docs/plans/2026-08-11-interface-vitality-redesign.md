# Interface Vitality Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Revise with the Past feel alive, specific, and premium while preserving its calm document-led identity, accessibility, factual product language, and existing information architecture.

**Architecture:** Evolve the existing design system instead of replacing it. Build a small set of reusable interaction primitives, apply them first to the highest-value product moments, and keep expressive motion inside isolated client leaves. Preserve server rendering and current data flow. Use motion to communicate continuity, progress, feedback, and completion rather than decorating every surface.

**Tech Stack:** Next.js 16.2.6 App Router, React 19.2.4, TypeScript, Tailwind CSS 4, CSS custom properties, `motion/react`, Next.js React View Transitions where stable enough, Vitest for state logic, Playwright for browser and visual regression coverage.

---

## 1. Design read

Reading this as: a GCSE revision product for students who need calm, confidence, and proof, with a tactile document-workspace language leaning toward polished productivity software rather than a component-gallery aesthetic.

### Redesign mode

**Targeted evolution.** The existing information architecture, copy register, palette, paper artifact, and core flows are sound. The app does not need a new brand. It needs stronger interaction feedback, more expressive state transitions, better async choreography, and a few memorable signature moments.

### Design dials

| Surface | Design variance | Motion intensity | Visual density | Reason |
| --- | ---: | ---: | ---: | --- |
| Landing page | 6 | 6 | 3 | Marketing needs a memorable artifact and narrative without becoming experimental. |
| Paper builder | 4 | 5 | 5 | The flow should feel direct, responsive, and reassuring. |
| Marking dashboard | 4 | 4 | 6 | Data and next actions should remain easy to scan. |
| Marking workspace | 3 | 4 | 8 | This is a dense decision surface. Motion must clarify state, not compete with evidence. |
| Authentication | 5 | 5 | 3 | A short welcome moment is useful, but input remains the priority. |

### Product emotion

The intended emotional sequence is:

1. **Recognition:** this feels like a real exam paper, not a generic AI tool.
2. **Agency:** every selection responds immediately and remains reversible.
3. **Trust:** generation, OCR, AI suggestions, and confirmations visibly remain distinct states.
4. **Achievement:** completed actions settle into a clear paper artifact or confirmed mark.
5. **Momentum:** the next useful step appears naturally without celebratory clutter.

## 2. Current-state audit

### What already works

- `DESIGN.md` contains a coherent document-led visual direction.
- Indigo, mint, amber, and red already have semantic meaning.
- Manrope, Newsreader, and Geist Mono have clear roles.
- The landing hero uses real generated paper imagery rather than a fake dashboard.
- Paper builder and marking workspace preserve clear task hierarchy.
- Existing state colors distinguish confirmed, review, active, and failure states.
- `btn-press`, skeletons, reduced-motion handling, focus styles, and contextual errors provide a good baseline.
- The three-pane marking layout is specific to the product and should remain the central application pattern.

### Why it still feels plain

1. **Most state changes are hard swaps.** Stage changes, tab changes, selection changes, and async completion rarely preserve spatial continuity.
2. **The same interaction treatment is repeated everywhere.** Most buttons use a small scale press and color change, regardless of action importance.
3. **Loading is generic.** The global skeleton and small breathing dot do not explain whether the app is fetching topics, generating a paper, reading OCR, scoring, or saving.
4. **The paper artifact is visually strong but mostly passive.** It does not expand, focus, or connect to later product surfaces.
5. **Progress is shown but not felt.** Builder steps and question progress communicate state statically, but transitions do not explain forward, back, ready, or confirmed.
6. **Success is modal rather than transformational.** Generation and confirmation should visibly settle from the initiating control into the resulting artifact.
7. **Several equal-card grids flatten hierarchy.** Subject choice and marketing steps are readable but generic.
8. **Landing content initially depends on GSAP-applied visibility.** A fast automated capture showed the hero as blank before the reveal settled. Content must be visible without JavaScript and animation should be an enhancement.
9. **Large client components own both data behavior and presentation.** `paper-maker-workspace.tsx` and `marking-submission-workspace.tsx` make consistent interaction refinement difficult.
10. **The app lacks route-specific loading states and browser-level visual tests.** This makes polish regressions likely.

### Preserve

- Route structure and nav labels.
- Current copy voice and factual claims.
- Warm workspace canvas, indigo action color, mint confirmation color.
- Real paper imagery and restrained paper shadows.
- Square major sections and low-radius controls.
- Existing backend behavior and API contracts.
- AI suggestion versus confirmed score distinction.
- Current desktop marking pane proportions.

### Retire or reduce

- Generic scroll reveal on every marketing section.
- Undifferentiated `btn-press` use for every action.
- Generic spinner use where the system knows the operation.
- Equal emphasis across every subject card and workflow step.
- Hard stage swaps in the builder.
- Full-surface card borders when spacing and rules are enough.
- Runtime shader effects as general backgrounds.
- Decorative glows, liquid metal, persistent orbs, and page-wide particle fields.

## 3. Reference review and product fit

The rule is not to install or copy every reference. Each source is assigned one of four outcomes:

- **Adopt:** directly useful pattern, adapted to this product.
- **Adapt:** borrow the interaction principle or visual grammar, not the exact component.
- **Study:** quality bar or checklist only.
- **Reject:** does not fit the product, performance budget, or trust requirements.

| Reference | What was reviewed | Best fit in this app | Decision |
| --- | --- | --- | --- |
| Generative Loaders | 16 text, 18 inline, and 12 image-generation loaders; docs for stable streamed suffixes, elapsed time, accessibility, and primitive selection | Paper generation, OCR, auto-score, and mark-scheme loading should have operation-specific labels and stable prior content | **Adopt principles.** Build a product-specific `OperationProgress`, not all 46 variants. |
| Uiverse | Cloudflare blocked the visual site, so the MIT `uiverse-io/galaxy` source archive was reviewed instead: 1,231 buttons, 726 cards, 718 loaders, 260 switches, 226 inputs, 180 forms, plus checkboxes, tooltips, patterns, and notifications | A broad source of tactile CSS details and control state ideas | **Study only.** Quality is community-variable. Do not paste anonymous controls into the system. |
| Beautiful UI | Loading state, thinking traces, streaming text, approval card, tool chips, task rows, chat composer, recommendation cards, context cards, diff and records tables | AI suggestion approval, generation status, OCR task rows, and mark-scheme evidence | **Adapt.** Use the clear state hierarchy and approval grammar without importing the dark AI-dashboard look. |
| Arlan Vault | Emboss parameters and shader, Typer character-state wave, Liquid UI signed-distance unions, Fade Motion shader | Emboss is already a brand signature; Typer can provide one restrained headline settle | **Adopt emboss and adapt Typer.** Reject Liquid UI and Fade Motion for core product surfaces. |
| Transition Kit | View Transitions setup, circle reveal, 300ms fade, 500ms scale, and theme components | Directional builder navigation, route loading handoff, shared paper morphs | **Adapt with Next 16 React View Transitions.** Do not add dramatic theme wipes. |
| Checklist Design | Empty state, skeleton, loading, input field, upload media, input error, and saving changes checklists | Acceptance criteria for every redesigned state | **Adopt as QA criteria.** |
| Motion Primitives | Text effects, animated number, morphing dialog, animated background, scroll progress, expandable toolbar, magnetic interactions | Shared layout indicators, number changes, paper preview morph, success morph, compact toolbars | **Adopt selected patterns.** No magnetic controls in dense workspaces. |
| Top Welcome Screens | Ten authored React Native welcome sequences, deterministic timelines, reduced motion, semantic action IDs, and explicit refusal to invent unsupported motion | First account creation and first successful paper generation | **Adapt timing discipline only.** Code is GPL-3.0 and brand-inspired. Do not copy code, assets, brands, or long splash sequences. |
| Amicro | Buttons, card spreads, 3D carousels, loaders, dither charts, morph, sparkle, pulse, slide-arrow, copy, settings, delete interactions | Tactile primary actions, paper-stack hover, copy-success action swap | **Adapt selected micro-transitions.** Avoid gallery-style motion density. |
| Mint 3D | Interactive 3D playground and examples including periodic table, compound visualization, and memory constellation | No core task requires 3D | **Reject for production.** A Three.js scene would add weight without improving revision or marking. |
| Originkit | Text, button, border, image, gallery, cursor, interactive, animation, and background catalog; reviewed text unfold, brush reveal, cosmic orb, button carousel | Inspiration for the paper fan and one-off landing headline reveal | **Study and adapt composition only.** Avoid cursor effects, WebGL orbs, and dark demo styling. |
| React Bits Dot Field | Cursor bulge, sparkle, wave, glow, props, and background studio | A subtle exam-grid field could support the landing paper artifact | **Adapt as static or CSS-only texture.** Do not add a full interactive canvas behind reading content. |
| Thinking Orbs | Nine semantic states in 64px and 20px sizes with light and dark handling | A compact branded paper-dot indicator during generation and OCR | **Adapt one small state indicator.** Do not use as ambient decoration. |
| Paper Shaders | Paper texture, image dithering, dot grid, pulsing border, common props, and React package | Paper texture and dithered empty-state art | **Adapt as pre-rendered assets or CSS texture.** Runtime WebGL only if profiling proves negligible cost. |
| 21st.dev | Large catalogs for backgrounds, heroes, steps, tabs, uploads, empty states, dialogs, grids, and marketing blocks | Composition research for landing and workflow layouts | **Study only.** Source quality and dependencies vary by contributor. |
| beUI | Morphing modal, toast stack, action swap, tabs, switch, loader variants, bottom sheet, dock, and dynamic island | Success modal, save/copy actions, mobile action sheet, animated tab indicator, operation feedback | **Adopt selected open-source patterns after license verification.** Rebuild in project tokens. |
| dither-kit | Dithered area, bar, line, pie, and radar charts plus avatar, button, and gradient | No meaningful chart exists in the current product | **Reject for now.** Revisit only after real progress analytics exist. |
| Liquid Metal | WebGL metal border for buttons and controls with silver, gold, and chromatic presets | Conflicts with paper-led trust and the existing no-glow direction | **Reject.** |
| Border Beam | Animated beam in rotate and pulse variants, small and large sizes | A ready-state accent around the generation control | **Adapt very lightly.** One finite mint-to-indigo sweep when the brief first becomes valid, never an infinite glow. |
| DesEngs | Curated design-engineering resource index with flat rows and dense filtering | Quality bar for flat hierarchy and restraint | **Study.** No component to copy. |
| Interior Floating Label | Floating label plus inline validation, password strength, OTP, and expanding search | Auth validation and compact search behavior | **Adopt inline validation and password strength principles.** Keep labels above inputs; do not replace them with floating labels where clarity is better. |
| Nexvyn/UI | Async-aware action button, morph nav, subtle tabs, adaptive actions, fluid orb, accordion, mobile drawer | Async action state machine, responsive marking toolbar, shared indicator tabs | **Adopt action button, adaptive actions, and tabs principles.** Reject fluid orb for this brand. |
| Rare UI | Duration picker, scroll progress squircle, OTP, folder, bounce sidebar, and fluid orb | Number feedback and possibly duration editing | **Adapt number correction and shake feedback.** Do not import the multi-dependency gooey duration picker for a simple marks/time control. |
| Interaction Kit | Image expand, icon morph, search expand, spring button, hold-to-delete, tabs, highlight, tooltip, and code block | Paper preview expansion, tactile button, icon state morph, accessible tooltip | **Adopt selected patterns.** Hold-to-delete has no current product use. |
| trove/cn | Draggable switch, slider, animated checkbox, tabs, Base UI buttons, dialog, drawer, and tooltips | Direct-manipulation marks slider, animated checkbox, tab indicator | **Adapt slider and checkbox behavior.** Avoid adding Base UI solely for one control unless accessibility testing justifies it. |
| Design Engineer Tools | Curated component, motion, visual, font, utility, and engineering tools | Research index and ongoing quality references | **Study.** No runtime dependency. |

### Reference licensing gate

Before copying source from any external component:

1. Record repository URL, component URL, license, and attribution requirement in the implementation PR.
2. Prefer reimplementing a pattern from first principles using existing tokens.
3. Do not copy GPL-3.0 Top Welcome Screens code into this project.
4. Treat Arlan Vault as technique inspiration unless an explicit compatible license is found.
5. Review community components from 21st.dev, Uiverse, Originkit, Nexvyn/UI, Rare UI, Interaction Kit, and beUI individually. A catalog-level claim of openness does not replace per-component verification.
6. Never copy third-party branding, names, demo data, or visual identity.

## 4. Recommended direction: Living Paper

### Alternatives considered

#### A. Micro-polish only

Add better hover states, a few loaders, and smoother buttons without changing composition.

- Lowest risk and fastest.
- Does not solve the passive paper artifact, generic loading, hard stage swaps, or flat hierarchy.
- Likely to feel like more animation on the same plain screens.

#### B. Living Paper, recommended

Treat the paper as the persistent object that moves through the entire product: previewed on the landing page, assembled in the builder, downloaded and saved, reopened in marking, and resolved into confirmed evidence.

- Creates one memorable product-specific motion language.
- Reuses existing imagery and data rather than adding decorative assets.
- Allows micro-interactions to communicate real state.
- Preserves trust and performance if expressive effects remain local.

#### C. Experimental shader lab

Use orbs, dot fields, dithering, liquid metal, 3D, and page transitions as a broad new aesthetic.

- Visually dramatic.
- High bundle, GPU, accessibility, and brand risk.
- Makes an exam product look like an AI component gallery.
- Rejected.

### Signature interaction concept

A paper should appear to be **assembled, focused, reviewed, and confirmed**, not merely displayed.

- Selection draws a topic or source into the paper brief.
- Generation makes the paper brief become the finished artifact.
- Opening a saved paper preserves the paper thumbnail into its destination.
- Marking moves evidence into a decision.
- Confirmation settles the decision into the question rail and total.

This creates continuity across routes and tasks without adding decorative narrative copy.

## 5. Updated visual and motion system

### Color

Keep the current palette. Do not introduce a second accent.

- Indigo remains action, active selection, current question, and navigational continuity.
- Mint remains ready, downloaded, saved, confirmed, and earned evidence.
- Amber remains review and missing evidence.
- Red remains failure and destructive state.
- Add no neon variants. Any animated border uses existing indigo and mint at low opacity.

### Typography

Keep Manrope, Newsreader, and Geist Mono.

- Manrope handles all product controls and marketing copy.
- Newsreader remains limited to paper content and source excerpts.
- Geist Mono handles elapsed time, marks, paper codes, question counts, and state metadata.
- Animate numbers with tabular width stability.
- Use character motion on one landing headline phrase only.

### Shape

Preserve the current shape rules:

- Paper: 2-4px.
- Controls: 4-8px.
- Menus and dialogs: 8-10px.
- Mobile bottom sheets may use 16px top corners because they are platform overlays.
- Do not turn controls into a pill system. Pills remain compact state or segmented controls only.

### Motion grammar

| Tier | Duration | Easing | Use |
| --- | ---: | --- | --- |
| Instant response | 70-120ms | ease-out | Pointer down, check, icon swap, focus acknowledgement |
| Control transition | 160-240ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Tabs, selected backgrounds, menu, local content swap |
| Spatial continuity | 280-420ms | critically damped spring or matching cubic curve | Paper preview morph, stage direction, modal source-to-dialog |
| Async handoff | 450-700ms | exit fast, enter slower | Skeleton to content, generation completion, score confirmation |
| Ambient operation | operation-bound | linear progress or quiet loop | Generation, OCR, scoring only while work is in progress |

Rules:

- Every animation must communicate hierarchy, feedback, continuity, or state change.
- No infinite motion outside an active operation.
- No entry animation may hide core content before JavaScript runs.
- User input can interrupt every transition.
- Forward builder movement travels 12-20px left; back movement travels right.
- Same-place content changes crossfade rather than slide.
- Reduced motion removes translation, scale, blur, and loops while preserving color and opacity feedback.
- Reduced transparency turns the mobile action bar and menu surfaces solid.

## 6. Reusable interaction primitives

Create these before page-specific polish.

### `ActionButton`

A single async-aware button with explicit states:

```ts
type ActionState = "idle" | "pending" | "success" | "error";

type ActionButtonProps = {
  state: ActionState;
  idleLabel: string;
  pendingLabel: string;
  successLabel?: string;
  errorLabel?: string;
  disabled?: boolean;
  onPress?: () => void;
};
```

Behavior:

- Responds on pointer down.
- Keeps width stable across labels.
- Replaces the leading icon through a small shared-layout morph.
- Pending state uses operation-specific visual feedback.
- Success runs once, then settles or navigates.
- Error provides a retry path and never relies on color alone.

### `OperationProgress`

```ts
type OperationKind = "route" | "subject" | "paper" | "upload" | "ocr" | "score" | "save";

type OperationProgressProps = {
  kind: OperationKind;
  label: string;
  startedAt?: number;
  compact?: boolean;
};
```

- Uses stable text and optional elapsed time.
- Does not invent fake backend stages.
- Compact variant fits inside a button or table row.
- Full variant mirrors the final artifact shape.
- Uses one branded dot-orbit or paper-line assembly, not generic spinner variants.

### `MotionTabs`

- WAI-ARIA tab semantics.
- Roving focus and arrow-key navigation.
- Shared selected indicator.
- Panel crossfade for same-place swaps.
- No layout bounce when label widths differ.

### `MorphingSurface`

- Expands a paper thumbnail, success button, or evidence item into a focused dialog.
- Close returns to the source position.
- Focus trap, Escape, click-outside, scroll lock, and return focus are required.
- Falls back to a normal dialog when reduced motion is active.

### `AnimatedValue`

- For marks, duration, question counts, and totals.
- Keeps `aria-live` announcements separate from visual digit transitions.
- Uses tabular figures and no bounce for machine-updated values.
- A manual increment may use one restrained overshoot.

### `InlineNotice`

- Replaces scattered error and success blocks with a consistent inline state primitive.
- Supports `status`, `alert`, action, dismiss, and operation context.
- Toasts are reserved for completed transient actions. Recoverable failures stay inline.

### `AdaptiveActions`

- Measures available width with `ResizeObserver`.
- Keeps highest-priority actions visible.
- Moves overflow actions into a keyboard-accessible menu.
- Used only in the marking workspace utility row.

### `PaperPreview`

- One reusable visual for hero paper fan, dashboard thumbnail, generation success, and full-size preview.
- Supports stacked, single, selected, and loading states.
- Uses real images or actual PDF previews only.
- Never builds a fake exam page from decorative div lines.

## 7. Surface-by-surface plan

### Landing page

#### Hero

- Keep the current left-copy, right-artifact composition.
- Make the paper fan a real interactive preview group.
- On first load, papers settle from 10-18px offsets with no initial invisibility.
- On pointer hover or keyboard focus, one paper comes forward while the others recede 2-3 percent.
- Clicking a paper opens a morphing full preview with a factual caption and a close action.
- Apply the restrained Typer state-settle only to the final phrase of the headline. It runs once, never blocks reading, and becomes plain text immediately under reduced motion.
- Add a static exam-grid or paper-fiber texture around the artifact. No page-wide canvas.
- The CTA receives normal tactile feedback, not a magnetic effect.

#### Marking proof

- Keep the illustrative feedback example explicitly labeled as an example for assistive text.
- Reveal the response, earned points, and next focus in content order when entering the viewport.
- Animate `4 / 6` once with tabular digits.
- Do not animate all text character by character.

#### Workflow

- Replace the four equal isolated icons with one connected paper journey.
- The same small paper glyph changes state from blank, to written, to checked, to focused.
- The current step receives color as it enters the viewport; prior steps remain settled.
- On mobile, render a vertical sequence with no scroll hijack.

#### Subjects

- Keep board links and actual generated subject registry.
- Use an asymmetric featured row for the most common or first enabled subjects only if product data can justify the emphasis. Otherwise keep equal importance.
- On hover/focus, emboss contrast sharpens, the paper edge lifts 1px, and board actions reveal without changing card height.
- Do not use a marquee.

#### Final CTA

- Reuse the paper artifact at small scale so the final action feels like the completion of the page story.
- No second visual gimmick, shader, orb, or beam.

### App shell

- Keep header fixed as the spatial anchor during route transitions.
- Add a shared active-nav underline between Build and Mark.
- Use `useLinkStatus` for a delayed 100ms route-pending cue inside the active nav item.
- Morph user avatar into the menu origin. Keep menu motion under 220ms and return focus on close.
- Ensure the menu supports ArrowDown, ArrowUp, Home, End, Escape, and outside click.
- Keep route content transitions local. Never slide the shell itself.

### Paper builder

#### Builder progress

- Replace the static border switch with `MotionTabs`-style step navigation.
- Forward stage change: old content exits 12px left, new content enters 12px from right.
- Back stage change mirrors the path.
- Completed steps morph their number into a check.
- Focus moves to the stage heading only after the visual transition begins, without waiting for completion.

#### Subject selection

- Preserve exam-board grouping.
- Subject cards respond immediately on pointer down.
- Selection transforms the card arrow into a compact pending indicator while subject detail loads.
- The chosen subject visually lifts into the course summary through a shared element name where Next and React support is stable.
- Loading failure restores the card and announces retry context.

#### Topic selection

- Keep search permanently visible on desktop because the list is large. Do not use expanding search where it would hide a frequent control.
- Add a compact expanding-search treatment only on mobile.
- Checkbox checks draw in 120ms; parent indeterminate state crossfades.
- Selected counts and topic summary count animate without layout shift.
- Removing a selected topic collapses it from the summary and returns focus predictably.
- Make the selected-topic summary sticky only when it does not cover topic rows.

#### Paper setup

- Animate marks and time values with `AnimatedValue`.
- Improve the marks slider with a hover and drag value tooltip, keyboard increments, and a larger invisible touch target.
- Replace the static preset highlight with a shared selection background.
- Keep question mix options direct. The embossed icon may shift by 1px and sharpen when selected.
- Collapse source papers into an explicit advanced disclosure after defaults are selected. Preserve all current selection behavior.
- Show a finite mint-to-indigo border sweep around Generate only once when `canGenerate` first becomes true. It must not loop.

#### Generation

- Replace the breathing dot with `OperationProgress kind="paper"` and elapsed time.
- Keep all known, completed brief values visible during generation so the user retains context.
- Do not show invented phases such as selecting, typesetting, or saving unless the API reports them.
- On completion, morph the paper brief into the success surface.
- If save succeeds, settle to mint and show the saved action.
- If download succeeds but save fails, preserve the downloaded success and show save failure separately.
- The user can dismiss success and build another without waiting for an exit animation.

### Marking dashboard

- Turn PDF import into a true drop target with drag-enter, valid, invalid, uploading, processing, success, and error states.
- Show filename and restrictions before upload.
- Keep the existing input as the keyboard and assistive technology fallback.
- Make the featured paper thumbnail expandable through `MorphingSurface`.
- Preserve the flat saved-paper list. Animate only status, action state, and newly inserted attempts.
- Replace generic button spinners with `ActionButton` states.
- Improve the no-submission empty state with a small real paper preview or static dithered paper asset and two clear next actions: choose a saved paper or import a finished paper.
- Animate confirmed marks and current question changes, not dates or decorative metadata.

### Marking workspace

#### Navigation and orientation

- Keep the current question rail as the main progress model.
- Replace hard active marker changes with a shared selected indicator.
- Confirmed question changes settle from indigo to mint once.
- Review remains amber and does not pulse.
- Previous and next question changes use mirrored 12px content transitions.

#### Utility actions

- Replace the dense wrapping utility row with `AdaptiveActions`.
- Keep Source PDF and the highest-priority current operation visible.
- Move low-frequency actions into an overflow menu at narrower widths.
- Preserve labels in the menu. Do not reduce everything to unexplained icons.

#### Response pane

- Images remain uncropped.
- Clicking an answer scan opens an origin-aware full-size preview.
- OCR replacement crossfades from the placeholder to text.
- Upload, OCR, and retry states remain local to the affected question.

#### Mark-scheme pane

- Mark-scheme loading uses a text-line skeleton matching the eventual content.
- New evidence points enter in reading order with no stagger longer than 200ms total.
- Awarded and missing evidence use icon, label, and color.
- Never animate missing evidence to attract repeated attention.

#### Decision pane

- Restyle AI suggestion as an approval state inspired by Beautiful UI: suggestion source, confidence, rationale, and confirm action remain visibly grouped.
- Keep the score controls directly manipulable.
- Plus and minus respond on pointer down; disabled bounds remain obvious.
- Confirm action morphs into saved state, updates the rail, then presents the next question action.
- Saving failure restores editable state and keeps all entered values.
- Use a transient toast only after a confirmed save. Errors remain inline.

### Authentication

- Keep the split paper composition.
- Use a short authored first-visit welcome settle for account creation only. Do not run a splash sequence on every sign-in.
- Replace hard mode swap with a shared tab indicator and 180ms form crossfade.
- Keep labels above inputs.
- Adopt Interior-style inline validation that reserves message space so the form does not jump.
- Add password strength during sign-up only, with plain requirements and no fake score.
- Morph submit button from idle to pending to success.
- Route-pending copy remains visible if navigation takes longer than 100ms.
- Preserve current redirect safety and autofill behavior.

### Global loading, empty, error, and not-found states

- Split the generic global loading UI into route-shaped fallbacks:
  - builder skeleton mirrors subject board or paper setup layout;
  - dashboard skeleton mirrors featured paper and saved list;
  - submission skeleton mirrors question rail and three panes.
- Skeletons never use shadow and match final dimensions to prevent layout shift.
- Skeleton to content uses a short opacity handoff.
- Error screens keep context-specific recovery actions.
- The 404 may use one subtle paper-fold or page-number motion, with static fallback.
- Add a global error boundary only if Next 16 documentation confirms it is needed beyond the existing segment error.

## 8. Technical boundaries

### Animation library decision

Use `motion/react` for reusable product interactions and remove GSAP if it remains responsible only for simple landing reveals.

Reasons:

- Most chosen source patterns already use Motion concepts such as shared layout, `AnimatePresence`, motion values, and reduced-motion hooks.
- Current GSAP usage is limited to basic hero and viewport reveals that Motion or CSS can replace.
- One animation system is easier to tune and test.

Do not use Motion and GSAP to control the same elements. If GSAP remains temporarily, keep it isolated to `landing-motion.tsx` until that file is removed.

### Next.js 16 rules

Before implementation, reread these local docs because this project explicitly requires version-matched guidance:

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`
- `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`
- `node_modules/next/dist/docs/01-app/02-guides/production-checklist.md`
- `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md`

Implementation constraints:

- Keep pages and layouts as Server Components.
- Keep animation leaves as narrow Client Components.
- Do not move server data or secrets into client modules.
- Add route-specific `loading.tsx` files for dynamic routes.
- Use React View Transitions only behind Next's documented experimental flag and verify Safari behavior.
- Provide normal navigation behavior when View Transitions are unsupported.
- Keep the app shell fixed during directional content motion.
- Use `Link` for navigations and `useLinkStatus` for delayed pending feedback.

### Performance budget

- No Three.js.
- No runtime Paper Shader on content-heavy pages.
- No page-wide canvas.
- Maximum one small canvas effect on the landing page only if it remains under 20KB compressed code and does not affect LCP or mobile FPS. The default plan uses no canvas.
- Lazy-load full-size paper previews and non-critical motion components.
- Animate only transform and opacity.
- Keep LCP below 2.5s, INP below 200ms, and CLS below 0.1.
- Test a low-end mobile viewport and reduced motion.

## 9. Implementation tasks

### Task 1: Capture the baseline and add browser coverage

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/landing.spec.ts`
- Create: `tests/e2e/paper-maker.spec.ts`
- Create: `tests/e2e/auth.spec.ts`
- Create: `tests/e2e/accessibility-motion.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Install Playwright test support**

Run:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Expected: `@playwright/test` appears in dev dependencies and Chromium installs successfully.

**Step 2: Add production-like web server configuration**

Configure Playwright with:

```ts
webServer: {
  command: "npm run dev",
  url: "http://127.0.0.1:3000",
  reuseExistingServer: !process.env.CI,
},
use: {
  baseURL: "http://127.0.0.1:3000",
  trace: "retain-on-failure",
},
```

**Step 3: Write baseline flow tests**

Cover:

- Landing hero and CTA visible before waiting for animation.
- Paper builder subject stage loads and keyboard focus can select a subject.
- Auth mode switch preserves visible labels and inline errors.
- Reduced-motion context renders all core content and disables positional animation.

**Step 4: Run tests and confirm baseline behavior**

Run:

```bash
npx playwright test
```

Expected: flow tests pass. Any visual snapshots intentionally represent the current baseline.

**Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e
git commit -m "test: add interface regression coverage"
```

### Task 2: Update the design contract and interaction tokens

**Files:**
- Modify: `DESIGN.md`
- Modify: `app/globals.css`
- Create: `app/_components/ui/motion-tokens.ts`

**Step 1: Update `DESIGN.md`**

Replace the existing blanket motion restriction with the Living Paper grammar from Sections 4 and 5. Keep the bans on decorative loops, persistent glow, card walls, and speculative product claims.

**Step 2: Add named motion tokens**

Define only the shared timings and easings:

```ts
export const motionTokens = {
  press: { duration: 0.1 },
  control: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  continuity: { type: "spring", bounce: 0, duration: 0.36 },
} as const;
```

**Step 3: Add CSS motion and transparency fallbacks**

Add shared classes for stable press feedback, view-transition reduced motion, skeleton handoff, and solid material fallback.

**Step 4: Verify**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: both pass.

**Step 5: Commit**

```bash
git add DESIGN.md app/globals.css app/_components/ui/motion-tokens.ts
git commit -m "docs: define living paper interaction system"
```

### Task 3: Add the reusable interaction primitives

**Files:**
- Create: `app/_components/ui/action-button.tsx`
- Create: `app/_components/ui/operation-progress.tsx`
- Create: `app/_components/ui/motion-tabs.tsx`
- Create: `app/_components/ui/morphing-surface.tsx`
- Create: `app/_components/ui/animated-value.tsx`
- Create: `app/_components/ui/inline-notice.tsx`
- Create: `app/_components/ui/adaptive-actions.tsx`
- Create: `app/_components/ui/paper-preview.tsx`
- Create: `app/_components/ui/ui-state.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Add Motion**

Run:

```bash
npm install motion
```

**Step 2: Write failing state-machine tests**

Test:

- `ActionButton` labels and disabled behavior for idle, pending, success, and error.
- `OperationProgress` has a polite live region and never invents progress.
- `MotionTabs` exposes correct tab and tabpanel relationships.
- `AdaptiveActions` preserves priority ordering.
- `MorphingSurface` restores focus after close.

**Step 3: Implement the minimal primitives**

Keep each component focused. Do not create a general animation framework or theme provider.

**Step 4: Test keyboard and reduced motion in Playwright**

Add component usage to existing routes as hidden test fixtures only if necessary. Prefer testing through real product integrations in later tasks.

**Step 5: Verify**

Run:

```bash
npm run check
npx playwright test tests/e2e/accessibility-motion.spec.ts
```

Expected: all pass.

**Step 6: Commit**

```bash
git add package.json package-lock.json app/_components/ui
 git commit -m "feat: add reusable interaction primitives"
```

### Task 4: Polish the app shell and route handoffs

**Files:**
- Modify: `next.config.ts`
- Modify: `app/_components/app-shell.tsx`
- Modify: `app/_components/user-menu.tsx`
- Modify: `app/globals.css`
- Modify: `tests/e2e/paper-maker.spec.ts`
- Create: `tests/e2e/navigation.spec.ts`

**Step 1: Enable View Transitions only as documented by Next 16**

Use:

```ts
experimental: {
  viewTransition: true,
}
```

Preserve every existing Next config field.

**Step 2: Add the shared nav indicator and route pending cue**

Keep `AppShell` server-rendered. Isolate pending and indicator behavior in a small client child if required.

**Step 3: Fix menu keyboard behavior**

Add complete menu focus handling, Escape close, return focus, and active descendant movement.

**Step 4: Add anchored route transition CSS**

The header never moves. Route content may crossfade or move 12px only when links carry a deliberate transition type.

**Step 5: Test**

Run:

```bash
npx playwright test tests/e2e/navigation.spec.ts
```

Expected: Build and Mark nav remain usable with and without reduced motion; focus returns after closing the account menu.

**Step 6: Commit**

```bash
git add next.config.ts app/_components/app-shell.tsx app/_components/user-menu.tsx app/globals.css tests/e2e
 git commit -m "feat: add spatial navigation feedback"
```

### Task 5: Recompose landing motion around the paper artifact

**Files:**
- Modify: `app/_components/landing-page.tsx`
- Replace: `app/_components/landing-motion.tsx`
- Modify: `app/_components/typer/typer-text.tsx`
- Modify: `app/_components/typer/typer-text.module.css`
- Create: `app/_components/landing/paper-fan.tsx`
- Create: `app/_components/landing/workflow-paper.tsx`
- Modify: `app/globals.css`
- Modify: `tests/e2e/landing.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Write the failing landing tests**

Assert:

- H1 and CTA are visible immediately with JavaScript disabled.
- Paper previews are keyboard focusable and open a dialog.
- Dialog closes with Escape and returns focus.
- Reduced motion skips character and paper translation.
- Mobile workflow is vertical and does not overflow.

**Step 2: Build `PaperFan` from the existing real images**

Use `PaperPreview` and `MorphingSurface`. Preserve all current alt text and sizes.

**Step 3: Restrict Typer to one phrase**

The final DOM must contain readable text before animation. The effect runs once after hydration and settles to plain text.

**Step 4: Replace generic GSAP reveals**

Use Motion or CSS-enhanced visibility. Remove `gsap` and `@gsap/react` dependencies if no other code imports them.

**Step 5: Rework the workflow section**

Build one connected paper journey with explicit mobile collapse.

**Step 6: Verify and capture screenshots**

Run:

```bash
npm run check
npx playwright test tests/e2e/landing.spec.ts
```

Capture desktop 1440x1000 and mobile 390x844 screenshots.

**Step 7: Commit**

```bash
git add app/_components/landing-page.tsx app/_components/landing-motion.tsx app/_components/landing app/_components/typer app/globals.css package.json package-lock.json tests/e2e/landing.spec.ts
 git commit -m "feat: make the landing paper artifact interactive"
```

### Task 6: Add directional, stateful paper-builder interactions

**Files:**
- Modify: `app/_components/paper-maker-workspace.tsx`
- Modify: `app/_components/paper-maker/topic-tree.tsx`
- Create: `app/_components/paper-maker/builder-progress.tsx`
- Create: `app/_components/paper-maker/paper-setup-controls.tsx`
- Create: `app/_components/paper-maker/generation-state.tsx`
- Create: `app/paper-maker/loading.tsx`
- Modify: `tests/e2e/paper-maker.spec.ts`

**Step 1: Extract presentational regions without changing state ownership**

Move builder progress, paper setup controls, and generation presentation into focused components. Keep request functions, selection state, and generation flow in `PaperMakerWorkspace` for this pass.

**Step 2: Add tests for stage direction and focus**

Cover Subject to Topics, Topics to Paper, back navigation, disabled stage access, and heading focus.

**Step 3: Add subject pending and topic selection motion**

No state may disappear before the next state is ready.

**Step 4: Add animated values and direct slider feedback**

Test keyboard increment, bounds, linked marks/time updates, and reduced motion.

**Step 5: Add finite ready sweep**

Trigger only on the false-to-true transition of `canGenerate`. Do not replay on every render.

**Step 6: Replace generation dot with operation progress**

Keep the current result and failure branching exactly intact.

**Step 7: Add route-shaped loading fallback**

Mirror the subject or setup layout without speculative paper preview content.

**Step 8: Verify**

Run:

```bash
npm run check
npx playwright test tests/e2e/paper-maker.spec.ts
```

Expected: existing generation behavior is unchanged; visual feedback is complete for loading, success, partial save failure, and retry.

**Step 9: Commit**

```bash
git add app/_components/paper-maker-workspace.tsx app/_components/paper-maker app/paper-maker/loading.tsx tests/e2e/paper-maker.spec.ts
 git commit -m "feat: add living paper builder transitions"
```

### Task 7: Polish generation success and saved-paper continuity

**Files:**
- Locate and modify: the current `SuccessModal` implementation exported through `@/features/papers/client`
- Modify: `app/_components/paper-maker/generation-state.tsx`
- Modify: `app/_components/marking-dashboard.tsx`
- Modify: `tests/e2e/paper-maker.spec.ts`

**Step 1: Locate the exact SuccessModal source before editing**

Run:

```bash
rg -n "function SuccessModal|export .*SuccessModal" features app
```

**Step 2: Write result-branch tests**

Cover:

- anonymous download success;
- authenticated saved success;
- download success with save warning;
- paper and mark-scheme success;
- build another;
- open marking.

**Step 3: Replace the generic modal entrance with source-to-result continuity**

Use `MorphingSurface` or React View Transition. Maintain a normal dialog fallback.

**Step 4: Reuse `PaperPreview` on the dashboard**

The saved paper is the same visual object, not a newly styled card.

**Step 5: Verify and commit**

```bash
npm run check
npx playwright test tests/e2e/paper-maker.spec.ts
 git add features app/_components tests/e2e
 git commit -m "feat: connect generated papers to saved results"
```

### Task 8: Complete marking-dashboard states

**Files:**
- Modify: `app/_components/marking-dashboard.tsx`
- Create: `app/_components/marking/import-dropzone.tsx`
- Create: `app/_components/marking/saved-paper-row.tsx`
- Create: `app/marking/loading.tsx`
- Create: `tests/e2e/marking-dashboard.spec.ts`

**Step 1: Add authenticated browser fixtures or test helpers**

Do not weaken production auth. Seed a test user and controlled saved-paper/submission data through the existing supported test path.

**Step 2: Write upload-state tests**

Cover drag over, invalid type, processing, success navigation, error retry, and keyboard file selection.

**Step 3: Build `ImportDropzone`**

Follow Checklist Design upload criteria. Retain the native input.

**Step 4: Extract saved rows and replace action spinners**

Use `ActionButton`. Keep current routing and new-attempt behavior.

**Step 5: Add dashboard-shaped loading and empty states**

Do not use fake analytics or charts.

**Step 6: Verify and commit**

```bash
npm run check
npx playwright test tests/e2e/marking-dashboard.spec.ts
 git add app/_components/marking-dashboard.tsx app/_components/marking app/marking/loading.tsx tests/e2e
 git commit -m "feat: complete marking dashboard interaction states"
```

### Task 9: Add evidence-to-decision motion in the marking workspace

**Files:**
- Modify: `app/_components/marking-submission-workspace.tsx`
- Modify: `app/_components/marking/question-progress.tsx`
- Modify: `app/_components/marking/presentation.tsx`
- Create: `app/_components/marking/workspace-actions.tsx`
- Create: `app/_components/marking/response-preview.tsx`
- Create: `app/_components/marking/score-decision.tsx`
- Create: `app/marking/[submissionId]/loading.tsx`
- Create: `tests/e2e/marking-workspace.spec.ts`

**Step 1: Write workflow tests before extraction**

Cover question selection, upload, OCR, auto-score, AI suggestion, manual adjustment, confirm, save failure, previous, next, and reduced motion.

**Step 2: Extract presentation components**

Keep async functions and row derivation in the workspace until each extracted component has stable props. Do not introduce global state.

**Step 3: Add `AdaptiveActions`**

Test at 1440px, 1024px, 768px, and 390px.

**Step 4: Add scan preview continuity**

Use the real uploaded image and preserve uncropped display.

**Step 5: Reframe the decision pane as approval**

Visually distinguish AI suggestion, user edits, saving, confirmed, and retry states.

**Step 6: Connect score confirmation to progress rail**

Use a one-time indigo-to-mint settle. Announce confirmation through a polite live region.

**Step 7: Add route-shaped loading fallback**

Mirror the question rail and three-pane structure.

**Step 8: Verify and commit**

```bash
npm run check
npx playwright test tests/e2e/marking-workspace.spec.ts
 git add app/_components/marking-submission-workspace.tsx app/_components/marking app/marking tests/e2e
 git commit -m "feat: clarify evidence and score transitions"
```

### Task 10: Polish authentication states

**Files:**
- Modify: `app/_components/auth-form.tsx`
- Create: `app/_components/auth/auth-field.tsx`
- Create: `app/_components/auth/password-strength.tsx`
- Create: `app/_components/auth/auth-mode-tabs.tsx`
- Modify: `tests/e2e/auth.spec.ts`

**Step 1: Write validation and motion tests**

Cover blur validation, submit validation, sign-up password requirements, mode switch, pending, server error, success, redirect, autofill names, and reduced motion.

**Step 2: Extract a reusable field**

Reserve error message space. Keep visible labels above controls.

**Step 3: Add sign-up password strength**

Requirements are factual and deterministic. Do not add a decorative strength score.

**Step 4: Add shared tab and submit state transitions**

Keep the form usable throughout and do not delay the redirect for animation.

**Step 5: Verify and commit**

```bash
npm run check
npx playwright test tests/e2e/auth.spec.ts
 git add app/_components/auth-form.tsx app/_components/auth tests/e2e/auth.spec.ts
 git commit -m "feat: polish authentication feedback"
```

### Task 11: Audit all interaction states and copy

**Files:**
- Modify as findings require: `app/_components/**/*.tsx`
- Modify: `app/error.tsx`
- Modify: `app/not-found.tsx`
- Modify: `app/loading.tsx`
- Create: `docs/interaction-state-matrix.md`

**Step 1: Inventory every key action**

For each action, record idle, hover, focus, active, disabled, pending, success, error, retry, keyboard, reduced motion, and mobile behavior.

**Step 2: Complete missing states**

Prioritize generation, upload, OCR, score, save, sign-in, subject loading, topic empty search, and route loading.

**Step 3: Copy audit**

Remove duplicate error sentence in `app/error.tsx`. Verify every AI-related label preserves suggestion versus confirmed meaning. Avoid invented certainty, metrics, or source claims.

**Step 4: Verify**

Run:

```bash
npm run check
npx playwright test
```

Expected: all state-matrix rows are complete or explicitly deferred.

**Step 5: Commit**

```bash
git add app docs/interaction-state-matrix.md
 git commit -m "fix: complete product interaction states"
```

### Task 12: Performance, accessibility, and visual QA

**Files:**
- Modify as findings require: `app/**/*`, `tests/e2e/**/*`
- Create: `docs/qa/interface-vitality-report.md`

**Step 1: Test browser sizes**

- 390x844 mobile
- 768x1024 tablet
- 1024x768 small laptop
- 1440x1000 desktop
- 1920x1080 wide desktop

**Step 2: Test input modes**

- Keyboard only
- Touch emulation
- Fine pointer hover
- Reduced motion
- Increased contrast where supported
- Reduced transparency where supported
- 200 percent zoom

**Step 3: Run the full checks**

```bash
npm run check
npm run build
npx playwright test
```

Expected: all pass.

**Step 4: Run Lighthouse against production build**

Targets:

- Performance 90 or higher on landing and builder.
- Accessibility 95 or higher on all public routes.
- LCP below 2.5s.
- INP below 200ms.
- CLS below 0.1.

**Step 5: Audit bundle changes**

Confirm Motion is tree-shaken by route and GSAP has been removed if no longer used. Confirm no shader, Three.js, or unnecessary component-library dependency entered the bundle.

**Step 6: Record evidence**

Document screenshots, test commands, reduced-motion results, known browser differences, and any intentionally deferred enhancements.

**Step 7: Commit**

```bash
git add docs/qa tests/e2e app
 git commit -m "test: verify interface vitality redesign"
```

## 10. Rollout order

Ship in four reviewable milestones:

1. **Foundation:** Tasks 1-4. Interaction primitives, tests, shell, tokens.
2. **Acquisition and creation:** Tasks 5-7. Landing, builder, generation result.
3. **Review and decision:** Tasks 8-10. Dashboard, marking workspace, auth.
4. **Hardening:** Tasks 11-12. State matrix, accessibility, performance, visual QA.

Do not implement all references at once. At the end of each milestone, test with five real tasks:

- Start a paper from the landing page.
- Choose a subject and topics using keyboard only.
- Generate and download a paper.
- Import or open a paper for marking.
- Confirm one score and move to the next question.

## 11. Success criteria

The redesign is successful when:

- The app remains recognizably Revise with the Past.
- Users can tell what the system is doing during every wait longer than 300ms.
- The paper visually persists across marketing, generation, saving, and marking.
- Builder direction and marking progress are understandable without reading every label.
- AI suggestions never look confirmed before user action.
- No core content starts hidden and no route appears blank while animation initializes.
- Every important action has hover, active, focus-visible, disabled, pending, success, error, and retry behavior where applicable.
- Reduced-motion mode preserves comprehension and feedback.
- The redesign adds only one animation dependency and removes GSAP if possible.
- Landing and builder hit the performance budgets.
- No visual effect exists only because a reference site looked impressive.

## 12. Explicit non-goals

- No dark-mode redesign in this pass. The product currently has a deliberate light document-workspace theme. Dark mode can be a separate project after paper readability is designed properly.
- No Three.js scenes.
- No persistent liquid metal, glow, particle, orb, or shader background.
- No gamified streaks, confetti, fake analytics, badges, or progress claims.
- No route or API changes.
- No copy overhaul.
- No speculative exact generation phases without backend events.
- No broad component-library adoption.
- No new dashboard charts.
- No changes to exam source claims or marking authority.
