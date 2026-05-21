"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  {
    step: "01",
    title: "Choose your subject",
    desc: "Pick the course you want to practise and move straight into real past-paper material.",
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

const SUBJECTS = [
  {
    board: "AQA",
    title: "Geography",
    desc: "Build focused practice papers from real Geography source pages across the topics you choose.",
  },
  {
    board: "AQA",
    title: "Business",
    desc: "Generate AQA Business papers using the numbered specification structure, real source pages, and selected paper topics.",
  },
  {
    board: "Edexcel",
    title: "Combined Science",
    desc: "Create revision papers from tagged Combined Science material with the same calm, source-first workflow.",
  },
  {
    board: "Edexcel",
    title: "Maths Higher",
    desc: "Build Higher Maths papers from real Edexcel source pages, using tagged specification topics and official paper structure.",
  },
] as const;

function FloatingNav() {
  return (
    <nav className="fixed left-1/2 top-5 z-50 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2">
      <div className="flex items-center justify-between rounded-full border border-[#1a2e1a]/12 bg-white/92 px-3 py-2 shadow-[0_10px_36px_rgba(26,46,26,0.12)] backdrop-blur-xl">
        <Link href="/" className="rounded-full px-4 py-2 transition-colors hover:bg-[#1a2e1a]/[0.04]">
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
              className="rounded-full px-4 py-2 text-[0.78rem] font-medium tracking-[-0.01em] text-[#1f351f]/78 transition-colors hover:bg-[#1a2e1a]/[0.04] hover:text-[#162816]"
            >
              {item.label}
            </button>
          ))}
        </div>

        <Link
          href="/paper-maker"
          className="inline-flex items-center justify-center rounded-full border border-[#162816]/10 bg-[#f7f4ea] px-5 py-2.5 text-[0.82rem] font-semibold tracking-[-0.01em] text-[#162816] shadow-[0_6px_18px_rgba(22,40,22,0.14)] transition-all duration-200 hover:bg-[#f3efe4] hover:-translate-y-px active:translate-y-0"
        >
          Start Building
        </Link>
      </div>
    </nav>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.65rem] uppercase tracking-[0.28em] text-[#6b8a6d]">{children}</p>;
}

export function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") {
        return;
      }

      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (prefersReducedMotion) {
        ScrollTrigger.refresh();
        return;
      }

      try {
        gsap.from(".hero-eyebrow", { y: 20, duration: 0.7, ease: "power3.out", delay: 0.1, clearProps: "transform" });
        gsap.from(".hero-headline", { y: 26, duration: 0.85, ease: "power3.out", delay: 0.2, clearProps: "transform" });
        gsap.from(".hero-sub", { y: 20, duration: 0.75, ease: "power3.out", delay: 0.3, clearProps: "transform" });
        gsap.from(".hero-cta", { y: 16, duration: 0.65, ease: "power3.out", delay: 0.4, clearProps: "transform" });

        gsap.utils.toArray<HTMLElement>(".reveal-up").forEach((el) => {
          gsap.from(el, {
            y: 32,
            opacity: 0.35,
            duration: 0.85,
            ease: "power3.out",
            clearProps: "transform,opacity",
            scrollTrigger: {
              trigger: el,
              start: "top 86%",
              once: true,
              invalidateOnRefresh: true,
            },
          });
        });

        gsap.utils.toArray<HTMLElement>(".stagger-parent").forEach((parent) => {
          const cards = parent.querySelectorAll<HTMLElement>(".stagger-child");
          if (!cards.length) {
            return;
          }

          gsap.from(cards, {
            y: 22,
            opacity: 0.45,
            duration: 0.7,
            ease: "power3.out",
            stagger: 0.12,
            clearProps: "transform,opacity",
            scrollTrigger: {
              trigger: parent,
              start: "top 82%",
              once: true,
              invalidateOnRefresh: true,
            },
          });
        });

        gsap.from(".quote-inner", {
          y: 18,
          opacity: 0.45,
          duration: 0.9,
          ease: "power3.out",
          clearProps: "transform,opacity",
          scrollTrigger: {
            trigger: "#quote",
            start: "top 78%",
            once: true,
            invalidateOnRefresh: true,
          },
        });

        ScrollTrigger.refresh();
      } catch {
        ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      }
    },
    { scope: containerRef }
  );

  return (
    <div ref={containerRef} className="relative min-h-[100dvh] overflow-x-clip bg-[#f4f2ec]">
      <FloatingNav />

      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/landing/hero-bg.jpg"
            alt=""
            fill
            priority
            className="object-cover opacity-[0.26]"
            sizes="100vw"
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#f4f2ec]/52 via-[#f4f2ec]/16 to-[#f4f2ec]" />
        </div>

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col px-6 pt-36 pb-16 sm:px-8 lg:px-12 lg:pt-44">
          <div className="max-w-2xl">
            <p className="hero-eyebrow text-[0.68rem] uppercase tracking-[0.32em] text-[#5a7a5c]">
              GCSE Past Paper Builder
            </p>

            <h1 className="hero-headline mt-5 font-serif text-[clamp(2.6rem,5.5vw,4.2rem)] leading-[1.05] tracking-[-0.04em] text-[#1a2e1a]">
              Make past papers
              <br />
              on the topics you've actually studied.
            </h1>

            <p className="hero-sub mt-5 max-w-lg text-[1.05rem] leading-[1.7] text-[#3d5a3f]/80">
              Pick your subject, choose the exact topics you want to revise, and generate a paper from real source pages only.
            </p>

            <div className="hero-cta mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/paper-maker"
                className="inline-flex items-center justify-center rounded-full border border-[#162816]/10 bg-[#f7f4ea] px-7 py-3.5 text-[0.96rem] font-semibold tracking-[-0.01em] text-[#162816] shadow-[0_10px_28px_rgba(22,40,22,0.14)] transition-all duration-200 hover:bg-[#f3efe4] hover:-translate-y-0.5 active:translate-y-0"
              >
                Start Building
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 scroll-mt-32">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:px-12">
          <div className="reveal-up max-w-xl">
            <SectionEyebrow>How it works</SectionEyebrow>
            <h2 className="mt-3 font-serif text-[clamp(1.6rem,3vw,2.4rem)] leading-[1.1] tracking-[-0.04em] text-[#1a2e1a]">
              Three steps to your perfect paper.
            </h2>
          </div>

          <div className="stagger-parent mt-10 grid items-stretch gap-5 md:grid-cols-3">
            {STEPS.map((item) => (
              <div
                key={item.step}
                className="stagger-child group flex h-full min-h-[220px] flex-col rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-[0_2px_16px_rgba(26,46,26,0.03)] transition-all duration-300 hover:shadow-[0_8px_32px_rgba(26,46,26,0.06)] hover:-translate-y-1"
              >
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-[#6b8a6d]">{item.step}</span>
                <h3 className="mt-3 text-[1.1rem] font-semibold tracking-[-0.02em] text-[#1a2e1a]">{item.title}</h3>
                <p className="mt-2 text-[0.88rem] leading-[1.6] text-[#3d5a3f]/70">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="relative my-6 overflow-hidden rounded-[2rem] mx-6 sm:mx-8 lg:mx-12">
        <div className="absolute inset-0">
          <Image
            src="/landing/quote-bg.jpg"
            alt="Rolling hills landscape"
            fill
            className="object-cover"
            sizes="(max-width: 1280px) 100vw, 1280px"
          />
          <div className="absolute inset-0 bg-[#f4f2ec]/[0.55]" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#f4f2ec]/30 via-transparent to-[#f4f2ec]/30" />
        </div>
        <div id="quote" className="quote-inner relative px-8 py-20 text-center sm:px-12 sm:py-28">
          <p className="font-serif text-[clamp(1.4rem,3vw,2.2rem)] leading-[1.25] tracking-[-0.03em] text-[#1a2e1a]">
            Every question comes from a real past paper page.
            <br className="hidden sm:block" />
            No synthetic fillers. No guesswork.
          </p>
          <p className="mt-5 text-[0.9rem] text-[#3d5a3f]/60 max-w-md mx-auto">
            We use strict source-page-only mode. Every question, every mark scheme, every diagram comes directly from official exam papers.
          </p>
        </div>
      </section>

      <section id="subjects" className="relative z-10 scroll-mt-32">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:px-12">
          <div className="reveal-up max-w-xl">
            <SectionEyebrow>Subjects</SectionEyebrow>
            <h2 className="mt-3 font-serif text-[clamp(1.6rem,3vw,2.4rem)] leading-[1.1] tracking-[-0.04em] text-[#1a2e1a]">
              Start with the subjects available now.
            </h2>
            <p className="mt-4 text-[0.95rem] leading-[1.7] text-[#3d5a3f]/70">
              Clean subject entry points, real source pages, and a straightforward path into revision.
            </p>
          </div>

          <div className="stagger-parent mt-10 grid gap-5 lg:grid-cols-3">
            {SUBJECTS.map((subject) => (
              <div
                key={subject.title}
                className="stagger-child group relative overflow-hidden rounded-[1.8rem] border border-[#1a2e1a]/[0.06] bg-white p-7 shadow-[0_2px_16px_rgba(26,46,26,0.03)] transition-all duration-300 hover:shadow-[0_12px_40px_rgba(26,46,26,0.06)]"
              >
                <p className="text-[0.65rem] uppercase tracking-[0.26em] text-[#6b8a6d]">{subject.board}</p>
                <h3 className="mt-3 font-serif text-[1.5rem] tracking-[-0.03em] text-[#1a2e1a]">{subject.title}</h3>
                <p className="mt-4 max-w-lg text-[0.92rem] leading-[1.7] text-[#3d5a3f]/70">{subject.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10">
        <div className="mx-auto max-w-7xl px-6 pb-20 sm:px-8 lg:px-12">
          <div className="reveal-up rounded-[2rem] border border-[#1a2e1a]/[0.06] bg-[#1a2e1a] px-8 py-14 text-center sm:px-12 sm:py-16">
            <h2 className="font-serif text-[clamp(1.5rem,3vw,2.2rem)] leading-[1.15] tracking-[-0.03em] text-white">
              Ready to build your first paper?
            </h2>
             <p className="mx-auto mt-4 max-w-md text-[0.9rem] leading-[1.7] text-white/55">
              Start with Geography, Business, Combined Science, or Edexcel Maths Higher today.
             </p>
            <div className="mt-7">
              <Link
                href="/paper-maker"
                className="inline-flex rounded-full bg-white px-8 py-3.5 text-[0.92rem] font-semibold tracking-[-0.01em] text-[#1a2e1a] shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-all duration-200 hover:bg-[#f4f2ec] hover:-translate-y-0.5 active:translate-y-0"
              >
                Start Building
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#1a2e1a]/[0.06] bg-[#ece9e1]">
        <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-12">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <span className="font-serif text-[0.95rem] tracking-[-0.02em] text-[#1a2e1a]">Revise with the Past</span>
            <p className="text-[0.8rem] text-[#3d5a3f]/50">
              Built by Hridya. Real papers only.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
