# Revise with the Past: research and current-state evidence

Research date: 1 November 2026. Repository: `main`, HEAD `19c6172`, with substantial pre-existing uncommitted changes. Observations cover that working tree where stated. The deployed site may differ.

Read the [design specification](2026-11-01-product-experience-design.md) for decisions and the [implementation plan](2026-11-01-product-experience-implementation.md) for execution.

## Findings that change the direction

1. **The first priority is a usable core journey.** The deployed `/paper-maker` displayed its error boundary at both 1440×1000 and 390×844. A beautiful landing page currently leads into a failed journey in this browser session. The underlying cause was not established.
2. **Custom tests and AI marking are established competitor features.** Save My Exams advertises Target Test and Smart Mark. Cognito offers course-specific questions and custom papers. Our opportunity is the quality of the paper-to-feedback experience: understandable marks, recoverable work, and less administration.
3. **The existing visual language is appropriate; its application is inconsistent.** White paper, warm canvas, indigo actions, and dark ink already form a recognisable system. Small labels, oversized decorative waiting states, fragmented result handling, and unsupported continuity weaken it.
4. **Smoothness depends on persistence.** Generation jobs currently live in a module-level `Map`. Polling and cancellation exist, but durable resumption across process restarts or different server instances does not follow from that implementation.
5. **UK reach is a curriculum problem as well as a design problem.** Wales has new specification cohorts; Northern Ireland has qualification and grading differences; Scotland has National Qualifications. The interface must identify the actual course without making the student understand our internal taxonomy.
6. **Readable text needs measured pairings.** Existing muted text `#657087` measures 4.41:1 on workspace `#F5F1E8`, below WCAG AA for normal text. It measures 4.98:1 on white. A token that passes on one surface cannot be used everywhere.

## Evidence method and limits

- Read `AGENTS.md`, `DESIGN.md`, `README.md`, the October roadmap, baseline notes, current components, domain models, HTTP handlers, job storage, tests, and package configuration.
- Used search results from official organisations and first-party product pages. Competitor claims describe their positioning; they are not independently verified efficacy evidence.
- Rendered public pages in isolated cached Chromium. Captured screenshots and DOM/computed-style observations. Inspected the landing, builder error, Cognito course page, Save My Exams page, Recent gallery, COSS tabs page, and GOV.UK documentation screenshots.
- Did not sign in, create a real student account, submit answers, generate production papers, or inspect private student data.
- `node_modules` is absent. No current local application build, test suite, or production performance measurement ran. The documentation work does not establish application correctness.
- October Lighthouse numbers were taken in development mode. They must not be quoted as current production performance.
- The `be-ambitious` skill was not found in active plugin or user skill discovery. The requested ambition is reflected in the proposal.
- The first browser connector failed because session metadata was unavailable. Installing `agent-browser` timed out against npm. A third approach, the locally cached Chromium binary with CDP, produced the evidence.

Temporary evidence lives at `/tmp/gcsemeta-design-research-2026-11-01/`. PNG and JSON files share names. Temporary files may be cleared by the OS; durable observations are recorded below.

| Artifact | Observation | Evidence boundary |
| --- | --- | --- |
| `home-desktop.png`, `.json` | Working landing; large paper fan; navigation about 11.7px and main CTA 12.5px | Observed live at 1440×1000 |
| `builder-desktop.png`, `.json` | “This page could not finish loading.” | Observed live at 1440×1000 |
| `builder-mobile.png`, `.json` | Same failure; no escape route to home in the error view | Observed live at 390×844 |
| `marking-mobile.png`, `.json` | `/marking` redirects to sign-in; input text computes to 13.44px | Unauthenticated only; iOS zoom was not tested |
| `cognito-desktop.png`, `.json` | Course identity, study-mode navigation, grouped syllabus rows, 16px topic links | Public A-level course used as an interaction reference, not GCSE coverage evidence |
| `sme-desktop.png`, `.json` | Target Test promise, configurable time/topics, feedback journey | Public marketing page; logged-in experience not reviewed |
| `recent-desktop.png`, `.json` | Gallery renders; quiet chrome around work | Gallery reference only; no individual product flow validated |
| `coss-desktop.png`, `.json` | Persistent labelled tabs and documentation of Base UI backing | Visual/reference inspection, not an accessibility audit of COSS |
| `govuk-desktop.png`, `.json` | Task-list guidance rendered; embedded demo blank in this capture | Guidance supports the decision; embedded example not verified |
| `inspora-desktop.png`, `.json` | Blank page in browser | Unavailable as visual evidence |
| `collectui-desktop.png`, `.json` | Shell and loading text, no usable upload example | Unavailable as a vetted pattern |

## Current product audit

These are precise changes to pursue, not claims that the future design has been implemented.

| Priority | Before: current evidence | After: proposed behaviour | Why |
| --- | --- | --- | --- |
| P0 | Live builder error at both inspected sizes | A course picker that loads; a recoverable service failure if data is unavailable | Every acquisition path depends on it |
| P0 | `infrastructure/jobs/generation-jobs.ts`: `const jobs = new Map` and detached `void runJob(job)` | Durable job record, worker execution, authenticated ownership or guest capability, recoverable artifacts | A job must survive navigation and server lifecycle changes |
| P1 | `presentation/success-modal.tsx`: “generated and downloaded” after initiating a browser download | “Paper ready”; explicit repeatable Download/Open controls | A programmatic click does not prove a file reached the device |
| P1 | Controller result and active job are local React state; no draft storage found there | Course/topic/length draft survives refresh; result has a stable address | Removing interruption cost is a tangible product advantage |
| P1 | `paper-assembly-modal.tsx`: Cancel exists, Escape prevented, large canvas occupies the dialog | Inline progress, a clear Stop action, continued navigation once durability exists | The job should not hold the whole app hostage |
| P1 | `active-question-panel.tsx`: response, guidance, decision stack below `xl` | Desktop comparison, tablet 2-pane arrangement, mobile labelled panels with persistent question context | Stacking everything makes checking one mark expensive |
| P1 | `marking-submission-workspace.tsx`: bulk upload assigns files to unfilled questions by index | Explicit mapping with page thumbnails and question labels before processing | File order is not reliable answer identity |
| P1 | `marking-dashboard.tsx`: PDF iframe thumbnail | Static preview or document title fallback | A list should not initialise multiple PDF viewers |
| P1 | Builder controls use sizes around 10.9–12.8px; authentication inputs 13.44px live | 14px control labels, 16px inputs/body, 12px metadata floor | Readability, phone usability, and a coherent scale |
| P1 | `.text-muted` token on workspace measures 4.41:1 | Use stronger body text on warm canvas; muted remains allowed on white | Measured normal-text contrast failure |
| P1 | `app/error.tsx` repeats the heading and asserts selections are preserved | One explanation, Retry, Home, and draft restoration only when actually persisted | Recovery copy must match storage behaviour |
| P2 | Landing shows Geography content in a fan with a Business cover and another subject behind | One coherent, rights-cleared paper story per proof section | The artifact should explain the product rather than combine unrelated examples |
| P2 | Marketing includes a worked marking demonstration without an obvious example label in extracted text | Visible “Illustrative example”; separate any observed user results | An example is useful, but should not resemble measured product performance |
| P2 | Existing `BrandMark` has hard-coded navy, mint, and white alongside `currentColor` | Validate small-size, single-colour and reverse uses before expanding applications | Setting `currentColor` alone cannot create a true monochrome version |

The October audit is a lead, not a current defect list. Current code already contains a selection reducer, generation progress/cancel controls, locked saved-question maximums, scoped auth, and scoring changes. Reuse these. Do not repeat the old audit's claim that they are all missing.

## Learning research

**EEF: Cognitive science approaches in the classroom**

Source: https://educationendowmentfoundation.org.uk/education-evidence/evidence-reviews/cognitive-science-approaches-in-the-classroom

The review supports investigating retrieval, spacing, and cognitive-load approaches, while warning that classroom implementation evidence varies. Design implication: put attempting, checking, and acting on feedback in a short understandable sequence. It does not validate our marking accuracy, a predicted grade, or a particular review interval.

**Agarwal, Nunes and Blunt: retrieval-practice review**

Source: https://doi.org/10.1007/s10648-021-09595-9

The abstract reports 50 experiments, 49 effect sizes, and 5,374 participants; 57% of effect sizes showed medium or large benefits. Design implication: make active practice easy to start and repeat. Do not transfer those results into a product efficacy claim.

**GOV.UK: task list**

Source: https://design-system.service.gov.uk/components/task-list/

Use a task list when people need choice of task order and multiple sittings. Simplify the service first. Design implication: a paper library may show unfinished tasks; the ordered builder should remain a short flow. A dashboard is not automatically a better starting point.

## Competition and positioning

| Source | Observed offering | What to learn | What not to claim |
| --- | --- | --- | --- |
| [Cognito](https://cognito.org/) and [inspected course](https://cognito.org/courses/alevel/biology/ocr/exam-practice/mcqs) | Videos/notes, quizzes, flashcards, exam practice, custom papers | Keep course identity visible and topic hierarchy readable | Custom paper creation is unique |
| [Save My Exams Target Test](https://www.savemyexams.com/study-tools/target-test/) | Topic, time, difficulty and question-type customisation; feedback and next steps | Explain the complete attempt-to-feedback journey before asking for commitment | A personalised test is a new category |
| [Save My Exams AI tools](https://www.savemyexams.com/study-tools/ai-study-tools/) | Typed/handwritten answer marking and explanations | Students expect actionable feedback, not just a numerical score | Their accuracy or grade claims apply to this product |
| [Seneca](https://senecalearning.com/en-gb/) | Interactive courses and exam questions with AI marking | Short actions and a clear next step reduce initiation effort | Gamification alone creates learning or trust |

Recommended positioning: **focused paper practice with feedback you can check**. The defensible work is faithful paper composition, understandable evidence, reliable recovery, and a clean repeat-practice path. Whether students prefer this remains a research question.

## Reference board and component decisions

Brief: an operating and reading workspace for a tired GCSE student who wants useful practice without administering a revision system.

| Reference inspected | Take | Reject |
| --- | --- | --- |
| Cognito course page | Persistent course name and a scannable syllabus tree | Copying its rounded visual treatment or expanding into five study products |
| Save My Exams Target Test | Concrete user choices and a visible complete journey | Generic benefit-card layout and unverified efficacy copy |
| GOV.UK task-list guidance | Explicit progress and reliable return points | Turning the simple builder into a bureaucratic task list |
| COSS tabs | Stable text labels and a shared selected indicator | Icon-only collapsed labels on essential mobile navigation |
| Recent gallery | Make the substantive artifact larger than its surrounding chrome | Borrowing unrelated visual effects from the feed |

Inspora and Collect UI were attempted through search and browser; no usable rendered reference was obtained. No recommendation relies on their unseen visuals.

| Candidate inspected through its documentation | Decision | Dependency/licensing treatment |
| --- | --- | --- |
| [COSS tabs](https://coss.com/ui/docs/components/tabs) | Reference for mobile review panels; use an existing semantic project pattern first | Would add Base UI/registry source. Licence must be verified at implementation if adopted |
| [COSS dialog](https://coss.com/ui/docs/components/dialog) | Reference for complex focus behaviour; current native `<dialog>` remains first choice | No library migration planned |
| [Bencho upload dropzone](https://bencho.dev/blocks/upload-dropzone) | Study per-file acknowledgement; native input plus project styles is sufficient | Page permits product use subject to its licence; no source copied |
| [Bencho tab bar](https://bencho.dev/blocks/tab-bar) | Reject labels visible only for the selected tab | No installation |
| [Aceternity multi-step loader](https://ui.aceternity.com/components/multi-step-loader) | Reject timed progression; show actual server stages | Documented `duration`/`loop` defaults are unsuitable as job truth |
| [Cult Dynamic Island](https://www.cult-ui.com/docs/components/dynamic-island) | Reject as a direct transplant; progress belongs beside the paper | Existing Motion is sufficient |
| [ReactDrops chromatic button](https://reactdrops.dev/components/button/chromatic-button) | Reject continuous material effects on task controls | Unknown source licence is immaterial because no code is used |

Keep React, Tailwind 4, Motion, lucide-react, native form controls, and native dialog. No shader, GSAP, chart, state-management, or new icon dependency is justified by this plan. Database palette lookup was deliberately skipped because `DESIGN.md` and production tokens already define the system.

## UK reach: facts with design consequences

| Source | Fact relevant to this product | Consequence |
| --- | --- | --- |
| [Qualifications Wales](https://qualifications.wales/information-support/learners-parents-carers/qualifications/pre-16-qualifications/gcses/) | Reformed GCSEs introduced in waves from September 2025 and September 2026, with English/Cymraeg availability and science transition details | Key coverage by specification version and teaching/exam cohort. WJEC and Eduqas cannot be interchangeable labels |
| [CCEA regulation](https://ccea.org.uk/regulation/qualifications-regulation/information-gce-and-gcse/gcse) | NI has an open qualifications market with policy constraints; CCEA and other boards differ in grading and assessment | Do not infer course or grading system from country alone |
| [Qualifications Scotland](https://www.sqa.org.uk/sqa/96425.html) | National 5, Higher and Advanced Higher have their own course assessment structures | A future Scottish offer needs a separate qualification model, not a GCSE skin |
| [ICO edtech guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/the-children-s-code-and-education-technologies-edtech/) | Edtech providers may be within the Children's code depending on their processing role | Define minimal course/account data and private answer storage; assess actual applicability |
| [ICO code standards](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/code-standards/) | High privacy by default, minimisation, clear age-appropriate explanations | Avoid public student profiles, unnecessary date of birth/school collection, and answer text in analytics |
| [ICO nudge guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/13-nudge-techniques/) | Do not nudge children into unnecessary disclosure or weaker privacy | Equal-effort privacy choices; no streak penalty tied to personal-data collection |
| [AQA copyright policy](https://www.aqa.org.uk/about-us/who-we-are/our-standards/copyright-and-intellectual-property-policy) | Published restrictions include third-party reproduction and AI-related use | Owner must establish applicable rights and permissions before broad distribution; existing permissions were not examined |

The copyright point is a concrete constraint from a named source, not a finding that this project lacks permission. UI planning and local implementation can proceed. Content-rights evidence is a separate public-launch dependency.

## Measured colour pairs

Computed using WCAG relative luminance on the opaque hex values in `DESIGN.md`. These are token calculations, not a full rendered-page audit; alpha, hover, disabled and overlay states need separate checks.

| Foreground / background | Ratio | Normal text |
| --- | --- | --- |
| Ink `#0D1734` / workspace `#F5F1E8` | 15.67:1 | Pass |
| Body `#35415F` / workspace | 8.99:1 | Pass |
| Muted `#657087` / workspace | 4.41:1 | Fail |
| Muted / white | 4.98:1 | Pass |
| White / indigo `#4747D8` | 6.64:1 | Pass |
| Success `#0A6B4F` / white | 6.50:1 | Pass |
| Warning `#946200` / white | 5.24:1 | Pass |
| White / mint `#62E2B6` | 1.61:1 | Fail |
| Ink / mint | 10.99:1 | Pass |

Reference standards: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [new criteria](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), and [Web Vitals](https://web.dev/articles/vitals). The product target is 44px touch controls; WCAG 2.2 AA's target-size minimum is 24px with specified exceptions. These are different statements.
