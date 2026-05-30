import Link from "next/link";

import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import { MarkingDashboard } from "@/app/_components/marking-dashboard";
import { UserMenu } from "@/app/_components/user-menu";

export const dynamic = "force-dynamic";

export default async function MarkingPage() {
  const [user, submissions, savedPapers] = await Promise.all([
    fetchAuthQuery(api.auth.getCurrentUser, {}),
    fetchAuthQuery(api.marking.listMarkingSubmissions, {}),
    fetchAuthQuery(api.savedPapers.listSavedPapers, {}),
  ]);

  return (
    <div className="min-h-[100dvh] bg-[#f4f2ec]">
      <nav className="sticky top-0 z-50 border-b border-[#1a2e1a]/[0.06] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 sm:px-8 lg:px-12">
          <div className="flex items-center gap-5">
            <Link href="/paper-maker" className="inline-flex items-center text-[0.82rem] font-medium text-[#1a2e1a]/60 transition-colors hover:text-[#1a2e1a]">
              &larr; Paper Maker
            </Link>
            <div className="h-5 w-px bg-[#1a2e1a]/12" />
            <span className="inline-flex items-center font-serif text-[1rem] tracking-[-0.02em] text-[#1a2e1a]">Marking Studio</span>
          </div>
          <UserMenu />
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12">
        <MarkingDashboard initialSavedPapers={savedPapers} initialSubmissions={submissions} userName={user?.name ?? "there"} />
      </main>
    </div>
  );
}
