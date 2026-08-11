"use client";

import Link, { useLinkStatus } from "next/link";

type ShellNavLinkProps = {
  href: "/paper-maker" | "/marking";
  label: string;
  active: boolean;
  direction: "nav-forward" | "nav-back";
};

function PendingCue() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" data-pending={pending} className="shell-nav-pending" />;
}

export function ShellNavLink({ href, label, active, direction }: ShellNavLinkProps) {
  return (
    <Link
      href={href}
      transitionTypes={[direction]}
      aria-current={active ? "page" : undefined}
      className={`btn-press relative inline-flex h-full items-center px-1 text-[0.82rem] font-semibold ${active ? "text-accent" : "text-text hover:text-accent"}`}
    >
      <span>{label}</span>
      {active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" style={{ viewTransitionName: "product-nav-indicator" }} /> : null}
      <PendingCue />
    </Link>
  );
}
