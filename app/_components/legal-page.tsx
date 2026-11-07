import Link from "next/link";
import type { ReactNode } from "react";

import { AppShell } from "@/app/_components/app-shell";

export const CONTACT_EMAIL = "hridyaagrawal4@gmail.com";
export const OPERATOR_NAME = "Hridya Agrawal";

const PAGES = [
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export function ContactLink() {
  return <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-accent underline underline-offset-4 hover:text-accent-deep">{CONTACT_EMAIL}</a>;
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-20 border-t border-text/10 pt-6">
      <h2 id={id} className="text-xl font-semibold text-text">{title}</h2>
      <div className="mt-3 space-y-3 text-base leading-7 text-text-secondary [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-text [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{children}</div>
    </section>
  );
}

export function LegalPage({ current, title, updated, intro, children }: { current: string; title: string; updated?: string; intro: ReactNode; children: ReactNode }) {
  return (
    <AppShell>
      <article className="mx-auto max-w-[44rem] pb-16">
        <nav aria-label="Help and policies" className="flex flex-wrap gap-x-5 border-b border-text/10 text-sm">
          {PAGES.map((page) => (
            <Link key={page.href} href={page.href} aria-current={page.href === current ? "page" : undefined} className={`inline-flex min-h-11 items-center border-b-2 font-semibold ${page.href === current ? "border-accent text-accent" : "border-transparent text-text-secondary hover:text-text"}`}>{page.label}</Link>
          ))}
        </nav>
        <header className="py-8">
          <h1 className="text-[2rem] font-extrabold leading-tight tracking-[-0.03em] text-text sm:text-[2.5rem]">{title}</h1>
          {updated ? <p className="mt-2 text-sm text-text-secondary">Last updated {updated}</p> : null}
          <div className="mt-4 text-lg leading-7 text-text-secondary">{intro}</div>
        </header>
        <div className="space-y-8">{children}</div>
        <p className="mt-10 border-t border-text/10 pt-6 text-sm text-text-secondary">
          <a href="https://www.hridya.tech/projects/revise" className="font-semibold hover:text-accent">Built by Hridya Agrawal</a>
        </p>
      </article>
    </AppShell>
  );
}
