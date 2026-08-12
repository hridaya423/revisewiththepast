import { BadgeCheck, FilePlus2, PencilLine, TrendingUp } from "lucide-react";

import { EmbossIcon } from "@/app/_components/emboss/emboss-icon";
import { EMBOSS_PRESETS } from "@/app/_components/emboss/params";

const STEPS = [
  { title: "Build", description: "Choose your course, topics and paper length.", icon: FilePlus2, color: "#4E7760" },
  { title: "Complete", description: "Work through one focused paper.", icon: PencilLine, color: "#496D8C" },
  { title: "Mark", description: "Check each answer against the marking guidance.", icon: BadgeCheck, color: "#0A6B4F" },
  { title: "Improve", description: "Use the gaps to choose what to practise next.", icon: TrendingUp, color: "#946200" },
];

export function WorkflowPaper() {
  return (
    <div data-workflow-journey>
      <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-14">
        {STEPS.map(({ title, description, icon, color }) => (
          <li data-workflow-step key={title} className="flex flex-col items-center text-center">
            <span data-workflow-glyph className="workflow-glyph flex h-[58px] w-[58px] items-center justify-center rounded-[8px] border border-text/15 bg-bg-warm" aria-hidden="true">
              <EmbossIcon icon={icon} color={color} surface="#ECE9E1" params={EMBOSS_PRESETS.process} size={58} />
            </span>
            <h3 className="mt-5 text-[1rem] font-extrabold tracking-[-0.03em] text-text">{title}</h3>
            <p className="mt-2 max-w-[25ch] text-[0.7rem] leading-5 text-text-muted">{description}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
