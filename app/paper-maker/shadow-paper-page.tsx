import "server-only";

import Link from "next/link";

import { AppShell } from "../_components/app-shell";
import { ShadowPaperWorkspace } from "../_components/shadow-paper-workspace";
import { convexIdSchema } from "@/features/papers/shadow/contracts/shadow-paper";
import { listSourcePapers } from "@/features/papers/shadow/application/list-source-papers";
import { listShadowManifests } from "@/features/papers/shadow/content/catalog";
import { shadowPageHref } from "@/features/papers/shadow/presentation/state";
import { shadowPapersAllowDraft, shadowPapersEnabled } from "@/features/papers/shadow/infrastructure/feature-flag";

export function ShadowPaperPage({ paper, job }: { paper: unknown; job: unknown }) {
  const papers = listSourcePapers(listShadowManifests({ includeDraft: shadowPapersAllowDraft() }));
  return (
    <AppShell active="build">
      <ShadowPaperWorkspace
        papers={papers}
        enabled={shadowPapersEnabled()}
        initialPaperId={typeof paper === "string" ? paper : null}
        initialJobId={convexIdSchema.safeParse(job).success ? (job as string) : null}
      />
    </AppShell>
  );
}

export function ShadowPaperEntryLink() {
  return (
    <p className="mx-auto mb-3 flex max-w-[1240px] flex-wrap items-baseline gap-x-2 border-b border-text/10 pb-3 text-sm text-text-muted">
      <span>Want a full past paper with new numbers?</span>
      <Link href={shadowPageHref({})} className="font-semibold text-accent hover:text-accent-deep">Make a shadow paper</Link>
    </p>
  );
}
