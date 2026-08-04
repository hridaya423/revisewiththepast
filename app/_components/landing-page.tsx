import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CircleCheck, FilePlus2, PencilLine, TrendingUp } from "lucide-react";

import { BrandMark } from "@/app/_components/brand-mark";
import { EmbossIcon } from "@/app/_components/emboss/emboss-icon";
import { EMBOSS_PRESETS } from "@/app/_components/emboss/params";
import { LandingMotion } from "@/app/_components/landing-motion";
import { SUBJECT_COLORS, SUBJECT_ICONS } from "@/app/_components/subject-presentation";
import { PAPER_MAKER_SUBJECTS } from "@/features/papers/server";

const ENABLED_SUBJECTS = PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled);

const SUBJECT_CARDS = Array.from(ENABLED_SUBJECTS.reduce((cards, subject) => {
  const existing = cards.get(subject.coverTitle) ?? [];
  existing.push(subject);
  cards.set(subject.coverTitle, existing);
  return cards;
}, new Map<string, typeof ENABLED_SUBJECTS>()).entries()).map(([title, subjects]) => ({ title, subjects }));

const STEPS = [
  { title: "Build", description: "Choose your course, topics and paper length.", icon: FilePlus2, color: "#4E7760" },
  { title: "Complete", description: "Work through one focused paper.", icon: PencilLine, color: "#496D8C" },
  { title: "Mark", description: "Check each answer against the marking guidance.", icon: BadgeCheck, color: "#0A6B4F" },
  { title: "Improve", description: "Use the gaps to choose what to practise next.", icon: TrendingUp, color: "#946200" },
];

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
          <Link href="/marking" className="text-[0.73rem] font-bold text-text-secondary transition-colors hover:text-accent">Mark a paper</Link>
        </div>
        <Link href="/paper-maker" className="btn-press inline-flex h-10 items-center gap-2 rounded-[4px] bg-accent px-4 text-[0.74rem] font-extrabold text-white transition-colors hover:bg-accent-deep">
          <span className="sm:hidden">Build</span>
          <span className="hidden sm:inline">Build a paper</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </nav>
    </header>
  );
}

function ExamPaperArtifact() {
  return (
    <div className="relative h-[340px] w-full sm:h-[440px] lg:h-[480px] xl:h-[520px]" role="group" aria-label="Real pages from generated GCSE practice papers">
      <div className="absolute bottom-[5%] left-[17%] right-[17%] h-10 rounded-[50%] bg-text/[0.055] blur-2xl" aria-hidden="true" />

      <figure className="absolute left-[2%] top-[19%] z-10 aspect-[0.707] w-[34%] -rotate-[4deg] overflow-hidden rounded-[3px] border border-text/12 bg-white shadow-[0_16px_38px_rgba(13,23,52,0.11)] transition-transform duration-300 ease-[var(--ease-out)] hover:-translate-x-1 sm:left-[4%] sm:w-[32%] lg:left-[1%] lg:top-[16%] lg:w-[37%] xl:left-[3%] xl:w-[34%]">
        <Image
          src="/landing/generated-hero/2026-07-23T14-56-50/aqa-business/paper-1/page-01.png"
          fill
          sizes="(max-width: 639px) 36vw, (max-width: 1023px) 34vw, 300px"
          alt="The real generated cover page for a focused AQA GCSE Business practice paper"
          className="object-cover object-top"
        />
      </figure>
      <figure className="absolute left-1/2 top-[2%] z-30 aspect-[0.707] w-[43%] -translate-x-1/2 overflow-hidden rounded-[3px] border border-text/12 bg-white shadow-[0_22px_54px_rgba(13,23,52,0.16)] transition-transform duration-300 ease-[var(--ease-out)] hover:-translate-y-1 sm:w-[40%] lg:top-0 lg:w-[44%] xl:w-[40%]" aria-label="Geography question page">
        <Image
          src="/landing/aqa-geography-paper-page.png"
          fill
          sizes="(max-width: 639px) 42vw, (max-width: 1023px) 40vw, 350px"
          alt="A GCSE Geography question page with Arctic sea ice questions and a data table"
          className="object-cover object-top"
          preload
        />
      </figure>
      <figure className="absolute right-[2%] top-[19%] z-20 aspect-[0.707] w-[34%] rotate-[4deg] overflow-hidden rounded-[3px] border border-text/12 bg-white shadow-[0_16px_38px_rgba(13,23,52,0.11)] transition-transform duration-300 ease-[var(--ease-out)] hover:translate-x-1 sm:right-[4%] sm:w-[32%] lg:right-[1%] lg:top-[16%] lg:w-[37%] xl:right-[3%] xl:w-[34%]">
        <Image
          src="/landing/generated-science-hero/2026-07-23T09-47-05/edexcel-combined-science-higher/paper-1/page-02.png"
          fill
          sizes="(max-width: 639px) 36vw, (max-width: 1023px) 34vw, 300px"
          alt="A real generated Edexcel Combined Science question page about DNA and natural selection"
          className="object-cover object-top"
        />
      </figure>
    </div>
  );
}

function SubjectLedger() {
  return (
    <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {SUBJECT_CARDS.map(({ title, subjects }) => {
        const subjectKey = subjects[0]?.key ?? "";
        const presentation = SUBJECT_COLORS[subjectKey] ?? { accent: "#4747D8", soft: "#F0F0FF" };
        const Icon = SUBJECT_ICONS[subjectKey];

        return (
          <article key={title} className="flex min-h-44 flex-col justify-between rounded-lg border border-text/10 bg-bg-warm-soft p-5 transition-[transform,border-color] hover:-translate-y-0.5 hover:border-text/20">
            <div>
              {Icon ? <EmbossIcon icon={Icon} flag={subjectKey === "edexcel-french-reading" ? "fr" : undefined} color={presentation.accent} surface="#F2EFE8" params={EMBOSS_PRESETS.subject} size={52} /> : null}
              <h3 className="mt-5 text-[1.05rem] font-extrabold leading-tight tracking-[-0.035em] text-text">{title}</h3>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {subjects.map((subject) => (
                <Link key={subject.key} href={`/paper-maker?subject=${subject.key}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-text/12 bg-white px-3 text-[0.65rem] font-bold text-text-secondary transition-colors hover:border-accent hover:bg-accent hover:text-white">
                  {subject.boardLabel}
                  {subject.tiers.length === 1 ? ` · ${subject.tiers[0]?.label}` : ""}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-bg font-sans text-text">
      <LandingMotion />
      <MarketingNav />
      <main>
        <section className="bg-bg-warm px-4 pb-20 pt-[120px] sm:px-8 sm:pb-24 sm:pt-[136px] lg:px-10 lg:py-28">
          <div className="mx-auto grid w-full max-w-[1280px] gap-14 lg:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12 xl:grid-cols-[500px_minmax(0,1fr)] xl:gap-16">
            <div className="mx-auto text-center lg:mx-0 lg:text-left">
              <h1 data-hero-reveal className="mx-auto max-w-[12ch] text-[clamp(3rem,4.5vw,4.35rem)] font-extrabold leading-[0.96] tracking-[-0.058em] text-text lg:mx-0">Build a paper from what you’ve studied.</h1>
              <p data-hero-reveal className="mx-auto mt-6 max-w-[42ch] text-[0.96rem] font-medium leading-7 text-text-muted sm:text-[1.02rem] lg:mx-0">Pick your course and topics. We’ll make a focused paper from real exam questions.</p>
              <div data-hero-reveal className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 lg:justify-start">
                <Link href="/paper-maker" className="btn-press inline-flex min-h-12 min-w-44 items-center justify-center gap-3 rounded-md bg-accent px-6 text-[0.78rem] font-extrabold text-white hover:bg-accent-deep">
                  Build a paper
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a href="#how" className="inline-flex min-h-12 items-center gap-2 px-3 text-[0.76rem] font-bold text-accent hover:text-accent-deep">See how it works <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
              </div>
            </div>
            <div data-hero-reveal><ExamPaperArtifact /></div>
          </div>
        </section>

        <section className="border-t border-text/[0.08] bg-bg-soft px-4 py-20 sm:px-8 sm:py-24 lg:px-10 lg:py-28">
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

            <div data-scroll-reveal className="mx-auto w-full max-w-[790px]">
              <article className="overflow-hidden rounded-[4px] border border-text/15 bg-white text-[#17213f]" aria-label="Example marking feedback">
                <div className="grid md:grid-cols-[minmax(0,1fr)_190px]">
                  <div className="exam-paper p-6 sm:p-8">
                    <header className="border-b border-text/35 pb-5">
                      <p className="text-[0.78rem]">(c) Explain how flood defences can reduce the impact of flooding. <span className="float-right">(6)</span></p>
                    </header>
                    <div className="space-y-4 py-6 text-[0.82rem] italic leading-7 text-text-secondary">
                      <p>Flood defences reduce the impact of flooding by controlling where water travels and helping to protect people and property.</p>
                      <p>Flood walls can hold water back during periods of heavy rainfall. Embankments also raise the banks of a river so it can carry more water.</p>
                      <p>To make the explanation complete, the answer needs a clearer link between the defence and the impact it prevents.</p>
                    </div>
                    <div className="border-t border-text/35 pt-3 text-right text-[0.62rem]">Total for question: 6 marks</div>
                  </div>
                  <aside className="border-t border-text/12 bg-bg-soft p-5 font-sans md:border-l md:border-t-0">
                    <p className="text-[1.2rem] font-extrabold tracking-[-0.04em]"><span className="text-success">4</span> / 6</p>
                    <div className="mt-7">
                      <p className="font-mono text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-success">Earned marks</p>
                      <ul className="mt-3 space-y-4 text-[0.67rem] font-semibold leading-5">
                        {["Names flood defences", "Explains flood walls", "Explains embankments"].map((point) => (
                          <li key={point} className="flex gap-2.5"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /><span>{point}</span></li>
                        ))}
                      </ul>
                    </div>
                    <div className="mt-6 border-t border-text/12 pt-5">
                      <p className="font-mono text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-warning">Next focus</p>
                      <p className="mt-3 text-[0.67rem] font-semibold leading-5">Link each defence to the impact it reduces.</p>
                    </div>
                  </aside>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-16 border-t border-text/[0.07] bg-bg-soft px-4 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
          <div className="mx-auto max-w-[1160px]">
            <h2 data-scroll-reveal className="text-center text-[clamp(2rem,3.8vw,3.25rem)] font-extrabold leading-[1.04] tracking-[-0.05em]">A paper becomes a plan.</h2>
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
              {STEPS.map(({ title, description, icon, color }) => (
                <li data-scroll-reveal key={title} className="flex flex-col items-center text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-[8px] border border-text/10 bg-white/65">
                    <EmbossIcon icon={icon} color={color} surface="#FFFFFF" params={EMBOSS_PRESETS.process} size={52} />
                  </span>
                  <h3 className="mt-5 text-[1rem] font-extrabold">{title}</h3>
                  <p className="mt-2 max-w-[27ch] text-[0.72rem] leading-5 text-text-muted">{description}</p>
                </li>
              ))}
            </ol>
            <div data-scroll-reveal className="mt-10 flex justify-center text-[0.72rem]">
              <Link href="/paper-maker" className="inline-flex items-center gap-2 font-bold text-accent transition-colors hover:text-text">Build a paper <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section id="subjects" className="scroll-mt-16 border-t border-border bg-bg-soft px-4 py-20 sm:px-8 sm:py-24 lg:px-10 lg:py-28">
          <div className="mx-auto max-w-[1160px]">
            <h2 className="max-w-[18ch] text-[clamp(2.3rem,4.5vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.055em]">Practice what’s on your course.</h2>
            <div className="mt-10"><SubjectLedger /></div>
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-text/10 bg-bg-warm px-4 py-20 text-text sm:px-8 sm:py-24 lg:px-10 lg:py-28">
          <div data-scroll-reveal className="relative mx-auto flex max-w-[1160px] flex-col items-center text-center">
            <h2 className="max-w-[18ch] text-[clamp(2.4rem,5vw,4.3rem)] font-extrabold leading-[1.02] tracking-[-0.055em] text-text">Build your next practice paper.</h2>
            <Link href="/paper-maker" className="btn-press mt-8 inline-flex min-h-12 min-w-52 items-center justify-center gap-3 rounded-[4px] bg-accent px-6 text-[0.78rem] font-extrabold text-white transition-colors hover:bg-accent-deep">
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
            <Link href="/paper-maker" className="transition-colors hover:text-accent">Build</Link>
            <Link href="/marking" className="transition-colors hover:text-accent">Mark</Link>
            <Link href="/auth" className="transition-colors hover:text-accent">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
