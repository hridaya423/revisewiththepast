import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";

import { BrandMark } from "@/app/_components/brand-mark";
import { MarkingAnnotationPlate } from "@/app/_components/landing/marking-annotation-plate";
import { PaperFan } from "@/app/_components/landing/paper-fan";
import { SubjectOptionWheel } from "@/app/_components/landing/subject-option-wheel";
import { WorkflowPaper } from "@/app/_components/landing/workflow-paper";
import { LandingMotion } from "@/app/_components/landing-motion";
import { TyperText } from "@/app/_components/typer/typer-text";
import { PAPER_MAKER_SUBJECTS } from "@/features/papers/server";

const ENABLED_SUBJECTS = PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled);

const SUBJECT_CARDS = Array.from(ENABLED_SUBJECTS.reduce((cards, subject) => {
  const existing = cards.get(subject.coverTitle) ?? [];
  existing.push(subject);
  cards.set(subject.coverTitle, existing);
  return cards;
}, new Map<string, typeof ENABLED_SUBJECTS>()).entries()).map(([title, subjects]) => ({ title, subjects }));

function MarketingNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-border bg-white">
      <nav className="mx-auto flex h-full max-w-[1280px] items-center justify-between px-4 sm:px-8 lg:px-10" aria-label="Main navigation">
        <Link href="/" className="group flex min-w-0 items-center gap-2.5 font-extrabold tracking-[-0.035em] text-text transition-colors hover:text-accent">
          <BrandMark className="h-8 w-7 shrink-0 text-accent transition-colors group-hover:text-text" title="Revise with the Past" />
          <span className="hidden text-[0.95rem] sm:block">Revise with the Past</span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          <a href="#how" className="text-[0.73rem] font-bold text-text-secondary transition-colors hover:text-accent">How it works</a>
          <a href="#subjects" className="text-[0.73rem] font-bold text-text-secondary transition-colors hover:text-accent">Subjects</a>
          <Link href="/marking" transitionTypes={["nav-forward"]} className="text-[0.73rem] font-bold text-text-secondary transition-colors hover:text-accent">Mark a paper</Link>
        </div>
        <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="btn-press inline-flex h-10 items-center gap-2 rounded-[4px] bg-accent px-4 text-[0.74rem] font-extrabold text-white transition-colors hover:bg-accent-deep">
          <span className="sm:hidden">Build</span>
          <span className="hidden sm:inline">Build a paper</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
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
        <section data-landing-hero className="flex min-h-[calc(100svh-64px)] items-center bg-bg-warm px-4 pb-20 pt-[120px] sm:px-8 sm:pb-24 sm:pt-[136px] lg:px-10 lg:py-28">
          <div className="mx-auto grid w-full max-w-[1280px] gap-14 lg:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12 xl:grid-cols-[500px_minmax(0,1fr)] xl:gap-16">
            <div className="mx-auto text-center lg:mx-0 lg:text-left">
              <h1 data-hero-reveal className="mx-auto max-w-[12ch] text-[clamp(3rem,4.5vw,4.35rem)] font-extrabold leading-[0.96] tracking-[-0.058em] text-text lg:mx-0">Build a paper from what you’ve <TyperText>studied.</TyperText></h1>
              <p data-hero-reveal className="mx-auto mt-6 max-w-[42ch] text-[0.96rem] font-medium leading-7 text-text-muted sm:text-[1.02rem] lg:mx-0">Pick your course and topics. We’ll make a focused paper from real exam questions.</p>
              <div data-hero-reveal className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 lg:justify-start">
                <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="btn-press inline-flex min-h-12 min-w-44 items-center justify-center gap-3 rounded-md bg-accent px-6 text-[0.78rem] font-extrabold text-white hover:bg-accent-deep">
                  Build a paper
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a href="#how" className="inline-flex min-h-12 items-center gap-2 px-3 text-[0.76rem] font-bold text-accent hover:text-accent-deep">See how it works <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
              </div>
            </div>
            <div data-hero-reveal><PaperFan /></div>
          </div>
        </section>

        <section id="marking-proof" className="scroll-mt-16 border-t border-text/[0.08] bg-bg-soft px-4 py-20 sm:px-8 sm:py-24 lg:px-10 lg:py-28">
          <div className="mx-auto grid max-w-[1220px] gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-start lg:gap-16">
            <div data-scroll-reveal className="lg:pt-8">
              <h2 className="max-w-[11ch] text-[clamp(2.45rem,4.3vw,3.8rem)] font-extrabold leading-[1.01] tracking-[-0.052em]">See where each mark came from.</h2>
              <p className="mt-6 max-w-[40ch] text-[0.88rem] leading-7 text-text-secondary">Keep the answer, marking guidance and next step together.</p>
              <ul className="mt-8 space-y-3 text-[0.75rem] font-semibold text-text-secondary">
                {["What worked", "What was missing", "What to practise next"].map((item) => (
                  <li key={item} className="flex items-center gap-2.5"><CircleCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />{item}</li>
                ))}
              </ul>
            </div>

            <MarkingAnnotationPlate />
          </div>
        </section>

        <section id="how" className="scroll-mt-16 border-t border-text/[0.09] bg-bg-warm px-4 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
          <div className="mx-auto max-w-[1160px]">
            <h2 data-scroll-reveal className="text-center text-[clamp(2rem,3.8vw,3.25rem)] font-extrabold leading-[1.04] tracking-[-0.05em]">A paper becomes a plan.</h2>
            <div data-scroll-reveal className="mt-12"><WorkflowPaper /></div>
            <div data-scroll-reveal className="mt-10 flex justify-center text-[0.72rem]">
              <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="inline-flex items-center gap-2 font-bold text-accent transition-colors hover:text-text">Build a paper <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section id="subjects" className="scroll-mt-16 border-t border-border bg-bg-soft px-4 py-20 sm:px-8 sm:py-24 lg:px-10 lg:py-28">
          <div className="mx-auto max-w-[1160px]">
            <h2 className="max-w-[18ch] text-[clamp(2.3rem,4.5vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.055em]">Practice what’s on your course.</h2>
            <div className="mt-10">
              <SubjectOptionWheel
                items={SUBJECT_CARDS.map(({ title, subjects }) => ({
                  title,
                  subjectKey: subjects[0]?.key ?? "",
                  routes: subjects.map((subject) => ({
                    key: subject.key,
                    boardLabel: subject.boardLabel,
                    tierLabel: subject.tiers.length === 1 ? subject.tiers[0]?.label : undefined,
                  })),
                }))}
              />
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-text/10 bg-bg-warm px-4 py-20 text-text sm:px-8 sm:py-24 lg:px-10 lg:py-28">
          <div data-scroll-reveal className="relative mx-auto flex max-w-[1160px] flex-col items-center text-center">
            <h2 className="max-w-[18ch] text-[clamp(2.4rem,5vw,4.3rem)] font-extrabold leading-[1.02] tracking-[-0.055em] text-text">Build your next practice paper.</h2>
            <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="btn-press mt-8 inline-flex min-h-12 min-w-52 items-center justify-center gap-3 rounded-[4px] bg-accent px-6 text-[0.78rem] font-extrabold text-white transition-colors hover:bg-accent-deep">
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
            <span className="text-[0.82rem]">Revise with the Past</span>
          </Link>
          <nav aria-label="Footer navigation" className="flex flex-wrap gap-6 text-[0.7rem] font-bold text-text-muted">
            <Link href="/paper-maker" transitionTypes={["nav-forward"]} className="transition-colors hover:text-accent">Build</Link>
            <Link href="/marking" transitionTypes={["nav-forward"]} className="transition-colors hover:text-accent">Mark</Link>
            <Link href="/docs/mcp" className="transition-colors hover:text-accent">MCP docs</Link>
            <Link href="/auth" className="transition-colors hover:text-accent">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
