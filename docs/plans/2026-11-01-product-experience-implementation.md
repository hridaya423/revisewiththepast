# Product experience implementation plan

> **For the implementing agent:** invoke `handoff` in receive mode, then `executing-plans`. Execute task by task. Update `progress.md` with observed evidence. Preserve pre-existing work. Commit only if requested.

**Goal:** make building, receiving and reviewing a practice paper readable, recoverable and coherent on phone and desktop.

**Architecture:** retain Next App Router, existing application/domain services, Convex persistence and the current design tokens. Replace transient UI state with validated drafts and durable generation artifacts where the experience requires it. Recompose existing task screens around paper identity, response evidence and explicit confirmation.

**Tech stack:** Next 16.2.6, React 19.2.4, Tailwind 4, Convex, better-auth, Motion, lucide-react, Vitest and Playwright.

**Authority:** [design specification](2026-11-01-product-experience-design.md). [Research](2026-11-01-product-experience-research.md) records the evidence and limitations. `DESIGN.md` remains the existing style map until implementation proves the revised system.

## Scope and sequence

The earlier Phase 2 work is already present in a dirty working tree. This plan extends the experience; it is not permission to reset or replay that work. The marking evaluation dataset and evaluator remain excluded.

| Milestone | Tasks | User-visible outcome | Exit gate |
| --- | --- | --- | --- |
| M0: reliable starting point | 0–1 | Working core routes, recorded baseline and truthful failure recovery | No unresolved blocker on course selection |
| M1: coherent builder | 2–5 | Readable shell, stable preferences, fewer setup decisions | First-use journey works at 390px and by keyboard |
| M2: dependable paper delivery | 6–8 | Durable generation, explicit artifacts, return after sign-in | Restart/refresh and partial-failure checks pass against real persistence |
| M3: usable review | 9–12 | Library, explicit page mapping, mobile review, evidence and confirmation | One permitted paper completes end to end |
| M4: public proof and release candidate | 13–15 | Honest landing, measured performance, reviewed access needs | Evidence packet and unresolved-risk review |

Critical path: route availability → state contracts → durable execution/storage → result recovery → complete practice/review journey. Styling and review composition can proceed against private fixtures while job durability is being proved, but the UI must not advertise guarantees the backend lacks.

Planning estimate: roughly 25–40 engineering days for one experienced engineer, plus user research and external launch dependencies. This is a sizing hypothesis. Re-estimate after Tasks 0 and 6; runtime compatibility, private storage and page mapping are the largest uncertainties.

## Execution rules

- Start with `git status --short`; the baseline includes many unrelated modified files.
- Run `npm ci`; read relevant installed guides under `node_modules/next/dist/docs/` before code. Read routing, loading/error, data fetching, font and metadata guides when touching those areas. Do not substitute remembered Next APIs.
- No current `test:e2e` npm script exists. Use `npx playwright test …`.
- Use existing tests where suitable. Add tests for behaviour and failure recovery, not for every spacing or copy change.
- A failed test must fail for the behaviour being changed, not because a module import or backend is missing.
- For each task, write a focused regression first when it changes behaviour; run it red; implement; run it green. Inspect screenshots for visual work.
- Use a local/private Convex development environment and original/permitted sample content. Do not deploy Convex functions or change public data as an incidental verification step.
- No subagents, commits, public deployment, messages, recruitment invitations or policy publication are implied by this document.

## Task 0: establish a runnable, attributable baseline

**Files:** inspect `package.json`, `package-lock.json`, `AGENTS.md`, `playwright.config.ts`, `app/paper-maker/page.tsx`, `app/error.tsx`, `features/papers/infrastructure/question-bank.ts`, `shared/infrastructure/env/server.ts`. Record in `progress.md`; create `docs/plans/evidence/2026-11-01-experience-baseline.md`.

1. Record branch/HEAD and the dirty-file list. Keep the snapshot local; do not include environment values.
2. Run `npm ci`. Manifest and lockfile root dependency declarations matched during planning; do not rewrite the lockfile unless installation proves a mismatch.
3. Read installed Next guides and inspect the documented development configuration.
4. Run `npm run check`. Record pre-existing failures separately from this work.
5. Run `npx playwright test tests/e2e/landing.spec.ts tests/e2e/paper-maker.spec.ts tests/e2e/auth.spec.ts`.
6. Reproduce the deployed builder failure in a private local environment if possible. Capture the server exception/request ID and failing dependency without exposing secrets. Compare with the working landing route.
7. Patch only the proven root cause. If local passes and production fails, leave a deployment/configuration diagnosis with evidence; do not invent a source fix.
8. Repeat the same failing reproduction. Gate: course selector and one real subject-detail fetch work, or the environmental dependency is precisely identified for the owner.

**Expected evidence:** a dated local baseline, not a claim that the existing production failure is fixed by a prettier error screen. Public deployment is a later decision.

## Task 1: make loading and errors useful

**Modify:** `app/error.tsx`, `app/_components/paper-maker-workspace.tsx`, `app/_components/paper-maker/paper-maker-stages.tsx`.
**Create if absent:** `app/paper-maker/loading.tsx`, `app/marking/loading.tsx`.
**Test:** `tests/e2e/paper-maker.spec.ts`, `tests/e2e/navigation.spec.ts`.

1. Add a regression for subject-detail failure and successful Retry. Assert the previously selected course is still identified, stale topics cannot be selected, and recovery returns the list.
2. Run `npx playwright test tests/e2e/paper-maker.spec.ts`; confirm the specific missing recovery behaviour fails.
3. Implement stable loading regions, safe errors, Retry and a Home escape route. Remove duplicate error prose and unsupported preservation claims.
4. Run the focused tests and inspect loading/error at 390 and 1440px.
5. Verify keyboard focus remains visible after Retry and after returning to a stage.

**Gate:** a transient failure does not create a dead-end page or silently expose a different course's data.

## Task 2: consolidate type, controls and motion values

**Modify:** `app/globals.css`, `app/_components/ui/action-button.tsx`, `app/_components/ui/inline-notice.tsx`, `app/_components/ui/operation-progress.tsx`, `app/_components/ui/motion-tokens.ts`, `app/_components/auth-form-view.tsx`, `DESIGN.md`.
**Test:** `app/_components/ui/ui-state.test.ts`, `tests/e2e/accessibility-motion.spec.ts`.

1. Inventory existing tokens and shared controls. Map design roles to the current CSS/Tailwind system.
2. Implement the specification's type scale, 16px inputs, 44/48px controls and allowed colour pairings. Use `text-secondary` for normal-size copy on the warm canvas.
3. Keep one press implementation per control. Preserve the existing 100/200/360ms tokens, with reduced-motion and keyboard behaviour.
4. Run `npm run test -- app/_components/ui/ui-state.test.ts` and `npx playwright test tests/e2e/accessibility-motion.spec.ts tests/e2e/auth.spec.ts`.
5. Inspect pending, error, disabled, hover and focus states on each relevant surface. Recalculate contrast for rendered alpha/overlay combinations.
6. Update `DESIGN.md` with rules verified by the rendered implementation. It is currently gitignored; preserve that repository choice unless the owner asks to track it.

**Gate:** readable labels, no keyboard-motion delay, no doubled scale transform, no normal-size muted-on-warm text.

## Task 3: clarify shell and route continuity

**Modify:** `app/_components/app-shell.tsx`, `app/_components/shell-nav-link.tsx`, `app/_components/user-menu.tsx`.
**Test:** `tests/e2e/navigation.spec.ts`, `tests/e2e/accessibility-motion.spec.ts`.

1. Add keyboard navigation checks for Build and My papers, including active state and a skip link to the main region.
2. Run `npx playwright test tests/e2e/navigation.spec.ts`.
3. Rename the `/marking` navigation label to My papers. Keep route URLs and auth boundaries intact. Ensure the shell fits 320px.
4. Provide immediate pending feedback with the existing Next link pattern. View Transitions remain progressive enhancement.
5. Rerun both focused specs; inspect unsupported-view-transition fallback and reduced motion.

**Gate:** navigation does not depend on animation support or a symbol-only mobile control.

## Task 4: persist and validate the builder draft

**Modify:** `app/paper-maker/page.tsx`, `app/_components/paper-maker/state-model.ts`, `app/_components/paper-maker/paper-maker-workspace-controller.ts`, `app/_components/state-boundaries.test.ts`.
**Create:** `app/_components/paper-maker/builder-draft.ts`.
**Test:** existing state-boundary test and `tests/e2e/paper-maker.spec.ts`.

1. Define `BuilderDraft` version 1: subject key, tier, leaf IDs, source codes, source customisation, target mode, marks, minutes, mix, paper count, stage, updated timestamp. Serialise sets as arrays.
2. Extend state tests for malformed JSON, unknown version, removed topics, changed tier, invalid numerical values, unavailable localStorage and explicit URL intent taking precedence.
3. Run `npm run test -- app/_components/state-boundaries.test.ts`.
4. Implement parsing/validation against current subject detail and bounded storage retention. Restore only after compatible detail loads; avoid briefly displaying stale topics. Use the current reducer, not a new state framework.
5. Parse and validate `stage` in the page boundary and synchronise deliberate stage changes with history. Add a Playwright refresh/Back/Forward test with selected topics. Explicit course change clears incompatible state and announces what changed.
6. Run `npm run test -- app/_components/state-boundaries.test.ts` and `npx playwright test tests/e2e/paper-maker.spec.ts`.

**Gate:** reload restores valid choices. There are no answer bytes, tokens, signed URLs or private marking data in localStorage.

## Task 5: recompose Course, Topics and Length

**Modify:** `app/_components/paper-maker-workspace.tsx`, `app/_components/paper-maker/paper-maker-stages.tsx`, `app/_components/paper-maker/paper-setup-controls.tsx`, `app/_components/paper-maker/paper-setup-model.ts`, `app/_components/paper-maker/topic-tree.tsx`, `app/_components/paper-maker/topic-tree-model.ts`, `app/_components/paper-maker/builder-progress.tsx`, `app/_components/paper-maker/generation-state.tsx`.
**Test:** `tests/e2e/paper-maker.spec.ts`, `app/_components/state-boundaries.test.ts`.

1. Add behaviour tests for filtered selection persistence, mixed group checkboxes, zero matches, no selection, and courses without topic selection.
2. Run the state tests and builder Playwright spec.
3. Build the layout in specification §6.2 using current components. Introduce only named child components that remove actual responsibilities from the large stage component.
4. Add time presets and More options. Keep source filters, paper count and mix available. Mark estimates and actual values distinctly.
5. Put one primary action in the mobile footer with safe-area padding. Reserve enough document space so the last focused field is not hidden.
6. Inspect 320, 390, 768 and 1440px, long topic labels, 200% zoom and the open soft keyboard. Rerun the same regressions.

**Gate:** a student can build a supported topic paper without interacting with advanced controls, while advanced users retain their choices.

## Task 6: prove durable execution and artifact storage

**Modify:** `features/papers/builder/infrastructure/jobs/generation-jobs.ts`, `features/papers/builder/infrastructure/http/generation-jobs.ts`, `convex/schema.ts`.
**Create:** `convex/generationJobs.ts`, `features/papers/builder/infrastructure/jobs/generation-jobs.test.ts`.
**Conditional worker target:** `convex/generationWorker.ts` if a Convex Node action proves compatible; otherwise `scripts/generation-worker.ts` for a dedicated Node process.
**Preserve:** `convex/generationReceipts.ts` and the current paper-generation application/domain APIs.

1. Write job-transition tests: duplicate start, duplicate worker delivery, failed scheme, completion/cancel race, worker lease expiry and owner mismatch. Run `npm run test -- features/papers/builder/infrastructure/jobs/generation-jobs.test.ts`.
2. In a private dev environment, run one allowed paper through a Convex Node action spike using the actual PDF/canvas dependencies. Record compatibility, memory/runtime bounds and retry behaviour.
3. Choose the executor from that evidence. Persist records and use scheduled execution or a worker queue. A detached HTTP promise is not an executor.
4. Define durable job fields: request snapshot, owner/guest access hash, status, stage, completed/total counts, attempt number, lease/revision, cancellation request, timestamps, expiry, safe failure code and artifact references.
5. Persist artifact bytes in private durable storage. Add separate question/scheme outputs and an optional combined pack. Keep receipt validation for saving.
6. Add idempotent execution/checkpoints and a bounded retry policy. Cooperative cancellation checks precede the next unit of work; terminal success is immutable.
7. Run the transition tests, then start a real job, stop/restart the executor, and resume/poll from a separate process. Open the resulting PDF and verify it contains the expected paper.

**Gate:** real restart evidence and accessible PDF bytes, not just a mocked green test. If the worker cannot finish within hosting limits, the deployment model needs an explicit owner decision before shipping. This uncertainty blocks resumption claims, not independent UI work.

## Task 7: authorise job recovery and sign-in continuation

**Modify:** `app/paper-maker/page.tsx`, `app/api/paper-maker/[[...path]]/route.ts`, `features/papers/builder/infrastructure/http/generation-jobs.ts`, `features/papers/builder/presentation/api-client.ts`, `features/papers/client.ts`, `app/_components/paper-maker/paper-maker-workspace-controller.ts`, `app/_components/auth-form-model.ts`, `app/_components/auth-form.tsx`, `convex/generationJobs.ts`.
**Create:** `features/papers/builder/infrastructure/http/generation-jobs.test.ts`.
**Test:** new HTTP tests and `tests/e2e/auth.spec.ts`, `tests/e2e/paper-maker.spec.ts`.

1. Add tests for missing/incorrect guest capability, another owner, expired access, claim-after-sign-in, malicious redirect, and repeated claim.
2. Run `npm run test -- features/papers/builder/infrastructure/http/generation-jobs.test.ts`.
3. Implement access checks for start/status/cancel/download/claim and wire claim in the catch-all router. Use an HttpOnly guest capability with server-side hash and explicit expiry. Do not place capability secrets in URLs. Enforce private/no-store responses, permitted origins for mutations and existing generation quotas; status polling does not reserve another generation.
4. Use `?job=` for the stable return point. Reconcile persisted state before offering Retry; retries use an explicit new operation key when they really start new work.
5. Preserve the exact paper intent through same-origin auth redirects. On claim, attach the existing permitted job/paper to the owner idempotently.
6. Run tests; confirm two private test users cannot read each other's job status or artifacts. Inspect network requests/logs for accidental capabilities or answer content.

**Gate:** a stable URL restores a result only for a permitted viewer. Sign-in does not lose the selected paper.

## Task 8: replace blocking generation and transient success

**Modify:** `app/_components/paper-maker-workspace.tsx`, `app/_components/paper-maker/paper-maker-workspace-controller.ts`, `app/_components/paper-maker/paper-assembly-modal.tsx`, `app/_components/ui/operation-progress.tsx`, `features/papers/builder/presentation/success-modal.tsx`, `features/papers/builder/presentation/types.ts`, `features/papers/builder/presentation/api-client.ts`, `features/papers/builder/infrastructure/jobs/generation-jobs.ts`.
**Create:** `app/_components/paper-maker/paper-result.tsx`.
**Test:** `tests/e2e/paper-maker.spec.ts`.

1. Add route-state regressions for pending → ready, pending → cancelled, failed scheme with ready paper, download retry, save retry and refresh on result.
2. Run the builder spec. Use deterministic HTTP fixtures for UI states and one real private-backend recovery test for the storage promise.
3. Replace modal captivity with inline progress after Tasks 6–7 pass. Retire the old assembly/success components only when no import remains.
4. Extend the existing result type with job and per-artifact availability. Expose `paper-N`, `scheme-N` and combined downloads; the current job file path only exposes combined and individual question papers.
5. Render stable result actions and actual summary values. “Paper ready” replaces the unsupported “downloaded” assertion.
6. Verify stop/completion races, Escape from secondary dialogs, focus placement, repeated download and guest sign-in return.

**Gate:** navigation/refresh never starts an accidental duplicate job. A failed scheme/save does not hide a usable paper.

## Task 9: make My papers a return point

**Modify:** `app/marking/page.tsx`, `app/_components/marking-dashboard.tsx`, `convex/marking.ts`, `convex/savedPapers.ts`.
**Optional preview fields:** `convex/schema.ts` only if a durable thumbnail is produced.
**Create:** `tests/e2e/marking.spec.ts` because there is no current marking browser spec.

1. Add private fixtures for empty library, saved paper without attempt, unfinished attempt, fully reviewed paper and failed list request.
2. Run `npx playwright test tests/e2e/marking.spec.ts`.
3. Implement flat rows and one Continue action. Preserve explicit “new attempt” semantics and existing denormalised summary counters.
4. Remove PDF iframe thumbnails. Use an available static preview or text fallback; ordinary rows need no preview.
5. Present reviewed question count and confirmed-mark denominator separately. Do not show unreviewed work as a zero.
6. Verify empty, error, long-title and partial-review screenshots; confirm each row opens the exact paper/attempt.

**Gate:** returning users can find and resume unfinished work without creating another submission.

## Task 10: make page-to-question mapping explicit

**Modify:** `app/_components/marking-submission-workspace.tsx`, `app/_components/marking-workspace-sections.tsx`, `app/_components/marking/model.ts`, `features/papers/marking/contracts/http.ts`, `features/papers/marking/infrastructure/http/uploads.ts`, `features/papers/marking/infrastructure/convex/commands.ts`, `convex/marking.ts`, `convex/schema.ts`.
**Create:** `app/_components/marking/upload-mapping.tsx`.
**Test:** `features/papers/marking/application/uploads.test.ts`, `features/papers/marking/contracts/http.test.ts`, `tests/e2e/marking.spec.ts`.

1. Test unsupported files, a failed upload among successful files, one page serving two questions and one question using two pages.
2. Run `npm run test -- features/papers/marking/application/uploads.test.ts features/papers/marking/contracts/http.test.ts`.
3. Introduce explicit page/question associations without duplicating stored file bytes. Validate page/question ownership and subject identity server-side.
4. Backfill existing one-question page records into the compatible association shape in a private test deployment. Plan production migration separately; preserve historical attempts.
5. Implement thumbnail mapping review, per-file Retry/Remove, and a clear processing action. Remove unconfirmed file-index assignment.
6. Test with original sample images: out-of-order pages, repeated file, several questions on one page and a multi-page answer. Run the marking browser spec.

**Gate:** the student can correct mapping before OCR/scoring, and retry does not duplicate successful pages.

## Task 11: recompose review for desktop and phone

**Modify:** `app/_components/marking-submission-workspace.tsx`, `app/_components/marking/active-question-panel.tsx`, `app/_components/marking/question-progress.tsx`, `app/_components/marking/presentation.tsx`.
**Create:** `app/_components/marking/response-panel.tsx`, `app/_components/marking/evidence-panel.tsx`, `app/_components/marking/score-panel.tsx`.
**Test:** `tests/e2e/marking.spec.ts`, `tests/e2e/accessibility-motion.spec.ts`.

1. Add tests for question navigation, panel state preservation, visible keyboard focus, mobile tab semantics and footer visibility.
2. Run both browser specs.
3. Extract response/evidence/score responsibilities while preserving existing callbacks and data contracts.
4. Implement the desktop/tablet/mobile layouts from design §6.7. Use semantic tabs or an installed primitive only if its addition is justified and its licence checked.
5. Add fit-to-width/zoom/reset for scans with `object-contain`, retaining access to every edge. No swipe-only action.
6. Inspect a diagram-heavy question, long prose answer and multi-page response at all target widths. Repeat tests under reduced motion.

**Gate:** a mobile student can read the answer, check the scheme and confirm a mark without scrolling through a desktop stack.

## Task 12: make marking evidence and confirmation trustworthy

**Modify:** `app/_components/marking/score-panel.tsx`, `app/_components/marking/evidence-panel.tsx`, `app/_components/marking/parse-mark-input.ts`, `app/_components/marking/model.ts`, `features/papers/marking/contracts/http.ts`, `features/papers/marking/infrastructure/http/score.ts`, `features/papers/marking/application/scoring.ts`, `features/papers/marking/infrastructure/convex/commands.ts`, `convex/marking.ts`, `convex/schema.ts`.
**Test:** `app/_components/marking-submission-workspace.test.ts`, `features/papers/marking/contracts/http.test.ts`, `features/papers/marking/application/scoring.test.ts`, `tests/e2e/marking.spec.ts`.

1. Test suggestion/confirmed separation, invalid marks, preserved unsaved input, repeated confirm and stale expected revision.
2. Run `npm run test -- app/_components/marking-submission-workspace.test.ts features/papers/marking/contracts/http.test.ts features/papers/marking/application/scoring.test.ts`.
3. Add revision-aware confirmation using existing atomic scoring boundaries. Confirmed aggregates update only after acknowledged confirmation.
4. Render scheme criteria, existing rationale and grounded excerpts. Extend optional evidence-location types only if the pipeline supplies verifiable coordinates; otherwise use the text/page fallback.
5. Add an integration check with two open tabs changing the same score. The stale tab must offer the current score rather than silently overwriting it.
6. Confirm final-question completion and a topic-prefilled builder link. Require user review before a new generation.

**Gate:** no suggestion becomes confirmed automatically; no synthetic highlight or grade forecast is introduced. This task does not build the excluded marking evaluation set.

## Task 13: replace marketing promises with product proof

**Modify:** `app/_components/landing-page.tsx`, `app/_components/landing/paper-fan.tsx`, `app/_components/landing/marking-annotation-plate.tsx`, `app/_components/landing/subject-option-wheel.tsx`, `app/_components/landing-motion.tsx`, `app/layout.tsx`.
**Test:** `tests/e2e/landing.spec.ts`.

1. Capture the implemented builder/result/review using original or permitted sample content. Remove private names and answer data.
2. Rework the hero around one coherent paper. Label examples visibly. Update heading-based tests to the final copy; remove the old ≥650px hero assertion if it conflicts with the mobile composition.
3. Replace the rotating course presentation with a scannable registry-backed directory. Preserve deep links and honest coverage.
4. Link approved support/privacy/terms pages if they exist. If absent, record owner decisions and content work; do not ship fake policy URLs.
5. Run `npx playwright test tests/e2e/landing.spec.ts tests/e2e/navigation.spec.ts`.
6. Inspect 390 and 1440px, JavaScript-disabled core content and reduced motion.

**Gate:** the landing demonstrates the implemented product without invented accuracy, grades, students, testimonials or unsupported board coverage.

## Task 14: profile real smoothness and harden access

**Inspect/modify only where measurements require:** `app/globals.css`, `app/_components/paper-maker/dotcut/dotcut-canvas.tsx`, `app/_components/landing-motion.tsx`, `app/_components/ui/animated-value.tsx`, `app/_components/ui/action-button.tsx`, `scripts/a11y-axe.ts`, `playwright.config.ts`.
**Test:** `tests/e2e/accessibility-motion.spec.ts` and the journey specs.

1. Run `npm run build`. If build prerequisites fail, record the exact cause before proposing a performance claim.
2. Run the production server on a separate port with `npm run start -- -p 3100`. Capture a controlled Lighthouse run and browser performance trace; do not compare development bundles with production bundles.
3. Profile builder selection, result appearance, mobile panel switching, scan zoom and confirmation. Inspect long frames and work continuing after navigation.
4. Apply narrow fixes: reserve image dimensions, remove offscreen loops, defer preview work, scope providers, or reduce layout work only where traces support it.
5. Run `npm run bench:axe` against its configured test environment and inspect all authenticated review states manually as well. The existing script's default environment must be checked; it is not automatically the production server.
6. Check keyboard, VoiceOver or equivalent, 200% zoom, contrast, iOS keyboard/safe-area behaviour and Android touch. Record actual devices; emulation does not prove native-browser behaviour.
7. Rerun the same trace or failing access check after each fix. Stop optional profiling once the acceptance risk is resolved.

**Gate:** measurable response and stable layouts. A screenshot is visual evidence, not proof of 60fps or good field INP.

## Task 15: prove the full journey and prepare rollout

**Modify:** `progress.md`, `docs/plans/evidence/2026-11-01-experience-baseline.md`; record final evidence beside the baseline.
**Test:** the existing Vitest suite and all Playwright journeys.

1. Run `npm run check`.
2. Run `npx playwright test`. Ensure at least one authenticated end-to-end paper/attempt journey uses the real private backend and durable storage.
3. Run `npm run build`, then the repository React Doctor workflow after loading `react-doctor`. Fix new diagnostics in scope; record pre-existing ones.
4. Complete the state matrix in design §9 with screenshots and observed outcomes. Include restart, partial failure and duplicate-action tests, not only happy paths.
5. Prepare a small moderated usability study using design §12. Recruitment/outbound messages require separate explicit authorisation.
6. Record coverage, source-rights evidence, approved policy text, storage retention decisions and any unvalidated AI limitations before broad public rollout.
7. Produce a reviewable diff and release note. Keep the previous route-compatible implementation available for rollback. Public deploy remains a separate final action.

**Gate:** no unowned critical defect. Every unmet criterion has a named reason and owner, rather than a silently checked box.

## Test data and contract notes

Use a local/private test account, one supported subject, and original sample answers. Public page screenshots and invented demonstration data are not a grading evaluation dataset.

Suggested job snapshot shape, extending the existing type rather than creating another abstraction layer:

```text
jobId, status, stage, progress?, completedPapers, totalPapers,
revision, createdAt, updatedAt, expiresAt,
papers[{index, identity, actualMarks, estimatedMinutes,
        questionPaperArtifact?, markSchemeArtifact?, schemeFailureCode?,
        generationReceiptId?, savedPaperId?}],
combinedArtifact?, safeFailureCode?
```

Ownership/capability hashes, execution leases, raw exception details and storage internals stay server-side. A durable job's status is distinct from its save/download state. The UI does not need the storage implementation.

Keep idempotency keys scoped to one semantic action. Retry of a status fetch keeps the same job. “Build another” creates a new job. Repeated confirmation with the same revision/key must not double-count marks.

## Rollback and change isolation

- Ship additive storage fields and compatible reads before changing the visible flow.
- Keep old saved papers and attempts readable while adding page associations and artifact references.
- Expose the new experience in a private preview first. A feature flag is justified only if both implementations must coexist during rollout; do not build a generic flag platform.
- Do not delete PDF-engine tests or change source-fidelity algorithms to simplify a UI fixture.
- Record application and worker versions together when durable execution ships.
- If a new review UI fails, roll back presentation without rewriting confirmed scores or deleting uploaded pages.
