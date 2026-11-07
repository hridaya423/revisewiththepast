import Link from "next/link";
import { ArrowRight } from "lucide-react";

export type CourseDirectoryRow = {
  title: string;
  routes: Array<{ key: string; boardLabel: string; tierLabel?: string }>;
};

export function CourseDirectory({ rows }: { rows: CourseDirectoryRow[] }) {
  return (
    <ul data-course-directory className="divide-y divide-text/10 border-y border-text/15">
      {rows.map((row) => (
        <li key={row.title} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center sm:gap-6">
          <h3 className="text-base font-semibold text-text">{row.title}</h3>
          <div className="flex flex-wrap gap-2">
            {row.routes.map((route) => (
              <Link
                key={route.key}
                href={`/paper-maker?subject=${route.key}`}
                transitionTypes={["nav-forward"]}
                aria-label={`Build a ${route.boardLabel} ${row.title} paper`}
                className="group inline-flex min-h-11 items-center gap-2 rounded-md border border-text/20 bg-white px-3 text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent"
              >
                {route.boardLabel}
                {route.tierLabel ? <span className="font-normal text-text-secondary">{route.tierLabel}</span> : null}
                <ArrowRight className="h-4 w-4 text-text-secondary transition-colors group-hover:text-accent" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
