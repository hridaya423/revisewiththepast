# Shadow paper generator implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement task-by-task.

**Goal:** Let a student choose an approved maths paper and download, save, and regenerate a mathematically valid shadow paper with a matching worked mark scheme.

**Architecture:** Use approved source-specific templates with deterministic parameters and independent verification. Store immutable question and solution snapshots. Render fresh content and run generation through durable, owner-scoped jobs.

**Tech stack:** Next.js 16.2.6, React 19.2, TypeScript, Zod, Convex, `pdf-lib`, existing canvas support, Vitest, and Playwright. A server-side maths renderer is selected through Task 2.

**Read first:** [Design and implementation contract](2026-11-01-shadow-paper-generator-design.md). It owns product semantics, persistence, API contracts, and release gates. This plan owns the execution sequence.

**Status:** Planning complete with Opus 5.5 and Gemini 4 Argon input. No application implementation or test results are implied by this document.

## Execution rules

- Preserve the extensive existing uncommitted work. Reinspect every integration file before editing it.
- Read `AGENTS.md`, then the relevant installed Next.js guides under `node_modules/next/dist/docs/` before writing application code.
- Dependencies were absent from this workspace during planning. Restore the project environment before executing tests. Resolve lockfile discrepancies explicitly rather than replacing the lockfile incidentally.
- Keep the old Phase 2 marking evaluation set outside this work.
- Treat Stage B as the first complete feature. Stage A proves the technology through internal practice sets.
- Use June 2019 Edexcel Higher Paper 1 as the recommended pilot. Confirm its source PDF and scheme before approving the manifest.
- Reuse the existing page/API routes. `scripts/audit-mcp-trace.ts` enforces the function budget and source-data exclusions.
- Run only the relevant test after each change. Run broader gates at the integration milestones below.
- Make commits only if the user requests them.

## Stage A: prove generation and rendering

### Task 1: inventory the source corpus and choose a pilot

**Create:** `scripts/shadow-paper-inventory.ts`, `scripts/shadow-paper-inventory.test.ts`, `config/shadow-papers/edexcel-higher.json`.

**Read:** `shared/domain/paper.ts`, `shared/domain/subject-catalog.ts`, `features/papers/infrastructure/question-bank.ts`, `features/papers/infrastructure/units.ts`, `config/edexcel-mathematics/paper-template.json`, and source PDFs/extracted assets for candidate papers.

1. Write an inventory test with duplicate aliases, a missing subpart, unknown marks, and conflicting calculator metadata. Assert deterministic identities and explicit incomplete status.
2. Run `npm run test -- scripts/shadow-paper-inventory.test.ts`. Expect failure until the inventory implementation exists.
3. Implement canonical sitting identities and source hashes. Record actual PDF question/subpart labels separately from available tagged units.
4. Run the same test. Expect all inventory cases to pass.
5. Run the proposed inventory command: `npx tsx scripts/shadow-paper-inventory.ts --subject edexcel-mathematics-higher`. Expect a machine-readable list of candidate papers, duplicates, missing units, and structural obstacles.
6. Examine June 2019 Higher Paper 1 and its scheme. Its extraction has 22 questions, 32 validated parts, and 80 marks. Confirm the PDF inventory and record the exact identity with `publicationStatus: "draft"`.

**Done:** The pilot has an authoritative ordered inventory. Its unsupported structures and missing evidence are explicit. A guessed topic match cannot count as coverage.

### Task 2: prove the maths renderer and deployment path

**Create:** `features/papers/shadow/infrastructure/pdf/math-renderer.ts`, `features/papers/shadow/infrastructure/pdf/math-renderer.test.ts`.

**Modify if selected:** `package.json`, `package-lock.json`.

**Read:** `features/papers/builder/infrastructure/pdf/page-chrome.ts`, `features/papers/builder/infrastructure/pdf/paint-generated-layout.ts`, `features/papers/infrastructure/pdfjs-server.ts`, `scripts/render-pdf-pages.ts`, `next.config.ts`, and `vercel.json`.

1. Create a rendering fixture for stacked fractions, roots, powers, algebraic inequalities, negative values, and units. Assert finite sizes and complete image output.
2. Run `npm run test -- features/papers/shadow/infrastructure/pdf/math-renderer.test.ts`. Expect missing implementation failures.
3. Test a pinned MathJax SVG renderer with the existing canvas runtime and `pdf-lib`. Compare direct vector rendering with suitable fonts. Reject external resources and unsupported commands.
4. Run the same test. Render the specimen PDF to images and examine the actual symbols, sizing, and baselines.
5. Run `npm run build` after the dependency change. Confirm that native/runtime dependencies fit the existing Next.js deployment.
6. Record renderer version, package choice, output limits, print resolution, and measured runtime in the design document.

**Done:** The renderer can produce correct notation in the actual deployment target. If it fails, resolve and document the alternative before building the layout system.

### Task 3: define content, template, and variant contracts

**Create:** `features/papers/shadow/contracts/shadow-paper.ts`, `features/papers/shadow/contracts/shadow-paper.test.ts`, `features/papers/shadow/domain/types.ts`.

1. Write schema tests for multipart content, reveal order, alternative marking branches, invalid fractions, oversized blocks, unknown nodes, cycles, and client-authored answers.
2. Run `npm run test -- features/papers/shadow/contracts/shadow-paper.test.ts`. Expect missing-contract failures.
3. Implement strict Zod schemas and inferred types for manifests, typed question documents, solutions, diagrams, marking criteria, validation reports, and public requests. Prefix exported feature types with `ShadowPaper` where ambiguity exists.
4. Run the same test. Expect exact acceptance/rejection behaviour.

**Done:** The public API accepts source identity, manifest revision, and idempotency key only. Trusted internal content has explicit bounds and serialisable exact values.

### Task 4: implement deterministic sampling and exact arithmetic

**Create:** `features/papers/shadow/domain/rational.ts`, `features/papers/shadow/domain/parameters.ts`, `features/papers/shadow/domain/parameters.test.ts`.

1. Write regression tests for rational normalisation, zero denominators, half-up rounding ties, significant figures, truncation, deterministic seeds, bounded rejection, and identical-source rejection.
2. Run `npm run test -- features/papers/shadow/domain/parameters.test.ts`. Expect implementation failures.
3. Implement exact arithmetic and rounding, versioned PRNG behaviour, stable parameter serialisation, and a 64-candidate sampling limit. Inspect the existing `createSeededRng` algorithm without importing its entire generation module.
4. Run the same test. Expect deterministic results across retries and explicit `NO_VALID_VARIANT` on exhausted domains.

**Done:** Arithmetic does not depend on floating-point equality. Seeds do not depend on question traversal order or wall-clock time.

### Task 5: build the template registry and author the first source units

**Create:** `features/papers/shadow/domain/template-registry.ts`, `features/papers/shadow/domain/validation.ts`, `features/papers/shadow/domain/templates.test.ts`, `features/papers/shadow/content/edexcel-higher/pilot.ts`.

**Modify:** `config/shadow-papers/edexcel-higher.json`.

1. Select several real units from Task 1, including one multipart question. Write source-reproduction tests for their prompts, solutions, and mark allocations.
2. Run `npm run test -- features/papers/shadow/domain/templates.test.ts`. Expect absent-template failures.
3. Implement source-specific templates using the sample/derive/build/solve/verify contract. Share arithmetic helpers where the mathematical structure agrees.
4. Add independent substitution, reconstruction, or conservation checks and run the same tests.
5. Add invalid-domain cases and 100 fixed seeds per template. Assert changedness, difficulty bounds, error-trap distinctions, answer form, reveal order, and marks per alternative branch.
6. Exhaustively enumerate small valid domains and record their semantic variety. Add exact surd or π representations only where a selected source unit needs them.
7. Review representative generated variants against the original question and scheme. Keep their publication status draft until reviewed.

**Done:** Every approved unit reproduces its source meaning and produces valid variants. The registry rejects unknown or withdrawn revisions.

### Task 6: render the question paper and worked scheme together

**Create:** `features/papers/shadow/infrastructure/pdf/layout.ts`, `features/papers/shadow/infrastructure/pdf/question-fragments.ts`, `features/papers/shadow/infrastructure/pdf/render-paper.ts`, `features/papers/shadow/infrastructure/pdf/render-mark-scheme.ts`, `features/papers/shadow/infrastructure/pdf/render.test.ts`.

**Modify narrowly:** `features/papers/builder/infrastructure/pdf/paint-generated-layout.ts`, `features/papers/builder/infrastructure/pdf/paint-generated-layout.test.ts`.

**Reuse:** `planGeneratedQuestions`, `paintGeneratedLayout`, page dimensions, and cover conventions. Narrow the painter's source interface to fragment ID and PDF page instead of fabricating source-extraction metadata.

1. Write tests for long stems, multipart pagination, tables, working space, mark totals, variant IDs, paper/scheme separation, and scale-one calibrated figures.
2. Run `npm run test -- features/papers/shadow/infrastructure/pdf/render.test.ts`. Expect missing-renderer failures.
3. Typeset measured blocks into synthetic PDF fragments. Supply prompt anchors and split gaps to the existing planner. Require scale one and reflow oversized content.
4. Run the new test and `npm run test -- features/papers/builder/infrastructure/pdf/paint-generated-layout.test.ts`. Confirm valid page counts and separate paper/scheme content.
5. Render representative PDFs using the repository's PDF render script. Examine every page for notation, clipping, stale values, and working space.

**Done:** An internal practice set can be printed with its correct worked scheme. This milestone is not yet a full shadow paper.

## Stage B: deliver one complete source paper

### Task 7: complete pilot coverage, including required diagrams

**Create:** `features/papers/shadow/domain/diagram.ts`, `features/papers/shadow/domain/diagram.test.ts`, `features/papers/shadow/infrastructure/pdf/render-diagram.ts`.

**Modify:** `features/papers/shadow/content/edexcel-higher/pilot.ts`, `features/papers/shadow/domain/templates.test.ts`, `config/shadow-papers/edexcel-higher.json`.

1. Write diagram tests for shared label values, geometric validity, scale/calibration, bounds, label collisions, and preserved angle categories.
2. Run `npm run test -- features/papers/shadow/domain/diagram.test.ts`. Expect missing behaviour.
3. Implement only the diagram primitives required by the selected pilot. Reuse the same parameter object for prose, labels, answers, and figure geometry.
4. Run the diagram tests and source-template tests together.
5. Repeat Task 5's authoring and verification sequence for each remaining source unit.
6. Add a manifest completeness test. Require every ordered unit and subpart, all marks, and all unchanged-question disclosures.
7. Obtain maths and visual review of the complete paper and scheme across representative variants. Mark the manifest approved only when all gates pass.

**Done:** Every numerical unit in one complete source paper transforms safely. Unsupported questions cannot be silently omitted or swapped.

### Task 8: persist immutable variants and durable jobs

**Create:** `convex/shadowPapers.ts`, `convex/shadowPapers.test.ts`, `features/papers/shadow/infrastructure/convex/repository.ts`.

**Modify:** `convex/schema.ts`. Regenerate `convex/_generated/*` through the repository's Convex code-generation command after schema/functions are ready.

1. Write tests for owner isolation, idempotent job creation, payload conflicts, lease takeover, cancellation, stale-worker publication, and saved-artifact retention.
2. Run `npm run test -- convex/shadowPapers.test.ts`. Expect missing storage behaviour.
3. Add the three records and indexes from design section 6. Implement atomic job transitions, bounded snapshot writes, storage references, and publication.
4. Run the same tests. Confirm that duplicate requests and worker retries cannot produce duplicate ready results.

**Done:** Jobs survive process restarts. Ownership applies to every read and mutation. Tests cover cancellation immediately before publication.

### Task 9: orchestrate generation and the bounded worker

**Create:** `features/papers/shadow/application/generate-shadow-paper.ts`, `features/papers/shadow/application/generate-shadow-paper.test.ts`, `features/papers/shadow/infrastructure/jobs/worker.ts`, `features/papers/shadow/infrastructure/http/shadow-worker.ts`, `convex/shadowPaperScheduler.ts`.

**Modify:** `app/api/paper-maker/[[...path]]/route.ts`.

1. Write orchestration tests for generation, validation failure, renderer failure, transient storage failure, cancellation, and same-seed retry.
2. Run `npm run test -- features/papers/shadow/application/generate-shadow-paper.test.ts`. Expect absent-orchestrator failures.
3. Implement the pinned-manifest pipeline, lease checks, bounded infrastructure retries, and final atomic publication.
4. Connect a scheduled Convex action to `POST /api/paper-maker/shadow-jobs/worker` in the existing catch-all. Require service authentication before handling job IDs.
5. Run the targeted tests, then exercise a worker restart and duplicate invocation in a development deployment.
6. Measure worst-case pilot rendering. Introduce checkpointed steps only if the verified request budget requires them.

**Done:** Generation produces both artifacts or a terminal failure. No process-local map or unawaited request work owns correctness.

### Task 10: expose the catalogue and generation API

**Create:** `features/papers/shadow/application/list-source-papers.ts`, `features/papers/shadow/infrastructure/http/shadow-papers.ts`, `features/papers/shadow/infrastructure/http/shadow-jobs.ts`, `features/papers/shadow/infrastructure/http/shadow-variants.ts`, `features/papers/shadow/infrastructure/http/shadow-http.test.ts`.

**Modify:** `app/api/paper-maker/[[...path]]/route.ts`.

1. Write HTTP tests for validation, 401, owner-scoped 404, stale-manifest 409, idempotency conflict 409, rate-limit 429, and accepted-job 202. Ensure the reserved worker path cannot match a public job-ID handler.
2. Run `npm run test -- features/papers/shadow/infrastructure/http/shadow-http.test.ts`. Expect absent-handler failures.
3. Implement the routes in design section 7. Add explicit parameterised route matching and preserve existing handlers.
4. Run the same test. Confirm that status responses contain no solution snapshots and downloads resolve only server-owned artifact references.

**Done:** The catalogue lists only approved source content. Authentication, rate limits, and active-job limits are enforced server-side.

### Task 11: save shadow papers through immutable variant references

**Create:** `features/papers/shadow/application/save-shadow-paper.ts`, `features/papers/shadow/application/save-shadow-paper.test.ts`.

**Modify:** `convex/schema.ts`, `convex/generationReceipts.ts`, `convex/savedPapers.ts`, `features/papers/builder/infrastructure/convex/generation-receipts.ts`, `features/papers/builder/infrastructure/convex/saved-papers.ts`, `shared/domain/marking.ts`.

**Inspect and branch if needed:** `features/papers/builder/application/save-generated.ts`, `features/papers/marking/infrastructure/convex/queries.ts`.

1. Write tests for saving twice, forged receipts, cross-user access, expiration, and missing solutions. Include two owners with identical PDF hashes and distinct valid variants.
2. Run `npm run test -- features/papers/shadow/application/save-shadow-paper.test.ts`. Expect absent-shadow-save failures.
3. Add optional kind/variant fields with legacy defaults. Key shadow receipts by owner and variant, independently of PDF hash. Save server-owned artifacts and snapshots transactionally.
4. Run the new save test and `npm run test -- features/papers/builder/application/save-generated.test.ts`.
5. Confirm that a template revision change leaves an already saved variant and scheme unchanged.

**Done:** Saved shadow questions never resolve their content or answers from original unit keys. Legacy generated-paper receipts still work.

### Task 12: build source selection, job recovery, and result actions

**Create:** `app/_components/shadow-paper-workspace.tsx`, `features/papers/shadow/presentation/api-client.ts`, `features/papers/shadow/presentation/state.ts`, `features/papers/shadow/presentation/state.test.ts`.

**Modify:** `app/paper-maker/page.tsx`, `app/_components/paper-maker-workspace.tsx`, `shared/infrastructure/env/server.ts`.

1. Write state tests for source selection, sign-in return, starting, restoring a job, disconnecting, cancellation, failure, ready, save failure, and expiration.
2. Run `npm run test -- features/papers/shadow/presentation/state.test.ts`. Expect missing-state failures.
3. Add `mode=shadow` to the existing page. Branch before topic-builder data loading. Add `SHADOW_PAPERS_ENABLED` and implement design section 9 with stable selections.
4. Run the same tests. Verify that retrying a download or save does not request a new variant.
5. Use `product-design`, `design-engineering`, and `clean-copy` during implementation. Follow `DESIGN.md` and existing components.

**Done:** A student can select an approved paper, generate it, recover after refresh, download both artifacts, and save the variant.

### Task 13: block unsupported marking and prevent wrong paper identity

**Modify:** `app/_components/marking-submission-workspace.tsx`, `features/papers/marking/application/submissions.ts`, `features/papers/marking/infrastructure/import/import-pipeline.ts`, `features/papers/marking/domain/paper-identity.ts`, `features/papers/marking/domain/paper-identity.test.ts`.

**Create:** `features/papers/shadow/application/marking-boundary.test.ts`.

1. Write tests showing that a saved shadow variant cannot enter the original-paper scoring path.
2. Run `npm run test -- features/papers/shadow/application/marking-boundary.test.ts features/papers/marking/domain/paper-identity.test.ts`.
3. Add a server-side unsupported-shadow-marking result for this release. Hide the corresponding automatic-marking action in the shadow UI.
4. Recognise the printed shadow marker during generic import and avoid resolving it as the official source paper. Require a supported variant workflow.
5. Run the same tests and the existing scoring application tests.

**Done:** Students can manually check the generated scheme. The application cannot quietly score changed numbers against original answers.

### Task 14: verify the complete feature and enable the pilot

**Create:** `tests/e2e/shadow-paper.spec.ts`.

**Modify:** The feature flag and pilot manifest publication status when the gates pass.

1. Add browser coverage for selection, generation, refresh recovery, cancellation, downloads, saving, and another version.
2. Run `npx playwright test tests/e2e/shadow-paper.spec.ts` against the configured test environment. Expect the complete flow to pass.
3. Run `npm run test -- features/papers/shadow convex/shadowPapers.test.ts scripts/shadow-paper-inventory.test.ts`.
4. Run `npm run lint`, `npm run typecheck`, and `npm run build`. Resolve introduced failures and distinguish pre-existing failures with evidence.
5. Run relevant existing paper-maker and saving tests. Use `verification-before-completion` and `react-doctor` for the implementation review.
6. Review every page of several full pilot variants and their schemes. Confirm source completeness, answer validity, matching codes, and readable working space.
7. Demonstrate cross-user denial, restart recovery, duplicate invocation, cancellation-before-publication, and generation without original-source fetches.
8. Enable the curated pilot only after the release gates in design section 11 pass.

**Done:** One complete selected source paper works through download and saving. Evidence accompanies the release. Partial template coverage is not reported as feature completion.

## Subsequent work

Catalogue expansion repeats the authoring, verification, and complete-paper publication process. Prioritise source structures that reuse existing approved primitives.

Automatic marking requires a separate implementation plan covering every context consumer in design section 10. It must never fall back to the original mark scheme. Its quality assessment does not belong to this implementation plan.

## Handoff acceptance checklist

- The implementation uses the current working tree without discarding prior work.
- The pilot source identity and approved template revisions are recorded.
- Every numerical source unit transforms, or the source paper remains unavailable.
- Every question and scheme comes from the same immutable variant.
- Persistence, cancellation, idempotency, ownership, and artifact retention have verified behaviour.
- The paper selector identifies an exact sitting, not merely `paper-1`, `paper-2`, or `paper-3`.
- At least one full paper passes the publication gates.
- The previously excluded evaluation set remains outside scope.
