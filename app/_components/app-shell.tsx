import Link from "next/link";
import { ViewTransition } from "react";

import { BrandMark } from "@/app/_components/brand-mark";
import { ShellNavLink } from "@/app/_components/shell-nav-link";
import { UserMenu } from "@/app/_components/user-menu";

type AppShellProps = {
  active?: "build" | "mark";
  children: React.ReactNode;
  wide?: boolean;
};

export function AppShell({ active, children, wide = false }: AppShellProps) {
  return (
    <div className="product-ui min-h-[100dvh] bg-bg-workspace">
      <header className="sticky top-0 z-40 border-b border-text/10 bg-white/95 backdrop-blur-sm" style={{ viewTransitionName: "site-header" }}>
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:h-16 sm:px-8 lg:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link href="/" className="group flex min-w-0 items-center gap-2.5 text-accent" aria-label="Revise with the Past home">
              <BrandMark className="h-8 w-7 shrink-0 transition-transform duration-150 ease-out group-active:scale-[0.98]" />
              <span className="hidden truncate text-[0.95rem] font-extrabold tracking-[-0.035em] text-text md:block">Revise with the Past</span>
            </Link>
          </div>

          <nav className="flex h-full items-center gap-8" aria-label="Product navigation">
            <ShellNavLink href="/paper-maker" label="Build" active={active === "build"} direction="nav-back" />
            <ShellNavLink href="/marking" label="Mark" active={active === "mark"} direction="nav-forward" />
          </nav>

          <div className="flex flex-1 justify-end">
            <UserMenu />
          </div>
        </div>
      </header>

      <ViewTransition
        enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
        exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
        default="none"
      >
        <main className={`mx-auto px-4 py-6 sm:px-8 sm:py-8 lg:px-10 ${wide ? "max-w-[1560px]" : "max-w-[1440px]"}`}>
          {children}
        </main>
      </ViewTransition>
    </div>
  );
}
