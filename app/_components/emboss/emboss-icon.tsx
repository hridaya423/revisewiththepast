import type { LucideIcon } from "lucide-react";

import type { EmbossParams } from "@/app/_components/emboss/params";

type EmbossIconProps = {
  icon?: LucideIcon;
  label?: string;
  flag?: "fr";
  color: string;
  surface: string;
  params: EmbossParams;
  size?: number;
};

function alpha(hex: string, opacity: number) {
  const value = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0");
  return `${hex}${value}`;
}

export function EmbossIcon({ icon: Icon, label, flag, color, surface, params, size = 56 }: EmbossIconProps) {
  const iconSize = Math.round(size * 0.48);
  const depth = params.depth;
  const filter = `drop-shadow(-${depth}px -${depth}px ${params.soften}px ${alpha(color, params.shadow + 0.14)}) drop-shadow(${depth}px ${depth}px ${params.soften}px rgba(255,255,255,${params.highlight}))`;

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
      }}
      aria-hidden="true"
    >
      {flag === "fr" ? (
        <span
          className="grid h-[22px] w-[32px] grid-cols-3 overflow-hidden rounded-[3px] border border-white/70"
          style={{
            backgroundColor: surface,
            filter: `drop-shadow(-${depth}px -${depth}px ${params.soften}px rgba(255,255,255,${params.highlight})) drop-shadow(${depth}px ${depth}px ${params.soften}px rgba(13,23,52,0.2))`,
          }}
        >
          <span style={{ backgroundColor: "#244A9F", boxShadow: "inset 1px 1px 1px rgba(255,255,255,0.42), inset -1px -1px 1px rgba(13,23,52,0.28)" }} />
          <span style={{ backgroundColor: "#F8F9FB", boxShadow: "inset 1px 1px 1px rgba(255,255,255,0.95), inset -1px -1px 1px rgba(13,23,52,0.12)" }} />
          <span style={{ backgroundColor: "#D84A58", boxShadow: "inset 1px 1px 1px rgba(255,255,255,0.42), inset -1px -1px 1px rgba(13,23,52,0.24)" }} />
        </span>
      ) : Icon ? (
        <Icon
          width={iconSize}
          height={iconSize}
          strokeWidth={2.15}
          style={{ color: surface, filter }}
        />
      ) : (
        <span className="font-mono text-[1rem] font-black tracking-[-0.08em]" style={{ color: surface, filter }}>{label}</span>
      )}
    </span>
  );
}
