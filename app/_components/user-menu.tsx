"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/app/_components/auth-provider";
import { LogOut, User, ChevronDown } from "lucide-react";

export function UserMenu() {
  const { user, isLoaded, isAuthenticated, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!isLoaded) {
    return (
      <div className="h-9 w-16 animate-pulse bg-text/[0.05]" />
    );
  }

  if (!isAuthenticated) {
    return (
      <Link
        href="/auth"
        className="btn-press inline-flex min-h-10 min-w-[76px] items-center justify-center gap-1.5 rounded-[4px] bg-accent px-3 text-[0.78rem] font-bold text-white hover:bg-accent-deep"
        aria-label="Sign in"
      >
        <User className="h-3.5 w-3.5 shrink-0 text-white" strokeWidth={2} />
        <span className="text-white">Sign in</span>
      </Link>
    );
  }

  const displayName = user?.name?.trim() || user?.email?.split("@")[0] || "Student";
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? "Close account menu" : "Open account menu"}
        className="btn-press flex min-h-11 items-center gap-2 pl-3 hover:text-accent"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-warm-soft text-[0.68rem] font-bold text-text">
          {initials || "?"}
        </span>
        <span className="hidden max-w-[100px] truncate text-[0.76rem] font-semibold text-text lg:block">
          {displayName.split(" ")[0]}
        </span>
        <ChevronDown className={`hidden h-3 w-3 text-text-subtle transition-transform duration-150 ease-out sm:block ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[220px] overflow-hidden rounded-[8px] border border-text/10 bg-bg-elevated shadow-[0_18px_52px_rgba(23,33,63,0.14)]">
          <div className="border-b border-text/[0.07] px-4 py-3.5">
            <p className="truncate text-[0.86rem] font-semibold text-text">{displayName}</p>
            <p className="mt-0.5 truncate text-[0.72rem] text-text-muted">{user?.email}</p>
          </div>
          <div className="p-1.5">
            <Link
              href="/marking"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[0.8rem] font-medium text-text-secondary transition-colors hover:bg-bg-soft hover:text-text"
            >
              <span>Self-mark your papers</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[0.8rem] font-medium text-text-secondary transition-colors hover:bg-bg-soft hover:text-text"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
