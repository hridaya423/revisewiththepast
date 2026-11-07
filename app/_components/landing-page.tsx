import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";

import { BrandMark } from "@/app/_components/brand-mark";
import { CourseDirectory } from "@/app/_components/landing/course-directory";
import { HeroPaper } from "@/app/_components/landing/hero-paper";
import { MarkingAnnotationPlate } from "@/app/_components/landing/marking-annotation-plate";
import { WorkflowPaper } from "@/app/_components/landing/workflow-paper";
import { LandingMotion } from "@/app/_components/landing-motion";
import { PAPER_MAKER_SUBJECTS } from "@/features/papers/server";

const ENABLED_SUBJECTS = PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled);

const SUBJECT_CARDS = Array.from(ENABLED_SUBJECTS.reduce((cards, subject) => {
  const existing = cards.get(subject.coverTitle) ?? [];
  existing.push(subject);
  cards.set(subject.coverTitle, existing);
  return cards;
}, new Map<string, typeof ENABLED_SUBJECTS>()).entries())
  .map(([title, subjects]) => ({
    title,
    routes: subjects.map((subject) => ({ key: subject.key, boardLabel: subject.boardLabel, tierLabel: subject.tiers.length === 1 ? subject.tiers[0]?.label : undefined })),
  }))
  .sort((left, right) => left.title.localeCompare(right.title));

const BOARD_NAMES = Array.from(new Set(ENABLED_SUBJECTS.map((subject) => subject.boardLabel)));
const BOARD_SUMMARY = BOARD_NAMES.length > 1 ? `${BOARD_NAMES.slice(0, -1).join(", ")} and ${BOARD_NAMES.at(-1)}` : BOARD_NAMES[0] ?? "";

function MarketingNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-border bg-white">
      <nav className="mx-auto flex h-full max-w-[1280px] items-center justify-between px-4 sm:px-8 lg:px-10" aria-label="Main navigation">
        <Link href="/" className="group flex min-w-0 items-center gap-2.5 font-extrabold tracking-[-0.035em] text-text transition-colors hover:text-accent">
          <BrandMark className="h-8 w-7 shrink-0 text-accent transition-colors group-hover:text-text" title="Revise with the Past" />
          <span className="hidden text-[0.95rem] sm:block">Revise with the Past</span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          <a href="#how" className="text-sm font-semibold text-text-secondary transition-colors hover:text-accent">How it works</a>
          <a href="#subjects" className="text-sm font-semibold text-text-secondary transition-colors hover:text-accent">Subjects</a>
          <Link href="/marking" transitionTypes={["nav-forward"]} className="text-sm font-semibold text-text-secondary transition-colors hover:text-accent">Mark a paper</Link>
        </div>
        <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="btn-press inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-deep">
          <span className="sm:hidden">Build</span>
          <span className="hidden sm:inline">Build a paper</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </nav>
    </header>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-bg font-sans text-text">
      <LandingMotion />
      <MarketingNav />
      <main>
        <section data-landing-hero className="bg-bg-warm px-4 pb-16 pt-24 sm:px-8 sm:pb-20 sm:pt-32 lg:px-10 lg:pb-24">
          <div className="mx-auto grid w-full max-w-[1200px] gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:items-center lg:gap-16">
            <div className="text-center lg:text-left">
              <h1 data-hero-reveal className="mx-auto max-w-[13ch] text-[2.5rem] font-extrabold leading-[1.02] tracking-[-0.045em] text-text sm:text-[3.5rem] lg:mx-0 lg:text-[4rem]">Practise the topics you need.</h1>
              <p data-hero-reveal className="mx-auto mt-5 max-w-[40ch] text-lg leading-7 text-text-secondary lg:mx-0">Build a focused paper for your course from real exam questions. Check your answers against the mark scheme and decide what to practise next.</p>
              <div data-hero-reveal className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="btn-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-6 text-base font-semibold text-white hover:bg-accent-deep sm:w-auto">
                  Build a paper
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </Link>
                <a href="#marking-proof" className="inline-flex min-h-12 items-center gap-2 px-3 text-base font-semibold text-accent hover:text-accent-deep">See how marking works</a>
              </div>
              <p data-hero-reveal className="mt-6 text-sm text-text-secondary">{SUBJECT_CARDS.length} GCSE subjects from {BOARD_SUMMARY}. <a href="#subjects" className="font-semibold text-text underline decoration-text/30 underline-offset-4 hover:text-accent">Check your course</a></p>
            </div>
            <div data-hero-reveal><HeroPaper /></div>
          </div>
        </section>

        <section id="marking-proof" className="scroll-mt-16 border-t border-text/10 bg-bg-soft px-4 py-16 sm:px-8 sm:py-24 lg:px-10">
          <div className="mx-auto grid max-w-[1200px] gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-start lg:gap-16">
            <div data-scroll-reveal className="lg:pt-10">
              <h2 className="max-w-[14ch] text-[2rem] font-extrabold leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">See where each mark came from.</h2>
              <p className="mt-5 max-w-[42ch] text-lg leading-7 text-text-secondary">Upload a photo of your answer. Each question shows your work, the mark scheme and the marking points side by side.</p>
              <ul className="mt-7 space-y-3 text-base text-text">
                {["Which marking points you earned", "What was missing, and why", "A topic to practise next"].map((item) => (
                  <li key={item} className="flex items-start gap-3"><CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />{item}</li>
                ))}
              </ul>
              <p className="mt-7 max-w-[42ch] border-l-2 border-accent pl-4 text-base leading-6 text-text"><span className="font-semibold">Suggested marks are yours to check.</span> AI suggestions stay unconfirmed until you agree with them or change them.</p>
            </div>

            <div data-scroll-reveal className="overflow-hidden rounded-[3px] border border-text/15 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-text/10 px-4 py-3">
                <p className="text-sm font-semibold text-text">Question 3(c) <span className="font-normal text-text-secondary">· 6 marks</span></p>
                <p className="rounded-md bg-bg-warm px-2 py-1 text-xs font-semibold text-text-secondary">Illustrative example</p>
              </div>
              <MarkingAnnotationPlate />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-text/10 px-4 py-3">
                <p className="text-sm font-semibold text-text">AI suggestion · <span className="font-mono tabular-nums">4 / 6</span></p>
                <p className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white" aria-hidden="true">Confirm mark</p>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-16 border-t border-text/[0.09] bg-bg-warm px-4 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
          <div className="mx-auto max-w-[1160px]">
            <h2 data-scroll-reveal className="text-center text-[2rem] font-extrabold leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">One paper, start to finish.</h2>
            <div data-scroll-reveal className="mt-12"><WorkflowPaper /></div>
            <div data-scroll-reveal className="mt-10 flex justify-center">
              <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="inline-flex min-h-11 items-center gap-2 text-base font-semibold text-accent transition-colors hover:text-accent-deep">Build a paper <ArrowRight className="h-5 w-5" aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section id="subjects" className="scroll-mt-16 border-t border-text/10 bg-bg-soft px-4 py-16 sm:px-8 sm:py-24 lg:px-10">
          <div className="mx-auto max-w-[1000px]">
            <h2 className="text-[2rem] font-extrabold leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">Courses you can build today</h2>
            <p className="mt-4 max-w-[52ch] text-lg leading-7 text-text-secondary">Choose your exam board to start. More courses will be added as their questions and mark schemes are checked.</p>
            <div className="mt-8"><CourseDirectory rows={SUBJECT_CARDS} /></div>
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-text/10 bg-bg-warm px-4 py-16 text-text sm:px-8 sm:py-24 lg:px-10">
          <div data-scroll-reveal className="relative mx-auto flex max-w-[1160px] flex-col items-center text-center">
            <h2 className="max-w-[18ch] text-[2rem] font-extrabold leading-[1.08] tracking-[-0.04em] text-text sm:text-[2.75rem]">Build your next practice paper.</h2>
            <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="btn-press mt-8 inline-flex min-h-12 min-w-52 items-center justify-center gap-2 rounded-md bg-accent px-6 text-base font-semibold text-white transition-colors hover:bg-accent-deep">
              Build a paper
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-white px-4 py-9 text-text sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-extrabold tracking-[-0.03em] transition-colors hover:text-accent">
            <BrandMark className="h-8 w-7 text-accent" />
            <span className="text-base">Revise with the Past</span>
          </Link>
          <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold text-text-secondary">
            <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="inline-flex min-h-11 items-center transition-colors hover:text-accent">Build a paper</Link>
            <Link href="/marking" transitionTypes={["nav-forward"]} className="inline-flex min-h-11 items-center transition-colors hover:text-accent">My papers</Link>
            <Link href="/docs/mcp" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">MCP docs</Link>
            <Link href="/support" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">Support</Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">Privacy</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">Terms</Link>
            <Link href="/auth" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">Sign in</Link>
          </nav>
        </div>
        <p className="mx-auto mt-6 max-w-[1160px] text-sm text-text-secondary">
          <a href="https://www.hridya.tech/projects/revise" className="font-semibold transition-colors hover:text-accent">Built by Hridya Agrawal</a>
        </p>
      </footer>
    </div>
  );
}
