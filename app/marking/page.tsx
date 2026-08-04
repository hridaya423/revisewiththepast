import { redirect } from "next/navigation";

import { getMarkingDashboardData } from "@/features/papers/server";
import { MarkingDashboard } from "@/app/_components/marking-dashboard";
import { AppShell } from "@/app/_components/app-shell";

export const dynamic = "force-dynamic";

export default async function MarkingPage() {
  const dashboard = await getMarkingDashboardData();
  if (!dashboard) redirect("/auth?redirect=/marking");

  return (
    <AppShell active="mark">
      <MarkingDashboard initialSavedPapers={dashboard.savedPapers} initialSubmissions={dashboard.submissions} userName={dashboard.user.name ?? "there"} initialLoadError={dashboard.initialLoadError} />
    </AppShell>
  );
}
