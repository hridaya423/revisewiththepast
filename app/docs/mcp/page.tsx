import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";

import { AppShell } from "@/app/_components/app-shell";

export const metadata: Metadata = {
  title: "MCP documentation",
  description: "Connect Hermes, OpenClaw, and other MCP clients to GCSE paper generation.",
};

const OPENCODE_CONFIG = `{
  "mcp": {
    "gcse_papers": {
      "type": "remote",
      "url": "https://revise.hridya.tech/mcp",
      "enabled": true,
      "oauth": false,
      "timeout": 290000
    }
  }
}`;

function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-text/12 bg-[#111a31] shadow-[0_16px_40px_rgba(13,23,52,0.12)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/55">{label}</span>
        <span className="h-2 w-2 rounded-full bg-accent-warm" aria-hidden="true" />
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[0.72rem] leading-6 text-white/85"><code>{children}</code></pre>
    </div>
  );
}

export default function McpDocsPage() {
  return (
    <AppShell wide>
      <div className="mx-auto max-w-[1180px]">
        <div className="flex items-center justify-between gap-4 text-[0.7rem] font-bold text-text-muted">
          <Link href="/" className="inline-flex items-center gap-2 transition-colors hover:text-accent"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Home</Link>
          <Link href="/mcp" className="inline-flex items-center gap-2 transition-colors hover:text-accent">Endpoint <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        </div>

        <header className="mt-12 max-w-[760px]">
          <h1 className="mt-6 text-[clamp(2.8rem,6vw,5.4rem)] font-extrabold leading-[0.94] tracking-[-0.065em] text-text">Connect your agent to GCSE paper generation.</h1>
          <p className="mt-6 max-w-[58ch] text-[0.96rem] leading-7 text-text-secondary">Use the hosted MCP endpoint with OpenCode, OpenClaw, or another compatible client. You do not need to run Revise with the Past locally or configure a Convex project.</p>
        </header>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            ["01", "Connect", "Add the hosted endpoint to your MCP client."],
            ["02", "Choose", "Pick a subject, tier, paper and topic from the catalog."],
            ["03", "Generate", "Receive HTTPS links to the question paper and mark scheme."],
          ].map(([number, title, description]) => (
            <div key={number} className="border-t-2 border-accent pt-4">
              <p className="font-mono text-[0.63rem] font-bold tracking-[0.14em] text-accent">{number}</p>
              <h2 className="mt-4 text-[1rem] font-extrabold tracking-[-0.03em] text-text">{title}</h2>
              <p className="mt-2 text-[0.74rem] leading-5 text-text-muted">{description}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 grid gap-14 lg:grid-cols-[minmax(0,0.86fr)_minmax(420px,1.14fr)] lg:items-start">
          <section id="connect" className="scroll-mt-24">
            <p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.15em] text-accent">01 / Connect</p>
            <h2 className="mt-4 text-[2rem] font-extrabold leading-tight tracking-[-0.05em] text-text">Use the hosted endpoint.</h2>
            <p className="mt-4 text-[0.86rem] leading-7 text-text-secondary">In a MCP client, add the same URL as a remote server.</p>
          </section>
          <div className="grid gap-4">
            <CodeBlock label="opencode.json">{OPENCODE_CONFIG}</CodeBlock>
            <div className="rounded-lg border border-text/10 bg-bg-warm-soft p-5">
              <p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-text-muted">Connection details</p>
              <dl className="mt-4 grid gap-3 text-[0.76rem] leading-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4"><dt className="font-bold text-text-muted">Endpoint</dt><dd className="break-all font-mono text-accent">https://revise.hridya.tech/mcp</dd></div>
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4"><dt className="font-bold text-text-muted">Transport</dt><dd className="text-text-secondary">Remote MCP over HTTPS</dd></div>
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4"><dt className="font-bold text-text-muted">Authentication</dt><dd className="text-text-secondary">No client secret required</dd></div>
              </dl>
            </div>
          </div>
        </div>

        <section className="mt-20 border-t border-text/10 pt-14">
          <div className="max-w-[760px]">
            <p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.15em] text-accent">02 / Choose</p>
            <h2 className="mt-4 text-[2rem] font-extrabold leading-tight tracking-[-0.05em] text-text">Let the client discover the available papers.</h2>
            <p className="mt-4 text-[0.86rem] leading-7 text-text-secondary">Start with the subject list and catalog instead of guessing IDs. The returned topic IDs, tiers and paper codes are the values to use in the generation request.</p>
          </div>
          <div className="mt-8 max-w-[760px]">
            <div className="rounded-lg border border-text/10 bg-bg-warm-soft p-5">
              <p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-text-muted">Prompt shape</p>
              <p className="mt-4 text-[0.82rem] leading-6 text-text-secondary">Ask the agent to call `list_subjects`, then `get_subject_catalog`, then `generate_paper_bundle`. Focused generation should pass topic IDs from the catalog.</p>
              <p className="mt-5 text-[0.72rem] font-bold text-accent">Broad papers require `selectAllTopics: true`.</p>
            </div>
          </div>
        </section>

        <section className="mt-20 grid gap-10 border-t border-text/10 py-14 lg:grid-cols-2">
          <div>
            <p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.15em] text-accent">Before you start</p>
            <h2 className="mt-4 text-[2rem] font-extrabold leading-tight tracking-[-0.05em] text-text">Hosted, temporary and rate-limited.</h2>
          </div>
          <ul className="grid gap-3 text-[0.8rem] leading-6 text-text-secondary">
            <li className="border-l-2 border-accent-warm px-4">10 bundles per caller per hour and 300 bundles globally per hour by default.</li>
            <li className="border-l-2 border-accent-warm px-4">Generated PDFs are temporary download links and normally expire after 24 hours.</li>
            <li className="border-l-2 border-accent-warm px-4">The generated paper and mark scheme use source exam material. Share or redistribute them only where your exam board or school permits it.</li>
            <li className="border-l-2 border-accent-warm px-4">If a request times out, retry it; timeouts are rare and generation is typically fast.</li>
          </ul>
        </section>

        <footer className="flex flex-col gap-4 border-t border-text/10 py-8 text-[0.74rem] font-bold text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Ready to connect your agent?</span>
          <a href="#connect" className="inline-flex items-center gap-2 text-accent transition-colors hover:text-accent-deep">View connection details <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></a>
        </footer>
      </div>
    </AppShell>
  );
}
