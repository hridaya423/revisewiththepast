# Shadow paper generator: design and implementation contract

Date: 2026-11-01. Status: planning complete with Opus 5.5 and Gemini 4 Argon input; proposed implementation contract. Application code is not implemented.

The user wants to select a maths paper and practise its question structures with fresh numbers. The output must include a matching question paper and worked mark scheme. This document defines the feature. The companion [implementation plan](2026-11-01-shadow-paper-generator.md) defines the work sequence.

## 1. Product promise and scope

A **shadow paper** follows one specific source paper. It preserves question order, subparts, assessed methods, mark allocations, calculator policy, and intended difficulty. It changes meaningful numerical givens and regenerates every affected answer, explanation, table, and diagram.

Preserving these properties does not prove equal empirical difficulty. The product should describe the output as practice based on that paper. It must not claim an official equivalent or attach the original grade boundaries.

Start with Edexcel GCSE Mathematics Higher, the maths subject currently enabled in the builder. Add source papers through a curated catalogue. The first release needs at least one complete approved source paper. A foundation or AQA expansion requires its own catalogue and ingestion work.

An internal **shadow practice set** may contain only supported question units. It must show omitted questions, its actual marks, and a different title. It is a development milestone, not completion of the requested whole-paper feature.

The first release excludes arbitrary PDF uploads, difficulty controls, topic remixing, batches, editable parameters, cross-board conversion, and automatic marking. Students can download the paper and its worked mark scheme. Saved variants remain readable and reproducible.

Automatic marking is a later integration gate. The existing marking evaluation set remains outside this planning task and implementation scope.

### Rules for full-paper availability

1. Every source question and subpart has an approved template or an explicit unchanged classification.
2. A numerical question counts as changed only when meaningful givens change and the mathematical instance differs.
3. Some proof or explanation questions have no safe numerical variation. A reviewed unchanged question is allowed only when the catalogue discloses its count before generation.
4. A numerical question with unsupported diagrams or uncertain extraction blocks full-paper publication.
5. A runtime failure fails the generation. It never silently substitutes another paper's question or copies the original numerical question.
6. Every output has a complete, validated scheme. Scheme generation is mandatory even when the student downloads it later.

## 2. Current repository evidence

These are observations of the working tree on 2026-11-01. Many files contain earlier uncommitted work. Preserve that work and recheck interfaces before implementation.

| Existing surface | Evidence and implication |
| --- | --- |
| Subject catalogue | `shared/domain/subject-catalog.ts` registers `edexcel-mathematics-higher`. `shared/domain/paper.ts` contains its subject-key union. Maths configuration for another board does not make that board available in the builder. |
| Builder UI | `app/_components/paper-maker-workspace.tsx` and `app/_components/paper-maker/state-model.ts` implement subject, topics, and paper stages. Component-code filters do not select a particular year and sitting. A source-paper selector is new work. |
| Paper identity | `convex/schema.ts` has paper assets, tagged papers, and question parts. `QuestionUnit` in `shared/domain/paper.ts` groups source parts. A canonical identity needs board, qualification, subject, tier, year, session, and component. |
| Question text | `promptText`, regions, and identity anchors support extraction and cropping. They are not a mathematical syntax tree. Missing fraction numerators, superscripts, and radical glyphs can change the meaning of an extracted prompt. |
| PDF generation | `features/papers/builder/infrastructure/pdf/question-fragments.ts`, `paint-generated-layout.ts`, and `source-pdf.ts` compose source fragments. The painter embeds PDF pages, so newly typeset pages can reuse the existing planner and painter through a narrow adapter. |
| Jobs | `features/papers/builder/infrastructure/jobs/generation-jobs.ts` holds jobs and bytes in a process-local `Map`. Its lifecycle can inform the UI, but it cannot provide durable generation across process restarts. |
| Saving | `features/papers/builder/application/save-generated.ts` verifies a PDF against a receipt and resolves original `selectedUnitKeys`. A source unit key cannot identify a numerical variant. |
| Mark schemes | `features/papers/marking/application/generate-mark-scheme.ts` and the scoring infrastructure use original source questions and schemes. Passing shadow values through this path would produce wrong answers. |
| Marking | `resolveSubmissionQuestionContext` and `buildCombinedMarkScheme` in `features/papers/marking/infrastructure/scoring/scoring.ts` need a distinct variant branch before shadow marking is enabled. |
| Tests | `vitest.config.mts` includes feature, Convex, script, shared-domain, and app tests. Existing browser tests live in `tests/e2e/`. |
| Deployment audit | `scripts/audit-mcp-trace.ts` enforces a 12-function budget and excludes full extracted/downloaded source data from route bundles. Reuse the existing page and API catch-all. Load reviewed templates rather than source PDFs at runtime. |
| Receipt identity | `convex/generationReceipts.ts` deduplicates receipts by PDF hash and assigns a single claimant. Shadow receipts must use owner/variant identity, even when two users receive identical PDF bytes. |

Gemini inspected the local maths corpus and reported duplicate sittings, extraction defects, and substantial diagram coverage. Its counts describe a heuristic local audit, not measured production eligibility. The final catalogue must measure eligibility from approved templates.

Recommended pilot: **Edexcel 1MA1 Higher Paper 1, June 2019**. The local extraction is `data/extracted/edexcel/mathematics/higher/001780-2019-paper-1-question_paper-june-202019-20qp-pdf/paper.json`. A direct check found 22 question numbers, 32 parts, 80 marks, and all 32 parts marked `validated`.

Opus selected this paper for its comparatively lower diagram burden. Its extracted `figures` array is empty despite visual questions. Empty figure metadata therefore cannot establish diagram-free eligibility. The source PDF and official scheme remain the authoring authority.

The June 2023 Higher Paper 1 extraction, under `data/extracted/edexcel/mathematics/higher/001783-2023-paper-1-question_paper-june-202023-20qp-pdf/`, provides additional examples of missing powers, fraction structure, and radical signs.

## 3. Approach and trade-offs

| Approach | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Rewrite each paper with an LLM at generation time | Broad apparent coverage with little initial authoring | Weak reproducibility, variable maths, extraction errors, diagram contradictions, and expensive validation | Exclude from the published runtime path |
| Replace text inside source PDFs | Retains the original visual layout | PDF glyphs, fractions, line lengths, and diagrams do not offer reliable semantic replacement | Exclude |
| Approved source-specific parameter templates | Exact reproducibility, explicit constraints, consistent solutions, and controlled release | Requires content authoring and diagrams per supported structure | Use |

Templates must represent a particular source question's structure. A generic topic generator does not satisfy “a shadow of this paper.” Share arithmetic and diagram primitives across templates, but keep each source mapping explicit.

An LLM can assist offline authoring. It can suggest a transcription, parameters, and invariants from a source crop and mark-scheme crop. An engineer and maths reviewer approve the resulting declarative content and trusted code. Generated executable expressions never enter production through model output.

This separates two workloads. **Authoring** establishes what may vary. **Generation** samples approved parameters, solves, verifies, and renders. Model/provider selection is an authoring configuration, not a requirement imposed by the models used to plan this feature.

## 4. Authoring and publication

Store reviewed templates under `features/papers/shadow/content/edexcel-higher/`. Store the approved paper manifest in `config/shadow-papers/edexcel-higher.json`. Keep domain, application, and infrastructure modules under `features/papers/shadow/`.

For each source paper:

1. Resolve and deduplicate the canonical paper identity. Pin the selected source PDF and mark-scheme hashes. Keep alternative source paths as provenance.
2. Establish a complete ordered question inventory from the actual PDF. Do not infer completeness from successfully tagged questions alone.
3. Examine each complete question unit, including shared stems, all subparts, source figures, and the official scheme.
4. Transcribe maths into typed content. Verify against the page image. Treat OCR and extracted text as suggestions.
5. Classify each number as a variable parameter, derived value, fixed mathematical constant, structural label, or measurement precision.
6. Define the parameter domain, dependencies, answer form, solution method, marks, calculator constraints, and layout bounds.
7. Reproduce the source instance. Compare its rendered prompt, answer, method steps, and marks with the source.
8. Generate boundary and seeded variants. Review representative rendered questions and schemes.
9. Publish an immutable template revision and paper manifest only when every required unit passes.

A changed source hash makes its mapping stale. A changed template creates a new revision. Existing variants keep their original snapshots.

The source-paper manifest records expected question labels, subpart paths, total marks, duration, equipment, calculator policy, and unchanged-question disclosures. Missing or duplicate units block publication. Source-file availability and permission to distribute derived material must be checked for the selected paper before public catalogue publication.

Author new wording and art that preserve the mathematical structure. Do not retain copied source crops as runtime dependencies. Pin source references for private authoring evidence. Published templates and stored variants must remain usable if original assets later disappear.

## 5. Mathematical model

### Template contract

A template has `templateId`, `revision`, `sourceUnitKey`, source hashes, topic/subskill labels, and a review record. Its trusted implementation exposes:

- `sample(seed, sourceParameters) -> parameters`: bounded, deterministic sampling.
- `derive(parameters) -> derivedValues`: a dependency graph evaluated once.
- `buildQuestion(parameters, derivedValues) -> questionDocument`: structured stems, subparts, tables, diagrams, answer space, and marks.
- `solve(parameters) -> solution`: exact answer values, worked steps, method marks, accuracy marks, and accepted forms.
- `verify(questionDocument, solution) -> validationReport`: independent mathematical checks and structural invariants.

Store exact integers and rational values as normalised numerator/denominator decimal strings. Use `bigint` inside trusted computation when needed. Convert to decimal display only with an explicit rounding rule. Restrict expression nodes and operators to what the supported templates need.

Implement half-up decimal and significant-figure rounding, plus truncation, over exact values. Test positive and negative ties, leading zeroes, and powers of ten. `Number.toFixed` and binary floating-point equality are not exam-answer contracts. For example, JavaScript formats `(2.675).toFixed(2)` as `"2.67"`.

Add exact surd and π-multiple representations when a pilot template needs them. Calculator-only transcendental values need an explicit numerical tolerance and distance from rounding boundaries. Verify plausible intermediate rounding cannot change the published required answer.

Reject unknown content nodes, excessive nesting, unbounded strings, non-finite numbers, zero denominators, and oversized render dimensions. A typed expression tree is data. It must not execute JavaScript, arbitrary LaTeX commands, remote URLs, or model-supplied code.

The runtime can use specialised solvers per family. A general computer-algebra service is not a first-release dependency.

### Preserve difficulty through explicit invariants

Each template declares allowed signs, number ranges, arithmetic complexity, factorisation structure, denominator complexity, significant figures, and required solution steps. Also preserve the context's units and plausible ranges.

Avoid accidental shortcuts. Examples include a coefficient becoming zero, a ratio simplifying to equality, cancellation removing the assessed step, or simultaneous equations becoming dependent.

Use `config/edexcel-mathematics/error-traps.json` as an authoring aid. A declared common-error result must remain different from the correct answer. A question about rounding up the number of packs loses its purpose when the new answer is an exact pack count.

Reject unintended answer leakage. Reduced probability fractions must not directly reveal counts when finding those counts is the task. Different subparts should not acquire identical answers unless the structure allows that.

For multipart questions, use one shared parameter object and a directed dependency graph. Change the whole unit atomically. Reject cycles. Mark-scheme follow-through rules refer to part IDs and mathematical dependencies.

Record when each given becomes visible. A value first revealed in part (b) must not appear in part (a). A “show that” result is both derived and printed; later parts consume that exact value. Independently defined sub-scenarios use separate parameter groups.

### Worked examples

**Two-step linear equation.** A source question might ask to solve `3x + 7 = 22`, with answer `5`. Sample `a = 4`, `x = 6`, and `b = 9`; derive `c = ax + b = 33`. Render `4x + 9 = 33`. The solution subtracts `9`, then divides by `4`. Check `4 × 6 + 9 = 33`. Exclude `a = 0`, `a = 1` when division is assessed, and trivial values that remove a step.

**Reverse percentage.** A source question might reduce a price by `20%` to `£64`, asking for the original price `£80`. Choose an original price of `£120` and discount of `15%`; derive the sale price `£102`. Render the unknown original price and new sale price. Verify `120 × 85/100 = 102`. Preserve whether the source assesses a percentage multiplier, money rounding, or an exact result.

**Factorisable quadratic.** Construct `(x − 4)(x − 7)` before expanding to `x² − 11x + 28`. This guarantees the intended factorisation and roots. Check both substitutions and coefficient reconstruction. Preserve whether the source has distinct roots, signs, a non-unit leading coefficient, or required irrational solutions.

**Diagram with Pythagoras.** A right triangle using `6`, `8`, and unknown hypotenuse can become `9`, `12`, and unknown `15`. The diagram and prompt consume the same parameters. Retaining old labels in a source crop would invalidate the question. This family needs an approved diagram renderer before publication.

**Pilot-style weighted ratio.** Packs contain `3`, `4`, and `8` pens in pack-count ratio `5:2:3`. Choose three lots of this ratio. The total becomes `3 × (3×5 + 4×2 + 8×3) = 141`, with `72` pens in the third pack type. Verify the implied totals `45 + 24 + 72 = 141`. Incorrectly sharing all pens in the pack ratio gives `42.3`, so the original error trap still matters.

**Pilot-style two-stage probability.** Choose `15` red and `10` green counters. The green probability is `2/5`. Add one red and four green counters; it becomes `7/15`. Solving `g/(r+g)=2/5` and `(g+4)/(r+g+5)=7/15` recovers `r=15, g=10`. Reject dependent equations and fractions that reveal the unknown counts immediately.

### Mark-scheme criteria

Represent alternative solution methods as separate branches. Each complete branch must award the same maximum marks for its part. Do not sum the maxima of alternative branches.

Criteria carry the appropriate source codes, including P, M, A, B, C, and special cases. Preserve dependencies, follow-through, equivalent forms, exact-answer restrictions, reading tolerances, and “implied by” values where applicable.

Compute those values from the generated instance. A scheme with new final answers but old intermediate values is invalid. Store accepted forms and ranges alongside the worked steps. Treat freehand diagrams, constructions, and explanations as requiring manual marking until a later feature explicitly supports them.

### Validation is more than recomputing the answer

Use a second mathematical property where possible: substitute roots, reconstruct factors, sum probabilities, verify dimensional consistency, or recompute a percentage forwards. A second call to the same solver is not independent verification.

For each template, test source reproduction, parameter boundaries, known invalid inputs, at least 100 fixed seeds, and changedness against the source. This is a proposed engineering regression gate, not an evaluation dataset or proof of equal difficulty.

Enumerate the entire valid parameter set when it is small. Record its size and semantic diversity. A finite variety budget prevents the product from promising unlimited unique papers. For larger domains, expand deterministic seed coverage around any discovered failure.

Set a bounded sample limit, initially 64 candidates per unit. If no valid distinct candidate exists, return `NO_VALID_VARIANT`. Review a new seed on explicit retry; do not bypass validation.

## 6. Identity, snapshots, and persistence

Keep three different identities:

- **Source identity** identifies the original paper and question.
- **Template revision** identifies the approved transformation rules.
- **Variant identity** identifies the generated mathematical instance and artifacts.

A server-generated seed and the published manifest revision determine all question seeds. Derive each unit seed from the paper seed, template revision, and source-unit key. A retry of the same job reuses those inputs.

Use a canonical semantic hash over the manifest revision, ordered template revisions, parameters, and mode. A PDF byte hash serves a different purpose: it verifies a particular stored artifact. Renderer metadata can change PDF bytes without changing the question.

Proposed Convex additions:

| Record | Required data |
| --- | --- |
| `shadowGenerationJobs` | Owner, idempotency key, payload hash, seed, manifest revision, status, attempt, lease token/expiry, bounded progress, error code, timestamps, result variant ID |
| `shadowPaperVariants` | Owner, source identity, manifest revision, semantic hash, display code, ordered unit IDs, total marks, time, calculator policy, renderer version, validation summary, question/scheme storage IDs and hashes |
| `shadowQuestionVariants` | Paper variant ID, display order, source key, template revision, parameters, typed question document, exact solution, mark allocation, validation report |

Use indexes for owner/idempotency key, owner/created time, paper variant/display order, and source/template revision where queried. Keep documents bounded. Store PDF bytes in Convex storage. Large snapshots can use storage with a content hash rather than growing a single JSON field.

Published templates remain version-controlled trusted content. They do not require a database editor in the MVP.

Existing saved-paper rows gain optional `generationKind: "custom" | "shadow"` and `shadowVariantId`. Absence means legacy/custom behaviour. Shadow saved questions carry `shadowQuestionVariantId`, unique variant keys, source provenance, and the rendered prompt snapshot.

Extend the existing receipt contract with an optional generation kind and immutable variant reference. Shadow receipts bind the owner, variant, question-PDF hash, scheme hash, and manifest hash. Keep current custom-paper receipts valid.

Create or retrieve a shadow receipt by owner and variant ID. Never reuse another owner's receipt because its PDF hash matches. Artifact deduplication, if added, is a storage concern and grants no access.

For shadow saving, use stored artifacts and snapshots. Do not upload or accept client-authored question/answer overrides. Do not rebuild a saved shadow paper by looking up original source units.

## 7. Generation lifecycle and API

Use durable Convex job records with a bounded Node worker. Keep native PDF rendering in the Next.js Node runtime, where the current PDF pipeline runs. A scheduled Convex action invokes a service-authenticated worker handler in the existing paper-maker API catch-all. Do not rely on a request handler starting an unawaited promise.

The first infrastructure spike must verify the deployment's request duration, worker reachability, native canvas support, and artifact-upload limits. The scheduler handles retryable invocation failures. If a complete render exceeds the verified request budget, checkpoint by question and schedule the next bounded step. Do not add an external queue until measurements require one.

The worker atomically claims a job lease. It loads the pinned manifest, generates question snapshots, validates, renders both artifacts, and publishes their references in one final transaction. The final transaction checks the lease token and cancellation state. Duplicate or late workers cannot publish a second result.

Job states are `queued → generating → validating → rendering → ready`, with terminal `failed` and `cancelled` branches. Progress reports completed units and the current stage. It is not an estimated countdown.

Cancellation records intent durably. Check it between units and before publication. A cancellation that wins the final transaction prevents publication. A cancellation after `ready` returns the existing ready result.

Retry transient worker or storage failures with the same job inputs. Limit infrastructure retries to three attempts initially. Validation failures are terminal. A student can request a new version explicitly.

Proposed routes use the existing catch-all router:

| Method and path under `/api/paper-maker` | Contract |
| --- | --- |
| `GET /shadow-papers` | Returns approved source identities, marks, duration, calculator policy, template revision, and unchanged-question counts. Deduplicate aliases. |
| `GET /shadow-papers/:sourcePaperId` | Returns source details and availability. Unknown papers return 404. Unpublished content exposes no answer data. |
| `POST /shadow-jobs` | Accepts `{sourcePaperId, manifestRevision, idempotencyKey}`. Requires authentication. Returns 202 with job ID and status URL. |
| `GET /shadow-jobs/:jobId` | Returns owner-scoped status and artifact links when ready. Excludes solutions and private worker details. |
| `POST /shadow-jobs/:jobId/cancel` | Cancels an active owned job, or returns its existing terminal state. |
| `GET /shadow-variants/:variantId/download?kind=paper\|mark-scheme` | Authenticates the owner and streams the matching stored PDF. Invalid artifact kinds return 400. |
| `POST /shadow-variants/:variantId/save` | Creates or returns the existing saved-paper reference from server-owned snapshots. |

The current router uses exact handler maps. Add explicit matching for these parameterised routes; do not assume the maps handle segments automatically. Alternatively keep IDs in query parameters, but preserve these contracts and tests.

Use strict request schemas. Reject client-selected seed, arbitrary source URL, unsupported subject, extra transformation fields, and malformed IDs. A stale manifest returns 409 with a refresh action. Reusing an idempotency key with a different payload also returns 409.

Reuse the existing generation rate-limit facility and add an initial limit of one active shadow job per owner. Authenticate every status, download, save, and cancel operation. Return 404 for another user's job. Route `POST /shadow-jobs/worker` to a dedicated handler that requires service authentication before reading the job. Do not create an additional Next.js API route file.

Set unsaved variant retention to seven days as a proposed default. Saved variants retain their snapshots and artifacts. Expire failed-job artifacts and abandoned uploads. Show an expired-result state with a new-generation action.

## 8. Question and scheme rendering

Represent a question as ordered typed blocks: prose runs, inline/display maths, tables, subparts, answer space, and approved diagram primitives. Both browser preview and PDF output use this content model.

Keep `pdf-lib` for page composition. Render new question content into synthetic PDF pages and adapt those pages to `planGeneratedQuestions` and `paintGeneratedLayout`. Reuse page dimensions, question numbering, footers, cover conventions, and page chrome.

The existing painter requires only a fragment ID and source PDF page from `PreparedFragmentSource`. Narrow its input type to that capability instead of fabricating a source URL or extraction candidate. Keep source extraction and rasterisation out of the shadow generation path.

Rendering recommendation: produce maths SVG with a pinned MathJax server package, rasterise approved SVG through the existing canvas capability, and place measured maths plates within `pdf-lib` layouts. This adds a dependency and requires a feasibility spike. KaTeX remains available for browser preview.

The spike must prove fractions, radicals, superscripts, inequalities, units, minus signs, and baseline alignment. It must also prove SVG support, embedded font behaviour, deployment compatibility, and readable print resolution. Compare against direct vector typesetting with suitable fonts before confirming the dependency. Prefer the smallest renderer that passes the required notation and accessibility checks.

**Decision (2026-11-01 spike):** direct vector typesetting with pdf-lib standard fonts (Times, Symbol) passed every notation check, so no MathJax or canvas dependency was added. Measured per variant: paper 110–170 ms (23 pages, ~198 KB), scheme 140–300 ms (14 pages, ~425 KB).

Prose remains selectable PDF text. Math plates need an accessible text representation in the web preview. Do not claim PDF/UA compliance without checking the emitted file.

Measure blocks before pagination. Typeset at the existing content width, currently 479.28 points. Supply exact prompt anchors and safe split gaps to the planner. Keep a question number with its stem, a subpart label with its content, and a diagram with its prompt.

Require scale `1` for shadow fragments. Split or reflow oversized content before planning. In particular, calibrated grids and measurement questions must never inherit the existing planner's automatic shrinking. Allow explicit continuation pages and preserve useful working space.

Geometry templates own diagram parameters, labels, and scale constraints. A schematic marked “not accurately drawn” still must satisfy all stated relationships. Read-off graphs and scale drawings need calibrated axes and coordinate mappings. Add each family only after those invariants pass.

The question PDF contains no answers. The scheme PDF contains new worked solutions, accepted exact/rounded forms, units, and per-part marks. Both display the same short variant code, source description, and manifest revision.

Use Revise with the Past branding and the title “Shadow paper.” Identify the source without reproducing exam-board logos or presenting the derived scheme as official.

## 9. Student flow and state model

Add a feature-flagged mode at `/paper-maker?mode=shadow` within the existing page route. Link it from the existing paper-maker workspace. Use a separate shadow component and state model to keep source-paper selection independent of the topic-remix state machine.

Branch before loading topic-builder page data. The shadow catalogue reads published manifests and must work without original question-bank assets. Persist the active job ID in the URL without exposing its answers.

1. **Choose a paper.** Show board, tier, year, sitting, component, calculator policy, duration, and marks. Start with the curated Higher catalogue. Keep unavailable papers visible only if their status helps selection.
2. **Review the selection.** Show the exact source identity and any unchanged non-numerical questions. The primary action is “Generate shadow paper.”
3. **Generate.** Display the current stage and completed question count. The student can cancel or leave and return.
4. **Use the result.** Show “Download paper,” “Download mark scheme,” “Save paper,” and “Generate another version.” Downloading again returns the same artifact. A new version creates a new seed and leaves the old version intact.
5. **Open a saved result.** Show source identity, variant code, creation date, marks, and both downloads. Keep answers concealed until the student opens the scheme.

| State | Available action and recovery |
| --- | --- |
| Empty catalogue | Explain that shadow papers are not available for the selected filters. Offer filter reset. |
| Loading catalogue | Preserve filters and show a stable loading region. |
| Unsupported source | Explain its availability. Do not display a generation action that can only fail. |
| Signed out | Allow catalogue browsing. Preserve selection through sign-in before generation. |
| Running | Permit cancellation and navigation. Restore the job from its URL after refresh. |
| Temporary network loss | Keep the last known job state. Resume status requests on reconnect. |
| Failed | Preserve the source selection. Offer retry where safe. Show a useful error without solver internals. |
| Cancelled | Return to the selected source. A new attempt gets a new idempotency key. |
| Ready | Download either artifact, save, or create another version. |
| Save failed | Keep downloads and the variant. Retry save without regenerating. |
| Expired | Explain that the unsaved result expired. Offer generation from the same available source. |

Use labelled native controls, visible focus, keyboard-accessible actions, and a polite status live region. Do not announce every progress tick. On mobile, keep the selected identity and primary action readable without horizontal tables.

Generation internals, seeds, validation expressions, and model names belong in diagnostics. They are not student controls.

## 10. Save and marking boundaries

Shadow snapshots are authoritative for both saved questions and answers. Original unit keys serve provenance only.

Before enabling marking, add an explicit context union: `source` or `shadow`. A shadow context loads its saved question variant and scheme snapshot. If either is missing, return an error requiring review. Never fall back to the official scheme.

Update every consumer together: submission creation, OCR prompts, page mapping, per-question scoring, whole-paper scoring, the scheme panel, scheme downloads, and saved-paper import. The panel label becomes “Shadow mark scheme” for these submissions.

Include the variant code on every printed page. A scanned upload cannot be identified as the original exam merely because its source year and component match. Until variant-aware import is implemented, require entry through the saved shadow paper and block generic auto-detection for recognised shadow documents.

Phase A and B outputs therefore expose manual checking through the downloaded scheme. They do not expose an automatic-marking action. Do not claim existing scoring becomes reliable from one text override.

A future automatic-marking release needs a separate quality decision and suitable assessment. This document does not create or authorise the previously excluded marking evaluation set.

## 11. Validation and release gates

| Gate | Required evidence |
| --- | --- |
| Source completeness | Actual PDF inventory agrees with the manifest on all question/subpart labels and marks. Duplicate source aliases cannot create duplicate catalogue entries. |
| Semantic fidelity | The source instance reproduces the mathematical meaning and solution method. A maths reviewer approves the mapping. |
| Parameter validity | Boundary and fixed-seed checks satisfy all domain, answer-form, calculator, and difficulty constraints. |
| Changedness | Every eligible numerical unit differs meaningfully from the source. Repeated “new version” requests avoid identical semantic paper hashes with bounded retries. |
| Answer correctness | Independent checks agree with exact answers, intermediate values, and units. Each alternative marking branch has the correct maximum. Part, unit, and paper mark totals agree. |
| Rendering | The paper and scheme have matching IDs, no stale values, no clipped notation, readable answer space, and correct pagination. |
| Persistence | Restarted workers resume safely. Duplicate requests produce one result. Cancellation cannot publish a late result. |
| Ownership | Another user cannot read, cancel, save, or download a variant. A forged receipt or client answer override is rejected. |
| Compatibility | Legacy custom-paper generation, saving, and marking continue to resolve their original source contexts. |
| Deployment | The build stays within the function budget. Templates load without full source data. Shadow generation and saved downloads work when source-fetch adapters are unavailable. |
| Product completion | At least one entire source paper is available. All numerical units transform safely. Any unchanged non-numerical units are disclosed. |

Test failures are release blockers for the affected template or paper. A high model-confidence score cannot override a failed check.

Record template-level failure codes, bounded sampling attempts, worker time, render time, artifact sizes, semantic hashes, and completion rates. Exclude student answers and source PDF content from routine logs. Costs and latency remain unmeasured until the implementation spike.

A kill switch disables new shadow generation while preserving access to existing saved variants. A template revision can be withdrawn from new generation. Corrections create a new revision and identify affected variants; saved papers are never silently rewritten.

## 12. Delivery stages and outstanding decisions

**Stage A: prove the pipeline.** Author several source-specific question units, render their papers and solutions, and validate the seed model. Include a multipart question and a diagram in the feasibility work. Deliver only internal practice sets.

**Stage B: deliver the requested feature.** Complete one curated source paper, durable jobs, source selection, downloads, and saving. Publish only after mathematical and visual review. This stage is the MVP completion gate.

**Stage C: grow the catalogue.** Reuse approved families and add diagrams, constructions, probability trees, and graph tasks as required by selected papers. Add Foundation or AQA only with complete source and template coverage.

**Stage D: integrate marking.** Implement variant-aware context and import handling, then perform a separate marking-quality release review.

The main effort driver is content authoring and verification, especially diagrams and complex multipart questions. Infrastructure alone cannot make every past paper eligible. Estimate delivery after the first-paper inventory and renderer spike.

Resolve these items during Stage A:

- Does the June 2019 Higher Paper 1 source review confirm the pilot selection? Its extracted inventory is clean, but the PDF review still decides publication.
- Can the deployment run the chosen math renderer within its request and memory budgets?
- Are the selected source artifacts complete and suitable for derivative distribution?
- Does the first selected paper contain non-numerical questions that should remain unchanged?
- What measured per-paper runtime and storage cost justify the initial usage quota?

## 13. Synthesis of delegated research

Gemini 4 Argon examined the corpus, product flow, and validation risks. Its findings support source-specific generation, new rendering, whole-unit dependencies, and separate shadow answers.

The final design deliberately narrows several suggestions:

- A heuristic “text-only” classification is not approval to mutate a question.
- Coordinate-based text reconstruction can assist authoring but cannot establish mathematical truth.
- A different question from another paper cannot repair a failed full shadow generation.
- Executable checks supplied by a model are not trusted validation code.
- A mark-scheme text override alone does not complete OCR, import, or scoring integration.

Opus 5.5 independently recommended verified templates and identified the June 2019 pilot, the reusable PDF-page adapter, receipt collisions, import identity risks, and deployment constraints. These findings are incorporated above.

The final synthesis makes these additional choices:

- Reuse the existing PDF planner and painter; keep new maths content rendering isolated.
- Preserve exact rounding, alternative mark schemes, reveal order, common-error distinctions, and finite variant counts.
- Keep durable jobs despite the possibility of a fast synchronous generator. Restart recovery, cancellation, and saving still need persistent state.
- Use semantic determinism and stored artifact hashes. Byte-identical PDF output across library/platform changes is not a correctness requirement.
- Use bounded deterministic regression cases and targeted review. Large nightly seed sweeps and a new marking evaluation dataset are not required for this planning scope.
- Preserve current uncommitted work. Neither a new commit nor a clean working tree is a prerequisite imposed on the user.

Research threads:

- Opus 5.5: <t3-thread://v2/16f09624-6259-42f6-9ef6-9975cbb3cab3/thread:delegated-task:command%3Amcp%3A387652b2-3520-4319-9001-88697d58d46b%3Adelegate-task%3Ace46ff96-3793-465d-9a43-e875790b9da3>
- Gemini 4 Argon: <t3-thread://v2/16f09624-6259-42f6-9ef6-9975cbb3cab3/thread:delegated-task:command%3Amcp%3A387652b2-3520-4319-9001-88697d58d46b%3Adelegate-task%3A668ab27b-71b2-42ad-a9cc-9ea6f078ba42>
