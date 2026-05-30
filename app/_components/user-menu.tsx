"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { LogOut, User, ChevronDown } from "lucide-react";

export function UserMenu() {
  const { user, isLoaded, isAuthenticated, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  if (!isLoaded) {
    return (
      <div className="h-9 w-20 animate-pulse rounded-full bg-[#1a2e1a]/[0.04]" />
    );
  }

  if (!isAuthenticated) {
    return (
      <a
        href="/auth"
        className="btn-press inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded-full bg-[#1a2e1a] px-4 py-2 text-[0.78rem] font-semibold text-white shadow-[0_4px_14px_rgba(26,46,26,0.18)] transition-shadow hover:bg-[#233923] hover:shadow-[0_6px_20px_rgba(26,46,26,0.24)]"
        aria-label="Sign in"
      >
        <User className="h-3.5 w-3.5 shrink-0 text-white" strokeWidth={2} />
        <span className="text-white">Sign in</span>
      </a>
    );
  }

  const initials = user!.name
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
        className="btn-press flex items-center gap-2 rounded-full border border-[#1a2e1a]/10 bg-white px-2.5 py-1.5 transition-colors hover:bg-[#f8f7f4]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1a2e1a] text-[0.6rem] font-bold text-white">
          {initials || "?"}
        </span>
        <span className="max-w-[100px] truncate text-[0.78rem] font-medium text-[#1a2e1a]">
          {user!.name.split(" ")[0]}
        </span>
        <ChevronDown className={`h-3 w-3 text-[#1a2e1a]/40 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[200px] overflow-hidden rounded-[1rem] border border-[#1a2e1a]/[0.06] bg-white shadow-[0_16px_48px_rgba(26,46,26,0.12)]">
          <div className="border-b border-[#1a2e1a]/[0.06] px-4 py-3">
            <p className="truncate text-[0.88rem] font-medium text-[#1a2e1a]">{user!.name}</p>
            <p className="truncate text-[0.75rem] text-[#3d5a3f]/55">{user!.email}</p>
          </div>
          <div className="p-1.5">
            <a
              href="/marking"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.82rem] text-[#1a2e1a]/70 transition-colors hover:bg-[#f8f7f4] hover:text-[#1a2e1a]"
            >
              <span>Marking studio</span>
            </a>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.82rem] text-[#1a2e1a]/70 transition-colors hover:bg-[#f8f7f4] hover:text-[#1a2e1a]"
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
