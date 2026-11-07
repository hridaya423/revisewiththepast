# Perfection pass: what changed after the first complete plan

This is a review of the planning deliverable. It does not claim the application has been rebuilt.

## The 80% version

The done-claim would have been:

> “The redesign plan is complete: improve typography, simplify the builder, add mobile marking tabs, polish the motion, and show a better landing-page demo.”

That would describe a nicer interface while leaving the hardest parts unspecified: what happens after a refresh, which paper a returning user sees, how uploaded pages map to questions, whether marks are actually confirmed, and what the product can truthfully promise.

## The last 20%

| Gap found | Correction in the final plan | Evidence / closure |
| --- | --- | --- |
| The current public journey might not work | Make route restoration Task 0, before visual release claims | Live `/paper-maker` rendered the error boundary at 1440×1000 and 390×844; captures recorded in the research document |
| Earlier audit findings could be stale | Distinguish existing work from missing behaviour | Read current reducer, scoped auth, progress/cancel and locked-maximum paths; plan reuses them |
| “Smooth” could mean adding animation | Define persistence, immediate feedback, stable layout and interruption behaviour first | Current jobs are in a process-local `Map`; design §10 and Tasks 6–8 specify durable execution and stored PDF bytes |
| A successful browser click was being treated as a download | Replace completion claim with repeatable artifact actions | `success-modal.tsx` says “generated and downloaded”; controller only clicks a blob link |
| A saved URL might leak a student's job | Separate identity from authorisation | Existing handlers look up jobs by ID; Task 7 covers owner/capability checks, expiry, private caching and sign-in claim |
| “Back preserves work” lacked a URL contract | Define stage query, push/replace behaviour, invalid-stage fallback and job precedence | Re-read `app/paper-maker/page.tsx`; final plan now includes the page boundary as a modification target |
| Generation could be durable while artifact bytes were still volatile | Persist artifacts separately and prove access after restart | Current `StoredJob` holds `paperBytes`, `markSchemeBytes` and `combinedBytes`; Task 6 explicitly tests real PDFs after executor restart |
| Separate scheme downloads lacked an endpoint | Include scheme artifact exposure in Task 8 | Current file resolver supports `combined` and `paper-N`; proposed `scheme-N` is identified as new work |
| Bulk uploads could silently attach the wrong answer | Require explicit many-to-many page/question mapping | Current bulk upload indexes files against missing questions; Task 10 includes migration and retry semantics |
| Evidence highlights could look authoritative without grounding | Make verified locations optional and define text/page fallback | Current model exposes `evidenceJson`; reliable scan coordinates are not guaranteed |
| Mobile “responsive” was too vague | Specify three layouts, labelled panels, scan zoom, footer and keyboard behaviour | Current marking grid begins at `xl`; the plan names 320/390/768/1440 checks and real-device gates |
| The established palette might not pass contrast | Restrict colour use by surface | WCAG calculation: muted-on-workspace 4.41:1; muted-on-white 4.98:1; white-on-mint 1.61:1 |
| UK-wide could imply unsupported curriculum coverage | Add specification/cohort/language-aware expansion gates | Qualifications Wales, CCEA and Qualifications Scotland sources recorded in research |
| Competitor overlap could undermine the positioning | Focus the proposal on execution quality and inspectable feedback | First-party Cognito and Save My Exams pages already offer custom tests and AI marking |
| New design libraries could add weight without value | Keep installed Motion/lucide/native controls; reject ornamental effects | Package inventory and component documentation compared; no dependency added |
| The plan might accidentally reintroduce the excluded evaluation set | Separate UI correctness from grading efficacy | Design scope, Task 12 and verification boundaries explicitly preserve the exclusion |
| Old test instructions might not run | Use exact existing tooling and resolve file targets | `package.json` has no `test:e2e`; use `npx playwright test`; inspected actual test files and HTTP router |
| Brand ambition could become a distracting rebrand | Retain identity; validate small-size and monochrome applications | Existing SVG uses several hard-coded colours, so `currentColor` alone is not monochrome |
| Public-launch requirements might be dismissed as generic risk | Record only sourced, relevant dependencies | AQA published reproduction/AI restrictions and ICO edtech guidance; existing permissions and policies not assumed absent |

The extra pass made the scope smaller in several places: no new mastery system, no grade predictions, no dashboard of invented statistics, no new motion library, no rotating subject presentation, and no automated confirmation justified by a confidence score.

## Fresh-eyes review

Checked the package for:

- Inputs: invalid routes, removed topics, tier changes, malformed local storage, file types, duplicate files, invalid marks and stale score revision.
- States: loading, no results, no selection, empty library, expired session, missing evidence, partial success, cancellation race, offline and reconnect.
- Claims: UK coverage, learning benefits, examiner equivalence, download completion, preserved work and performance numbers.
- Visual decisions: type roles, contrast, full scan visibility, long labels, fixed footer, mobile labels, grayscale and reduced motion.
- Engineering handoff: real file paths, route wiring, migration direction, test homes, private-environment setup, deployment boundary and rollback.

These checks improve the plan's completeness. They cannot prove the future UI is attractive, fast, accessible, or easy to use. Those are explicit implementation and user-research gates.

## What is still imperfect

| Open item | Why it remains | Next evidence / owner |
| --- | --- | --- |
| Live builder failure | Planning observed the error but did not establish the backend/deployment cause | Implementing engineer: Task 0, with deployment logs if local reproduction differs |
| Authenticated marking experience | No private test session was used | Implementing engineer: local/private fixture and browser walkthrough |
| Local build and current automated baseline | `node_modules` is absent; this session changed documentation only | Implementing engineer: `npm ci`, installed Next guides and Task 0 commands |
| Future layout and motion quality | No new production UI or visual prototype was built | Implementation screenshots, interaction traces and real-device review in Tasks 5, 11 and 14 |
| Durable worker placement | Actual PDF/canvas compatibility and limits have not been tested in the proposed executor | Task 6 spike; owner chooses hosting only if the evidence requires a new deployment arrangement |
| Scoring accuracy | The evaluation set was explicitly excluded | Keep AI labels and human confirmation; make no measured accuracy or grade claims |
| Student preference and usability | Research was desk research and public-interface inspection | Moderated tasks in design §12; actual recruitment requires owner authorisation |
| Content rights, policies and retention | Existing permissions and operational policies were not available in this review | Owner provides/approves the applicable rights and policy decisions before public rollout |
| National rollout order and business model | Only the owner can set commercial priorities | Proposed initial focus is current supported GCSE courses; expansion follows demand and readiness |
| Some inspiration sources | Inspora was blank; Collect UI supplied no usable rendered example; GOV.UK embedded example did not load | No design claim depends on the unseen material; verified alternatives are sufficient |

## Evidence standard for the next session

Do not call the application complete because this plan is complete. Each implemented behaviour needs the corresponding observed result. Mocked UI states help review presentation; real storage, real routing and real allowed sample artifacts must prove recovery.

Temporary screenshots are supporting evidence, not the handoff's sole source of truth. The research document records the observations, and the implementation plan records what remains to build.
