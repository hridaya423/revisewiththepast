"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Globe,
  Briefcase,
  BookOpen,
  Cpu,
  Building2,
  FlaskConical,
  Calculator,
  Dna,
  Beaker,
  Zap,
  ArrowRight,
} from "lucide-react";

const STEPS = [
  {
    step: "01",
    title: "Choose your subject",
    desc: "Pick your course, including separate sciences, and move straight into real past-paper material.",
  },
  {
    step: "02",
    title: "Refine by topic",
    desc: "Select the units or areas you want to focus on so your paper matches the revision session.",
  },
  {
    step: "03",
    title: "Generate your PDF",
    desc: "Build a clean custom paper from official source pages in seconds, ready to print or save.",
  },
] as const;

const SUBJECT_ICONS: Record<string, React.ElementType> = {
  "aqa-geography": Globe,
  "aqa-business": Briefcase,
  "aqa-english-language": BookOpen,
  "aqa-english-literature": BookOpen,
  "edexcel-business": Building2,
  "edexcel-combined-science": FlaskConical,
  "edexcel-biology": Dna,
  "edexcel-chemistry": Beaker,
  "edexcel-physics": Zap,
  "edexcel-mathematics-higher": Calculator,
  "ocr-computer-science": Cpu,
};

const SUBJECTS = [
  {
    key: "aqa-geography",
    board: "AQA",
    title: "Geography",
    desc: "Build focused practice papers from real Geography source pages across the topics you choose.",
    featured: true,
  },
  {
    key: "aqa-business",
    board: "AQA",
    title: "Business",
    desc: "Generate AQA Business papers using the numbered specification structure and real source pages.",
  },
  {
    key: "edexcel-combined-science",
    board: "Edexcel",
    title: "Combined Science",
    desc: "Create revision papers from tagged Combined Science material with the same calm, source-first workflow.",
  },
  {
    key: "edexcel-biology",
    board: "Edexcel",
    title: "Biology",
    desc: "Create Edexcel Biology papers by tier and topic using real source-page questions.",
  },
  {
    key: "edexcel-chemistry",
    board: "Edexcel",
    title: "Chemistry",
    desc: "Create Edexcel Chemistry papers by tier and topic using real source-page questions.",
  },
  {
    key: "edexcel-business",
    board: "Edexcel",
    title: "Business",
    desc: "Generate Edexcel Business papers using tagged source-page questions and the topic structure.",
  },
  {
    key: "aqa-english-language",
    board: "AQA",
    title: "English Language",
    desc: "Generate AQA English Language papers from tagged reading and writing source-page questions.",
  },
  {
    key: "aqa-english-literature",
    board: "AQA",
    title: "English Literature",
    desc: "Generate AQA English Literature papers from tagged source-page questions and set-text topics.",
  },
  {
    key: "edexcel-mathematics-higher",
    board: "Edexcel",
    title: "Maths Higher",
    desc: "Build Higher Maths papers from real Edexcel source pages, using tagged specification topics.",
  },
  {
    key: "ocr-computer-science",
    board: "OCR",
    title: "Computer Science",
    desc: "Generate OCR Computer Science papers from tagged source-page questions and J277 topics.",
  },
] as const;

function FloatingNav() {
  return (
    <nav className="fixed left-1/2 top-5 z-50 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2">
      <div className="flex items-center justify-between rounded-full border border-[#1a2e1a]/10 bg-white/92 px-3 py-2 shadow-[0_10px_36px_rgba(26,46,26,0.12)] backdrop-blur-xl">
        <Link href="/" className="rounded-full px-4 py-2 transition-colors hover:bg-[#1a2e1a]/[0.05]">
          <span className="font-serif text-[0.95rem] tracking-[-0.02em] text-[#162816]">Revise with the Past</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {[
            { label: "How it works", id: "how-it-works" },
            { label: "Subjects", id: "subjects" },
            { label: "About", id: "about" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="rounded-full px-4 py-2 text-[0.78rem] font-medium tracking-[-0.01em] text-[#1f351f]/78 transition-colors hover:bg-[#1a2e1a]/[0.06] hover:text-[#162816]"
            >
              {item.label}
            </button>
          ))}
        </div>

        <Link
          href="/paper-maker"
          className="btn-press inline-flex items-center justify-center rounded-full bg-[#1a2e1a] px-5 py-2.5 text-[0.82rem] font-semibold tracking-[-0.01em] text-[#f8faf8] shadow-[0_6px_18px_rgba(26,46,26,0.18)] transition-shadow hover:shadow-[0_10px_28px_rgba(26,46,26,0.22)]"
        >
          <span className="text-[#f8faf8]">Start Building</span>
        </Link>
      </div>
    </nav>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.65rem] uppercase tracking-[0.28em] text-accent-warm">{children}</p>;
}

export function LandingPage() {
  return (
    <div className="relative min-h-[100dvh] overflow-x-clip bg-[#f4f2ec]">
      <FloatingNav />

      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/landing/hero-bg.jpg"
            alt=""
            fill
            priority
            className="object-cover opacity-[0.35]"
            sizes="100vw"
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#f4f2ec]/60 via-[#f4f2ec]/20 to-[#f4f2ec]" />
        </div>

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col px-6 pt-40 pb-24 sm:px-8 sm:pt-48 sm:pb-32 lg:px-12 lg:pt-56">
          <div className="max-w-3xl">
            <p className="hero-eyebrow text-[0.68rem] uppercase tracking-[0.32em] text-accent-warm">
              GCSE Past Paper Builder
            </p>

            <h1 className="hero-headline mt-6 font-serif text-[clamp(2.8rem,7vw,5.5rem)] leading-[1.02] tracking-[-0.04em] text-[#1a2e1a]">
              Make past papers
              <br />
              on the topics you&apos;ve
              <br />
              actually studied.
            </h1>

            <p className="hero-sub mt-6 max-w-[52ch] text-[1.05rem] leading-[1.7] text-[#3d5a3f]/80">
              Pick your subject, choose the exact topics you want to revise, and generate a paper from real source pages only.
            </p>

            <div className="hero-cta mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/paper-maker"
                className="btn-press inline-flex items-center justify-center rounded-full bg-[#1a2e1a] px-7 py-3.5 text-[0.96rem] font-semibold tracking-[-0.01em] text-[#f8faf8] shadow-[0_10px_28px_rgba(22,40,22,0.18)] transition-shadow hover:shadow-[0_14px_36px_rgba(22,40,22,0.24)]"
              >
                <span className="text-[#f8faf8]">Build your first paper</span>
              </Link>
              <button
                onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="btn-press inline-flex items-center justify-center rounded-full border border-[#1a2e1a]/10 px-7 py-3.5 text-[0.96rem] font-medium tracking-[-0.01em] text-[#1a2e1a] transition-colors hover:bg-[#1a2e1a]/[0.04]"
              >
                See how it works
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 scroll-mt-32">
        <div className="mx-auto max-w-7xl px-6 py-24 sm:px-8 lg:px-12">
          <div className="reveal-up max-w-xl">
            <SectionEyebrow>How it works</SectionEyebrow>
            <h2 className="mt-3 font-serif text-[clamp(1.6rem,3vw,2.4rem)] leading-[1.1] tracking-[-0.04em] text-[#1a2e1a]">
              Three steps to your perfect paper.
            </h2>
          </div>

          <div className="process-rail stagger-parent mt-14 hidden md:block">
            <div className="relative">
              <div className="absolute top-5 left-[16.66%] right-[16.66%] h-px bg-[#1a2e1a]/10" />
              <div className="process-line-fill absolute top-5 left-[16.66%] h-px origin-left bg-accent-warm" style={{ width: "66.68%" }} />

              <div className="relative grid grid-cols-3">
                {STEPS.map((item) => (
                  <div key={item.step} className="stagger-child flex flex-col items-center px-6 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-[0_2px_12px_rgba(26,46,26,0.08)] ring-2 ring-accent-warm">
                      <span className="font-serif text-[0.82rem] font-semibold text-[#1a2e1a]">{item.step}</span>
                    </div>
                    <h3 className="mt-5 text-[1.1rem] font-semibold tracking-[-0.02em] text-[#1a2e1a]">{item.title}</h3>
                    <p className="mt-2 max-w-[260px] text-[0.88rem] leading-[1.6] text-[#3d5a3f]/70">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="stagger-parent mt-10 flex flex-col gap-8 md:hidden">
            {STEPS.map((item) => (
              <div key={item.step} className="stagger-child flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_2px_12px_rgba(26,46,26,0.08)] ring-2 ring-accent-warm">
                    <span className="font-serif text-[0.82rem] font-semibold text-[#1a2e1a]">{item.step}</span>
                  </div>
                  {item.step !== "03" && <div className="mt-2 h-full w-px bg-[#1a2e1a]/10" />}
                </div>
                <div className="pb-2">
                  <h3 className="text-[1.1rem] font-semibold tracking-[-0.02em] text-[#1a2e1a]">{item.title}</h3>
                  <p className="mt-1 text-[0.88rem] leading-[1.6] text-[#3d5a3f]/70">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="relative my-4 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/landing/quote-bg.jpg"
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 1280px) 100vw, 1280px"
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-[#1a2e1a]/85" />
        </div>
        <div id="quote" className="quote-inner relative px-6 py-24 sm:px-12 sm:py-32 lg:px-20 lg:py-40">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-8 h-px w-12 bg-accent-warm" />
            <p className="font-serif text-[clamp(1.5rem,3.5vw,2.6rem)] leading-[1.2] tracking-[-0.03em] text-white">
              Every question comes from a real past paper page.
              <br className="hidden sm:block" />
              No synthetic fillers. No guesswork.
            </p>
            <p className="mt-6 text-[0.95rem] leading-[1.7] text-white/50 max-w-lg mx-auto">
              We use strict source-page-only mode. Every question, every mark scheme, every diagram comes directly from official exam papers.
            </p>
            <div className="mx-auto mt-8 h-px w-12 bg-accent-warm" />
          </div>
        </div>
      </section>

      <section id="subjects" className="relative z-10 scroll-mt-32">
        <div className="mx-auto max-w-7xl px-6 py-24 sm:px-8 lg:px-12">
          <div className="reveal-up max-w-xl">
            <SectionEyebrow>Subjects</SectionEyebrow>
            <h2 className="mt-3 font-serif text-[clamp(1.6rem,3vw,2.4rem)] leading-[1.1] tracking-[-0.04em] text-[#1a2e1a]">
              Start with the subjects available now.
            </h2>
            <p className="mt-4 text-[0.95rem] leading-[1.7] text-[#3d5a3f]/70">
              Clean subject entry points, real source pages, and a straightforward path into revision.
            </p>
          </div>

          <div className="stagger-parent mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SUBJECTS.map((subject) => {
              const Icon = SUBJECT_ICONS[subject.key];
              const isFeatured = "featured" in subject && subject.featured;

              return (
                <Link
                  key={subject.key}
                  href={`/paper-maker?subject=${encodeURIComponent(subject.key)}`}
                  className={`stagger-child card-lift group relative flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-7 transition-all ${
                    isFeatured ? "lg:col-span-2" : ""
                  }`}
                >
                  <div className={`flex flex-1 items-start justify-between ${isFeatured ? "min-h-[160px]" : "min-h-[140px]"}`}>
                    <div>
                      <p className="text-[0.65rem] uppercase tracking-[0.26em] text-accent-warm">{subject.board}</p>
                      <h3 className={`mt-2 font-serif tracking-[-0.03em] text-[#1a2e1a] ${isFeatured ? "text-[1.8rem]" : "text-[1.5rem]"}`}>
                        {subject.title}
                      </h3>
                      <p className={`mt-3 max-w-sm text-[0.92rem] leading-[1.7] text-[#3d5a3f]/70 ${isFeatured ? "" : "line-clamp-2"}`}>
                        {subject.desc}
                      </p>
                    </div>
                    {Icon ? (
                      <div className="ml-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f4f2ec] text-accent-warm transition-colors group-hover:bg-accent-warm group-hover:text-white">
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-full border border-[#1a2e1a]/10 px-3 py-1.5 text-[0.78rem] font-medium text-[#1a2e1a]/65 transition-all group-hover:border-accent-warm/25 group-hover:bg-[#faf8f3] group-hover:text-accent-warm">
                    <span>Start revision</span>
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="relative z-10">
        <div className="mx-auto max-w-7xl px-6 pb-24 sm:px-8 lg:px-12">
          <div className="reveal-up rounded-[2rem] border border-[#1a2e1a]/[0.06] bg-[#1a2e1a] px-8 py-16 text-center sm:px-12 sm:py-20">
            <h2 className="font-serif text-[clamp(1.5rem,3vw,2.2rem)] leading-[1.15] tracking-[-0.03em] text-white">
              Ready to build your first paper?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[0.9rem] leading-[1.7] text-white/50">
              Start with any subject, pick your topics, and generate a paper from real source pages in seconds.
            </p>
            <div className="mt-8">
              <Link
                href="/paper-maker"
                className="btn-press inline-flex items-center justify-center rounded-full bg-white px-8 py-3.5 text-[0.92rem] font-semibold tracking-[-0.01em] text-[#1a2e1a] shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-shadow hover:shadow-[0_12px_32px_rgba(0,0,0,0.2)]"
              >
                Build your first paper
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#1a2e1a]/[0.06] bg-[#ece9e1]">
        <div className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:px-12">
          <div className="flex flex-col items-center justify-between gap-8 sm:flex-row sm:items-start">
            <div>
              <span className="font-serif text-[0.95rem] tracking-[-0.02em] text-[#1a2e1a]">Revise with the Past</span>
              <p className="mt-2 max-w-xs text-[0.82rem] leading-[1.6] text-[#3d5a3f]/60">
                Real past papers, real source pages, built for the topics you actually study.
              </p>
            </div>

            <nav className="flex flex-col items-center gap-3 sm:items-end">
              <Link href="/paper-maker" className="text-[0.82rem] font-medium text-[#1a2e1a]/70 transition-colors hover:text-[#1a2e1a]">
                Build a paper
              </Link>
              <button
                onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="text-[0.82rem] font-medium text-[#1a2e1a]/70 transition-colors hover:text-[#1a2e1a]"
              >
                How it works
              </button>
              <button
                onClick={() => document.getElementById("about")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="text-[0.82rem] font-medium text-[#1a2e1a]/70 transition-colors hover:text-[#1a2e1a]"
              >
                About
              </button>
            </nav>
          </div>

          <div className="mt-10 border-t border-[#1a2e1a]/[0.06] pt-6 text-center text-[0.78rem] text-[#3d5a3f]/50 sm:text-right">
            Built by Hridya. Real papers only.
          </div>
        </div>
      </footer>
    </div>
  );
}
