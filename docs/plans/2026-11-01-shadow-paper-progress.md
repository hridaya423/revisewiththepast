# Shadow paper implementation progress

Plan: [2026-11-01-shadow-paper-generator.md](2026-11-01-shadow-paper-generator.md). Design: [2026-11-01-shadow-paper-generator-design.md](2026-11-01-shadow-paper-generator-design.md).

## Environment

- `npm ci` restored dependencies from the existing lockfile (lockfile unchanged).
- Render source pages with `NODE_OPTIONS="--import ./scripts/shims/server-only-register.mjs" npx tsx scripts/render-pdf-pages.ts <pdf> <out> 1.3`.

## Pilot source review (done)

- Question paper: `data/downloads/edexcel/mathematics/higher/001780-2019-paper-1-question_paper-june-202019-20qp-pdf.pdf`, sha256 `d97b7d2d4325bbd3f78898f00fa2c58feef94d6954a4126ba53105281ccf7f45`. Pearson 1MA1/1H, Tuesday 21 May 2019, 1h30, non-calculator, 80 marks, 22 questions.
- Mark scheme: `001793-...ms-pdf.pdf` and its alias `000507-...ms-pdf.pdf` share sha256 `13b5fc5097619d6ba664a243650700fe34919b5832707acec02a66f9c8cecb3d`.
- Every page of both PDFs was read. Marks per question: 4,5,2,2,3,4,4,4,3,2,4,3,2,2,4,4,4,5,3,4,7,5 = 80.
- Every question has a numerical/structural variation, including Q13 (proof of n²+kn parity, k odd). No unchanged disclosures are needed.

## Task status

| Task | Status | Notes |
| --- | --- | --- |
| 1 Inventory | done | `scripts/shadow-paper-inventory.ts` (+test). Pilot status complete; 2024 June/Nov aliases detected. |
| 2 Renderer | done | Direct vector typesetting (`math-renderer.ts`), Times + Symbol standard fonts, no new dependency. Specimen sheet reviewed at 3x: fractions, radicals, stretchy brackets, vectors, powers, π, −, ≤/≥ correct. 16 specimens lay out and draw in ~8 ms. |
| 3 Contracts | done | `contracts/shadow-paper.ts` (+test). |
| 4 Rational/params | done | `domain/rational.ts`, `domain/parameters.ts` (+test). |
| 5 Registry + first units | done | `domain/template-registry.ts`, `domain/validation.ts`, `templates.test.ts` (source reproduction, 100 seeds, invalid domains, leak checks). |
| 6 Rendering | done | `infrastructure/pdf/{layout,question-fragments,render-diagram,cover,render}.ts` (+`render.test.ts`). Typeset fragments go through the shared planner/painter at scale 1; painter source type narrowed to `PaintableFragmentSource`; planner now retries an overflowing fragment's split on a fresh page (+test). ~0.2–0.3 s per PDF. |
| 7 Full pilot + diagrams | done (pending human sign-off) | All 22 templates authored; `domain/diagram.ts` (+test); manifest `config/shadow-papers/edexcel-higher.json` with completeness test `content/catalog.test.ts` and a printed-text leak guard. Every page of 4 variants (seeds a…, b…, 7f3a…, 91c2…) and their schemes visually reviewed. Manifest stays `draft`: design §11 requires a human maths reviewer to approve the mapping. |
| 8 Persistence | done | Tables `shadowGenerationJobs`, `shadowPaperVariants`, `shadowQuestionVariants`; pure transitions `convex/model/shadowJobs.ts` (+`convex/shadowPapers.test.ts`, 23 tests); functions `convex/shadowPapers.ts`; crons for stale recovery (5 min) and 7-day expiry. `_generated/api.d.ts` hand-updated (codegen not run; no deploy). |
| 9 Worker | done | `application/generate-shadow-paper.ts` (+test with in-memory store using the real decisions), `infrastructure/jobs/worker.ts`, `http/shadow-worker.ts` (Bearer service secret), `convex/shadowPaperScheduler.ts` (3 dispatch attempts, needs Convex env `SHADOW_WORKER_BASE_URL`). Optional dev kick via `after()` with `SHADOW_PAPERS_INLINE_WORKER=1`. |
| 10 HTTP API | done | `http/shadow-routes.ts` (route table + handlers, injected deps), `http/shadow-http-deps.ts`, catch-all delegates `shadow-*` paths; `shadow-http.test.ts` (30 tests). |
| 11 Saving | done | `convex/model/shadowSave.ts` + `saveVariant` mutation; optional `generationKind`/`shadowVariantId` on saved papers and receipts, `shadowQuestionVariantId` on saved questions, receipts indexed by variant+owner; `save-shadow-paper.test.ts`. |
| 12 UI | done | `app/_components/shadow-paper-workspace.tsx` (choose → generate → progress/cancel → download/save/another version; restores from `job` param or the active job; offline-aware polling). `app/paper-maker/shadow-paper-page.tsx` serves `/paper-maker?mode=shadow` when `SHADOW_PAPERS_ENABLED` (or when restoring a `job`); builder shows a "Make a shadow paper" link when enabled. |
| 13 Marking boundary | done | `application/marking-boundary.ts` (+test). Shadow saved papers are refused by `createSubmission`, `autoScoreSubmission` and the Convex `createMarkingSubmission` mutation; imports carrying the printed marker are rejected and `detectPaperIdentityFromPages` never resolves them to the original sitting. Marking dashboard offers "Mark scheme" instead of "Start marking" for shadow papers. |
| 14 Verification | done (except pilot enablement) | `tests/e2e/shadow-paper.spec.ts`: 4 passed (run with `SHADOW_PAPERS_ENABLED=1 SHADOW_PAPERS_ALLOW_DRAFT=1`, system Chrome via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`). Vitest `features/papers convex scripts/shadow-paper-inventory.test.ts`: 46 files, 569 tests passed. `npm run lint`: clean for shadow code. `npm run build`: passes, 10/12 function budget, trace audit clean. `tsc`: only errors are in the concurrently added `convex/generationJobs.test.ts` (`_handler` on registered functions), not shadow code. |

## Variety and robustness pass (manifest revision 2026-11-01.2)

- Q12 now samples two independent percentages from {10…90} whose multipliers have denominators ≤ 10 (120 versions, was 6). Q14 enumerates every ordered pair of GCSE exact values with a non-integer rational product (12, was 6). Q13 allows odd k in −9…9 (26, was 15).
- Q8: (b) samples (mantissa, power) from the 30 valid pairs instead of rejecting ~80% of draws; (c) no longer emits an empty text node for non-terminating answers, which had silently excluded bases 3, 6, 7 and 9.
- Q5 and Q22 samplers skip draws their constraints always reject. `SHADOW_SAMPLE_LIMIT` raised 64 → 400.
- Before: 1 of 1000 papers failed with NO_VALID_VARIANT. After: 0 of 2000 failed, all 2000 semantically distinct, ~15 ms per paper, max 40 attempts for any unit.
- A catalogue test now fails if any printed text contains `BigInt`, `undefined`, `NaN` or `Infinity` (caught a Q13 scheme regression).
- Smallest remaining spaces: Q4 10 (cm-grid bound), Q14 12 (exact values are finite), Q15 28, Q17 45, Q1 52, Q18 54.

## Measurements (renderer decision)

Direct vector typesetting with pdf-lib standard fonts was kept; MathJax/canvas was not needed. Per variant: generation 29–36 ms, paper render 110–170 ms (23 pages, ~198 KB), scheme render 140–300 ms (14 pages, ~425 KB). No source PDF is read at runtime.

## To enable the pilot

1. A human maths reviewer signs off the mapping; set `publicationStatus` to `approved` in the manifest.
2. Run `npx convex codegen` and deploy Convex; set Convex env `SHADOW_WORKER_BASE_URL` and `MCP_SERVICE_SECRET`.
3. Set `SHADOW_PAPERS_ENABLED=1` on the deployment.
