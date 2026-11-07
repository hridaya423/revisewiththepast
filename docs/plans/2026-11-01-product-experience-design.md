# A paper worth coming back to

Revise with the Past: product experience specification, 1 November 2026.

**Recommendation:** build the most dependable place to turn a focused practice paper into feedback a student understands. Make starting easy, keep work safe through interruptions, and make the reason for every mark inspectable.

This is a proposed design, ready for implementation review. It is not a claim that the redesign has shipped or been validated with students.

Companion documents:

- [Research and current-state evidence](2026-11-01-product-experience-research.md)
- [Implementation sequence and checks](2026-11-01-product-experience-implementation.md)
- [Perfection review and open questions](2026-11-01-product-experience-review.md)

## 1. The product decision

Reading this as: a study workspace for GCSE students, whose job is to complete useful practice and understand their mistakes, using the existing calm, document-led identity.

Three approaches were considered:

| Approach | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Restyle the existing screens | Fast visual consistency | Leaves interrupted jobs, upload ambiguity, and fragmented completion intact | Insufficient |
| Redesign the complete paper journey | Makes the current product materially easier to use; builds on the PDF engine | Requires persistence and state work alongside UI | **Recommended** |
| Build an all-in-one adaptive tutor | Broad long-term promise | Requires validated scoring, content, mastery modelling, and more product surfaces | Separate future programme |

**Depth: full redesign of the task-screen composition.** Keep the course registry, paper generation, source fidelity, authentication, scoring contracts and established brand vocabulary wherever their behaviour is sound. Recompose the screens around the student's work. This is not a cosmetic polish pass.

The October Phase 2 implementation and its unbuilt evaluation set remain separate context. The present request authorises a research and planning package. This plan does not quietly reopen the evaluation set, claim scoring validity, or implement the October Phase 3 mastery system.

## 2. Who this must work for

Primary user: a student in a supported GCSE course, revising independently on a phone or laptop, often with paper and pen beside them.

Design for three situations:

1. “I have twenty minutes and know what topic I need.”
2. “I finished this paper. Help me see what earned marks.”
3. “I got interrupted. Put me back where I was.”

Secondary users are tutors and teachers preparing or reviewing a paper. Their needs should improve export quality and clarity, without making every student face class-management controls.

No compulsory onboarding questionnaire. Ask for course and tier when needed. Do not ask for target grade, school, precise age, or exam date merely to personalise a greeting.

## 3. The signature experience

### A. One paper keeps its identity

Course, topics, actual marks, estimated duration and artifact identity stay consistent from setup through result, library, and review. The student never wonders which paper a mark belongs to.

The setup summary is a compact text summary. Once generation finishes, a real page preview takes its place. This is the one earned visual transition: specification becomes document. Before generation, the interface does not pretend to know the selected questions.

### B. A mark points to its reason

Review opens on one question. The response is the largest object. The relevant scheme point sits beside it, followed by the suggested or confirmed mark. Selecting an evidence item identifies the supporting text or scan region **only when a verified location exists**.

Without reliable coordinates, use a quoted text excerpt with a page reference and an explicit “Location unavailable” state when relevant. Never draw an authoritative highlight at a guessed position.

### C. Returning is effortless

The student returns to their selected course and topics, a running generation job, or the last question they were reviewing. A failed request leaves the input available. A partial result remains useful.

These three moments are the product's character. They deserve more investment than an animated dashboard, a new mascot, or a catalogue of effects.

## 4. Product objects and action scope

| Object | Meaning | Main actions | Recovery rule |
| --- | --- | --- | --- |
| Course | Board + subject + tier where applicable; later specification/cohort | Choose, change | Changing it invalidates incompatible selection explicitly |
| Draft | Course/topic/length choices | Edit, reset, restore | Store only non-sensitive preferences locally; validate before restoring |
| Generation job | Work producing one or more papers and optional schemes | Inspect, stop, retry, open result | Durable server state is authoritative |
| Practice paper | Immutable question selection plus available artifacts | Open, download, save, start attempt | Retry artifact access without regenerating questions |
| Attempt | A student's work on a paper | Resume, upload, review | A new attempt is explicit; opening a paper does not silently create another |
| Response | Typed or uploaded answer attached to question(s) | Add, inspect, correct mapping | File removal and remapping identify the affected answers |
| Mark | A suggestion or a human-confirmed decision | Inspect, edit, confirm | Only server-acknowledged confirmed marks count as confirmed |
| Evidence | Scheme criterion and supporting/missing answer information | Inspect, open source | Provenance and missing evidence remain visible |

Destructive reset is local to the named object. “Reset topics” must not erase saved papers or an attempt. “Stop generation” must not revoke an already completed paper without a specific reason.

## 5. Information architecture

Preserve routes during the first release:

| Route | User-facing name | Purpose |
| --- | --- | --- |
| `/` | Revise with the Past | Explain the practice journey and supported courses |
| `/paper-maker` | Build a paper | Course → Topics → Length → Generation → Result |
| `/paper-maker?job=<opaque-id>` | Paper preparation/result | Stable return point, subject to access checks |
| `/marking` | My papers | Saved papers and attempts, ordered by useful next action |
| `/marking/[submissionId]` | Review answers | One paper, one active question, evidence and decision |
| `/auth?redirect=…` | Sign in / Create account | Return to the initiating task after authentication |

The app shell has **Build** and **My papers**. Review is a contextual destination within a paper. On mobile, retain text labels and a 56px header; do not introduce a bottom navigation bar that competes with the task action bar.

Existing external links to `/marking` remain valid. Do not rename URLs just to match cleaner navigation copy.

## 6. Screen specifications

### 6.1 Landing: show a coherent practice journey

Purpose: help a visitor decide whether the available courses and workflow fit their need.

- Keep the existing identity and left-copy/right-paper composition.
- Suggested headline: **“Practise the topics you need.”**
- Supporting copy: “Build a focused paper for your course. Check your answers and decide what to practise next.”
- Primary action: **Build a paper**. Secondary: **See an example paper**, only when a valid example artifact is available.
- Use one coherent course and paper in the hero. Show a readable detail and page context rather than an overlapping mix of unrelated subjects.
- Follow with a real product capture of the review experience once that feature is built. Until then, any worked example must be visibly labelled “Illustrative example”.
- Show the actual enabled course directory as compact subject/board rows. Search or grouping may grow with coverage; avoid an oversized rotating subject selector.
- Explain AI suggestions beside the review demonstration: “Suggested marks are yours to check.” Do not promise examiner equivalence.
- Footer needs useful support and policy destinations, plus existing product/docs links. Do not fabricate policies or add dead links.

The main action and course coverage must be understandable without playing motion. No text typing loop on the core promise. Marketing proof should be captured from the implemented product, with permission to use the underlying content.

### 6.2 Builder: three clear decisions

Desktop working width: 1180px inside the existing 1440px shell. Page heading at 36px/44px, one short description at 16px/24px, compact progress at the same upper edge.

**Course**

- Board controls stay text-labelled and keyboard navigable.
- Course rows show subject and supported tiers. Use a small existing subject emboss only where it helps recognition.
- For returning visitors, show the last course as a shortcut above the catalogue.
- “Not sure of your board?” opens concise guidance to check a timetable, course document or teacher. It does not guess.
- Unsupported courses are clearly absent or labelled unavailable. A directory configuration file is not evidence of working generation.

**Topics**

- Desktop: 256px syllabus section rail and flexible topic list; selection summary beneath or to the right only when space permits.
- Mobile: one accordion hierarchy, selected-topic count, and a separate expandable “Selected topics” view. No nested scroll panes.
- Search matches labels/codes and preserves checked topics when the filter changes.
- A group checkbox shows mixed state when only some leaves are selected.
- The summary labels “Remove [topic]” as an action; clicking a bare selected topic should not unexpectedly remove it.
- Zero results: “No topics match ‘…’.” Actions: clear search or change course.
- No selected topics: a visible explanation near Continue. Do not leave an unexplained disabled button.
- If a course supports mixed practice but not topic selection, bypass the Topics step with an explicit mixed-paper summary.

**Length**

- Desktop: 2:1 form/summary split with a 24px gap. Mobile: summary follows the form and remains expandable above the action.
- Primary choice: 20, 40, 60 minutes, plus Custom, constrained by supported course values. These are time presets, not claims about exam completeness.
- Marks and time keep the current linked-calculation behaviour. Editing one identifies it as the constraint; the other is labelled an estimate.
- Question mix, source-paper choice, and number of papers live under **More options**. Preserve advanced control without presenting it as compulsory.
- Keep the course/tier/topic summary visible. Mark the time as estimated and the mark target as a target until generation resolves the actual selection.
- Use one filled **Create paper** action. Include-mark-scheme is a labelled choice next to it, defaulting to the current supported product behaviour until the user chooses a different default.

At every stage: Back preserves valid choices, browser Back agrees with the visible stage, and an explicit subject link takes precedence over an old local draft. Encode the visible stage in a validated `stage=subject|topics|paper` query parameter, retaining existing `subject`, `tier` and `topics` deep-link support. Push history for a deliberate stage change; replace it for typing and corrections. An invalid or unreachable requested stage resolves to the earliest incomplete step. A `job` parameter selects the authorised job/result view rather than restoring an unrelated draft.

### 6.3 Generation: progress without captivity

Generation occupies the paper-summary area, with a compact status line available after navigation. It is not a full-screen visual performance.

Show a current stage and useful counts: “Preparing paper 1 of 2”, “Preparing mark scheme”, “Preparing download”. The backend currently reports stage-weighted progress, not elapsed-time completion. Prefer stages and counts; if a percentage remains, label it as progress and do not imply an ETA.

- Acknowledge the action in the next rendered state, before waiting for the server.
- Stop is a normal text button. Its pending state says “Stopping…”.
- During an uncancellable processing segment, say “Stopping after the current step” only when the backend actually has that behaviour.
- A cancellation/completion race resolves to the authoritative server result. A completed artifact stays available.
- Leaving the page never silently cancels a durable job. A navigation confirmation is unnecessary once recovery works.
- A missing/expired job offers to rebuild from preserved settings. An unauthorised job does not reveal its subject, filename, or status.
- A failed scheme does not erase the question paper. Present each available artifact and the specific retry action.

Keep the current blocking experience until persistence is implemented. A new non-blocking presentation must not precede the storage guarantees.

### 6.4 Paper ready: a useful destination

Replace the transient success dialog with a stable result section/address.

The real paper preview anchors the left side. A compact summary and artifact actions sit on the right. Actual question count, marks and estimated duration replace target values. For multiple papers, show a list with each paper's identity and availability.

Primary action: **Download paper**. Secondary actions: **Open paper**, **Download mark scheme** when available, and **Review answers**. A combined pack remains an explicit convenience, not the only artifact: students should be able to open a question paper without immediately exposing answers.

Statuses distinguish:

- Paper ready.
- Mark scheme ready / still preparing / unavailable.
- Saved to My papers / not saved / save failed.

Do not announce “Downloaded” as a fact. A browser can reject or redirect a download. A repeatable download control is the recovery path.

After sign-in, return to this exact paper and complete the intended save. Do not replace the specific paper with a generic `/marking` redirect. Guest access expiry must be described using the actual server policy.

### 6.5 My papers: start with unfinished work

Top priority is the most recent unfinished attempt with one **Continue review** action. If none exists, lead with a saved paper awaiting an attempt. If the library is empty, lead with **Build a paper**.

Use a flat list with title, course, date, actual marks, and state. Search/filter can wait until the list size warrants them. Each row exposes one primary next action and a quiet download/open action.

Distinguish “6 of 12 questions reviewed” from “18 of 30 reviewed marks awarded”. The full paper denominator must not make unreviewed questions look like zero scores.

Use a static preview with a fixed aspect ratio only for the featured paper. Ordinary rows need no image. Missing thumbnail falls back to title and metadata, not a failed-image icon or an embedded PDF viewer.

No streak, mastery wheel, grade forecast, or empty analytics graph. “Practise these topics” can use confirmed gaps already supported by the system; it must say which paper those gaps came from.

### 6.6 Upload: identity before automation

Choose files or take a photo where the browser supports it. The ordinary file picker remains available. Display thumbnails, upload state, file rejection reason, and removal controls.

For a generated paper, show a mapping step: **Page 1 → Questions …**. One page may contain several questions, and one question may span several pages. Do not label file-order assignment as automatic recognition.

Minimum release supports explicit mapping and bulk processing of mapped responses. Automatic page recognition, HEIC conversion, image cleanup and handwriting editing are separate enhancements unless the supported contract already supplies them.

Reject unsupported formats and limits before starting work where possible, then validate again server-side. Duplicate-file warnings preserve the option to use the same page for multiple answers. Upload retries target the failed file rather than restarting the entire batch.

An answer upload is private. Do not persist its bytes or extracted text in localStorage, public analytics, share links, or marketing captures.

### 6.7 Review: response, evidence, decision

Desktop ≥1280px: a compact question rail above the workspace; 52/28/20 proportions where minimum readable widths fit. The score area uses a 240px minimum; the evidence area 280px; remaining space belongs to the response. If they do not fit, switch layout rather than shrinking text.

Tablet 768–1279px: response and evidence in two columns; score action below the evidence. Question navigation remains above both.

Mobile <768px:

- Header: question label, review progress, Previous/Next.
- Stable labelled tabs: **Answer**, **Mark scheme**, **Feedback**.
- Footer: current suggested/confirmed score and one relevant action.
- Answer tab starts fit-to-width; Zoom and Reset view are explicit. Never crop handwriting with `object-cover`.
- Switching tabs retains each panel's scroll position and the active question.
- Score edits use a 16px field in a normal form. No modal is required for ordinary editing.

Suggested score label: **AI suggestion · 3 / 5**. Confirmed score label: **Confirmed · 3 / 5**. Mark availability is controlled by the saved question/validated imported scheme, not an unlabelled editable maximum.

Primary action for a suggestion: **Confirm mark**. On server acknowledgement, update the state and expose **Next question** in the same place. Do not move to the next question automatically while the student may still be reading feedback.

Editable marks validate blanks, negatives, non-finite values, permitted increments, and maximum at both client and server boundaries. Save errors keep the entered value and show Retry.

Feedback hierarchy:

1. Marks awarded and status.
2. The concrete criterion met or missed.
3. The supporting answer excerpt/source where available.
4. One actionable improvement grounded in existing evidence.

Freeform model rationale must not be silently converted into verified quotation. No automatic bulk confirmation based on confidence. “Needs review” prioritises work; it does not certify the other suggestions as correct.

After the final confirmation, show the reviewed total and a small topic list for further practice. A “Practise these topics” action opens a prefilled draft for inspection. It does not start an unexpected new job.

## 7. Visual and brand system

Keep the existing name, folded-paper mark, Manrope, Newsreader, Geist Mono and indigo/warm-paper palette. This proposal does not require a logo replacement.

| Role | Specification |
| --- | --- |
| Application canvas | `#F5F1E8`; large surrounding surface |
| Paper and form fields | White; paper has 3px radius and restrained shadow |
| Main ink | `#0D1734`; primary reading and headings |
| Body / warm-canvas secondary copy | `#35415F` |
| Muted copy on white | `#657087`; not normal-size text on warm canvas |
| Action / selected | `#4747D8`; pressed `#3535B2`; white text |
| Confirmed | `#0A6B4F` text; mint may be a background with dark ink |
| Needs review | Existing amber semantics plus text/icon |
| Error | Existing danger semantics plus message and recovery |
| Layout scale | 4, 8, 12, 16, 24, 32, 48, 64px |
| Control shape | 6px radius; ordinary touch height ≥44px; primary action 48px |
| Typography | 12/16 metadata; 14/20 labels; 16/24 body/input; 20/28 section; 28/36 mobile title; 36/44 desktop title |
| Paper reading | Newsreader at 18/28 or original source image; never restyle the source's mathematical meaning |
| Numeric values | Tabular numerals; Geist Mono for marks/codes, not every caption |
| Icons | Existing lucide-react, 20px at 1.75px stroke in ordinary controls; text names remain available |
| Focus | Visible outline separated from the control edge; verify against each surface |

Surface hierarchy: whitespace first, then a rule, then a tonal well, then a container. Only floating overlays and paper need shadows. One page has one dominant filled action in its current task context.

Brand application checks for implementation: 16/24/32px glyph, mobile shell, monochrome print cover, reversed footer, and grayscale evidence labels. Any necessary monochrome logo variant should preserve the existing silhouette and be reviewed as a small brand task. Do not invent alternate monograms.

Light mode is the first-release system. Dark mode is a separately designed extension, not an automatic inversion of white exam sheets.

## 8. Motion contract

Reuse `motion-tokens.ts` and the matching CSS variables. Motion is subordinate to immediate state feedback.

| Interaction | Timing/behaviour | Reduced motion / interruption |
| --- | --- | --- |
| Pointer press | Existing 100ms token, scale 0.97 on eligible buttons | Colour feedback only; no motion on keyboard activation |
| Field, checkbox, selected tab | 200ms, existing `[0.16, 1, 0.3, 1]` curve | Immediate state; opacity/colour may remain |
| Builder stage | 200ms, ≤8px directional translation, new heading receives focus | Immediate replacement and focus; rapid Back/Next cancels prior transition |
| Dialog/panel | 200ms enter, 160ms exit; focus moves immediately | No displacement; content remains readable |
| Generated paper continuity | Existing 360ms, bounce 0, only when the real result arrives | Immediate real preview; never delay Download for the animation |
| Evidence selection | Immediate outline/tint and conditional scroll into view | Instant scroll where appropriate; no animated scan pan |
| Job progress | Animate transform, not growing layout width; real server stages only | Text stage changes; no infinite decorative loop |
| Route navigation | Preserve shell, show pending state, render new content promptly | Functional without View Transitions support |

No duplicated CSS plus Motion press transform on the same button. No stagger across study content. No automatic page transitions after confirm. No scroll hijacking, typewriter promises, particle fields, sound effects, or looping decorative loaders.

Existing 360ms continuity is reserved for an occasional document transition; ordinary menus and controls remain under 300ms.

## 9. State and recovery contract

| State/input | Required outcome |
| --- | --- |
| Course/topic fetch pending | Stable region with a status message; no previous course's selectable topics |
| Fetch fails | Retry in place, retain valid selection, no raw backend error |
| Course/tier changes | Validate against new available leaves/papers; explain removed selections once |
| Old draft or invalid query parameters | Restore valid values only; visible correction; never generate silently |
| Rapid duplicate Create/Confirm | One operation per idempotency key; UI pending state |
| Refresh during generation | Reattach to authorised durable job; do not start another |
| Browser Back during editing | Correct visible stage and compatible selections |
| Offline before Create | Preserve draft; tell the student to reconnect |
| Disconnect during generation | Job may continue; reconnect and reconcile before Retry |
| Cancel after completion | Show result if completion won; cancel must not rewrite success |
| Paper succeeds, scheme fails | Keep paper; show scheme unavailable and isolated retry |
| Receipt/save fails | Download remains available; “Not saved” and a specific save retry |
| Guest signs in | Preserve paper intent; claim/save through a verified access path |
| Session expires during marking | Keep non-sensitive navigation context; reauthenticate; restore server-saved answers |
| Score changes in another tab | Detect revision mismatch; reload current server score before overwriting |
| Upload partly succeeds | Keep successful files and mappings; retry failures individually |
| Unreadable/empty response | Ask for a clearer upload or manual review; do not imply zero marks |
| No marking evidence | Display suggestion with limitation or manual marking path, never fabricated citations |
| Unsupported source/paper | Clear scope statement with compatible choices |
| Long names/translation | Wrap metadata; full title available; actions remain usable |
| Zoom, soft keyboard, safe area | Current field and action visible; no fixed footer over focused content |
| Print/download unavailable | Open artifact fallback; retry when possible; no claim of completed download |

## 10. Technical promises the UI depends on

Keep the existing architecture: Next App Router, React, Tailwind, Convex, the PDF generation services, and Motion. Read the installed Next.js guides before code; the repository explicitly requires it.

**Drafts:** a versioned, validated `BuilderDraft` containing subject, tier, selected leaf IDs, source paper codes, target mode/value, mix, paper count and current stage. Persist only these preferences; the proposed default expires them after seven days without use and exposes Clear saved choices. URL intent overrides stored state. Do not store answers, secrets, signed artifact URLs or access capabilities in this draft.

**Jobs:** durable job metadata in Convex, with execution in a restart-aware worker suitable for the existing Node/PDF dependencies. Scheduling a Convex Node action is the first option to test; verify canvas/PDF compatibility and execution limits before committing to it. If it cannot run there, keep Convex as the job source of truth and use a dedicated Node worker. Do not rely on a detached promise after an HTTP response.

**Access:** authenticated jobs attach to the owner. Guest jobs require an unguessable capability kept out of share URLs and logs, preferably an HttpOnly same-site cookie, with an explicit expiry and a verified claim path after sign-in. Proposed guest-result lifetime: 24 hours, subject to the storage/runtime validation in implementation Task 6. The server returns the actual expiry; UI copy never hard-codes a different guarantee. Artifact endpoints enforce the same access. Opaque IDs alone are not an authorisation scheme.

**Artifacts:** persist question-paper and mark-scheme references separately, plus an optional combined pack. Availability is explicit. Durable metadata alone is not recovery if the PDF bytes remain in process memory.

**Marks:** preserve separate suggestion and confirmation states. Add an expected revision for conflicting saves if absent. Confirmed totals update from server acknowledgement. Evidence locations are optional and validated against the actual response/page.

**Uploads:** map page IDs to question IDs, allowing many-to-many relationships. Show the mapping before OCR/scoring. Whole-paper processing should use existing atomic scoring boundaries; automatic mapping is not a dependency for a clear manual mapping UI.

**Request safety:** generation, upload and model-processing limits remain enforced server-side. A resumed status fetch consumes no new generation allowance. A new generation or isolated scheme retry must reserve the appropriate quota exactly once. Cancellation is an authorised state-changing request with origin/CSRF protections appropriate to the authentication mechanism; use POST rather than a destructive GET. Private job and answer responses must not enter public caches.

## 11. Delivery boundary and UK expansion

The first release is complete when a student on a supported course can:

1. Build a focused paper with clear defaults.
2. Leave and return to generation/result without duplicate work.
3. Open or download the exact paper and available scheme.
4. Attach and map answers with a recovery path.
5. Review suggestions and explicitly confirm marks on a phone.
6. Resume the exact unfinished task.

Deferred: predictive grades, mastery scores, adaptive scheduling, cross-subject planners, AI chat, native apps, teacher administration, payments, social features, broad qualification rollout, and the marking evaluation set.

UK expansion follows evidence:

- Start with accurately described supported courses.
- Choose one expansion cohort using real demand and content readiness, rather than adding every board name.
- Version coverage by qualification, board, specification, tier/route, language and cohort.
- Separate WJEC Wales/Eduqas identity and Scottish National Qualifications.
- Verify source rights, matching schemes, paper integrity, accessibility and relevant marking scope for each new offer.
- Publish coverage only when that exact course works. AQA/OCR/Edexcel support does not mean every UK learner is covered.

## 12. Acceptance and research targets

These are proposed gates, not observed results.

| Area | Acceptance evidence |
| --- | --- |
| First paper | At least 8 of 10 invited target students can select their course/topics and reach generation without assistance; measure time separately from server work |
| Mark understanding | At least 8 of 10 can explain whether a displayed mark is suggested or confirmed and find the reason for one missed mark |
| Recovery | Forced refresh, disconnect, worker restart and expired session tests preserve the documented state; no duplicate paper/confirmation |
| Mobile | Inspect 320, 390, 768 and 1440px; real iOS Safari and Android Chrome before release; keyboard open, landscape and 200% zoom |
| Accessibility | WCAG 2.2 AA target; zero known serious/critical automated violations on representative states, plus manual keyboard/screen-reader review |
| Responsiveness | Field p75 targets: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1, segmented by device; controlled lab results are interim evidence |
| Generation | Record real p50/p95 by subject, pack size and scheme option; no universal duration promise before measurement |
| Animation | Inspect a mid-range device trace for input delay and long frames; no offscreen loops or leaked work after navigation |
| Product success | Track generated → artifact opened → attempt started → first confirmed question → review completed; keep definitions and denominators explicit |

User research uses original or permitted example content and a private test environment. Recruit a small mix of Foundation/Higher students, phone-first students, and students with access needs. Teachers can inspect curriculum fit. This is usability research, not the excluded scoring evaluation set.

Do not log response text, scans, freeform rationales, school names or precise personal identifiers in product analytics. A minimal event contains an event name, coarse route/device context, opaque operation correlation, timestamp and non-sensitive result code. Consent and retention depend on the actual implementation.

A weekly reviewed-practice measure is more useful than time spent in the app. Increased usage alone is not evidence of improved learning.
