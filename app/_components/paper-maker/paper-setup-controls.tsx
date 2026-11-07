"use client";

import type { CSSProperties } from "react";
import { Clock3 } from "lucide-react";

import { EmbossIcon } from "@/app/_components/emboss/emboss-icon";
import { EMBOSS_PRESETS } from "@/app/_components/emboss/params";
import type { QuestionMixProfile } from "@/shared/domain/paper";
import { MAX_MARKS, MAX_TIME_MINUTES, MIN_MARKS, MIN_TIME_MINUTES } from "@/features/papers/client";

import { QUESTION_MIX_OPTIONS } from "@/app/_components/paper-maker/paper-setup-model";
type PaperSetupControlsProps = {
  generationEnabled: boolean;
  targetMarks: number;
  timeMinutes: number;
  activeMinutesPerMark: number;
  questionMix: QuestionMixProfile;
  activePaperOptions: { code: string; label: string }[];
  resolvedPaperCodes: Set<string>;
  paperSourcesCustomized: boolean;
  paperCount: number;
  onMarksChange: (value: number) => void;
  onTimeChange: (value: number) => void;
  onQuestionMixChange: (value: QuestionMixProfile) => void;
  onPaperCodeToggle: (code: string) => void;
  onSelectAllPapers: () => void;
  onClearPapers: () => void;
  onResetPapers: () => void;
  onPaperCountChange: (count: number) => void;
};

export function PaperSetupControls({ generationEnabled, targetMarks, timeMinutes, activeMinutesPerMark, questionMix, activePaperOptions, resolvedPaperCodes, paperSourcesCustomized, paperCount, onMarksChange, onTimeChange, onQuestionMixChange, onPaperCodeToggle, onSelectAllPapers, onClearPapers, onResetPapers, onPaperCountChange }: PaperSetupControlsProps) {
  return (
    <div>
      <section className="pb-7" aria-labelledby="length-heading">
        <h3 id="length-heading" className="text-[1rem] font-semibold tracking-[-0.025em] text-text">Session length</h3>
        <p className="mt-2 text-base leading-6 text-text-secondary">Choose a short session or set your own length.</p>
        <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-[5px] border border-text/12 bg-white" aria-label="Paper length presets">
          {[20, 40, 60].map((minutes) => <button key={minutes} type="button" onClick={() => onTimeChange(minutes)} disabled={!generationEnabled} aria-pressed={timeMinutes === minutes} className={`btn-press h-12 border-r border-text/12 text-sm font-semibold last:border-r-0 disabled:opacity-40 ${timeMinutes === minutes ? "bg-accent-soft text-accent" : "text-text hover:bg-bg-soft"}`}>{minutes} min</button>)}
        </div>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <label htmlFor="paper-target-marks" className="block">
            <span className="text-sm font-semibold text-text-secondary">Target marks</span>
            <span className="mt-2 flex items-center"><input id="paper-target-marks" type="number" min={MIN_MARKS} max={MAX_MARKS} step={5} value={targetMarks} onChange={(event) => onMarksChange(Number(event.target.value) || MIN_MARKS)} disabled={!generationEnabled} className="paper-number-input h-11 w-full min-w-0 bg-transparent font-mono text-[1.3rem] font-semibold text-text outline-none" /><span className="text-sm text-text-muted">marks</span></span>
          </label>
          <label htmlFor="paper-time-minutes" className="block">
            <span className="text-sm font-semibold text-text-secondary">Estimated minutes</span>
            <span className="mt-2 flex items-center"><input id="paper-time-minutes" type="number" min={MIN_TIME_MINUTES} max={MAX_TIME_MINUTES} step={5} value={timeMinutes} onChange={(event) => onTimeChange(Number(event.target.value) || MIN_TIME_MINUTES)} disabled={!generationEnabled} className="paper-number-input h-11 w-full min-w-0 bg-transparent font-mono text-[1.3rem] font-semibold text-text outline-none" /><span className="text-sm text-text-muted">min</span></span>
          </label>
        </div>
        <input type="range" min={MIN_MARKS} max={MAX_MARKS} step={5} value={targetMarks} onChange={(event) => onMarksChange(Number(event.target.value))} disabled={!generationEnabled} aria-label="Target marks" className="ui-range mt-6 w-full" style={{ "--range-progress": `${((targetMarks - MIN_MARKS) / (MAX_MARKS - MIN_MARKS)) * 100}%` } as CSSProperties} />
        <p className="mt-2 flex items-center gap-1.5 text-sm text-text-muted"><Clock3 className="h-3.5 w-3.5 text-accent" />About {activeMinutesPerMark.toFixed(2)} minutes per mark</p>
      </section>

      <details className="border-t border-text/12">
        <summary className="cursor-pointer py-5 text-sm font-semibold text-text">More options <span className="ml-2 font-normal text-text-muted">Question mix, sources and multiple papers</span></summary>
      <section className="pb-7" aria-labelledby="mix-heading">
        <h3 id="mix-heading" className="text-[1rem] font-semibold tracking-[-0.025em] text-text">Question mix</h3>
        <p className="mt-1 text-sm leading-5 text-text-muted">Choose how the marks are distributed.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {QUESTION_MIX_OPTIONS.map((option) => <button key={option.key} type="button" onClick={() => onQuestionMixChange(option.key)} disabled={!generationEnabled} aria-pressed={questionMix === option.key} className={`relative min-h-28 border p-4 pr-16 text-left transition-colors disabled:opacity-40 ${questionMix === option.key ? "border-accent/30 bg-bg-warm-soft text-text" : "border-text/12 bg-white text-text hover:border-text/20 hover:bg-bg-soft"}`}><span className="absolute right-2.5 top-2"><EmbossIcon icon={option.icon} color="#4747D8" surface={questionMix === option.key ? "#F2EFE8" : "#FFFFFF"} params={EMBOSS_PRESETS.control} size={46} /></span><span className="block text-sm font-bold">{option.label}</span><span className="mt-2 block text-sm leading-5 text-text-muted">{option.description}</span></button>)}
        </div>
      </section>

      <section className="border-t border-text/12 py-7" aria-labelledby="advanced-heading">
        <div className="flex items-start justify-between gap-4"><div><h3 id="advanced-heading" className="text-[1rem] font-semibold tracking-[-0.025em] text-text">Source papers</h3><p className="mt-1 text-sm leading-5 text-text-muted">Choose which papers questions can be drawn from.</p></div><div className="flex shrink-0 gap-3 text-sm font-semibold text-text-muted"><button type="button" onClick={onSelectAllPapers} className="hover:text-accent">Select all</button><button type="button" onClick={onClearPapers} className="hover:text-accent">Clear</button></div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {activePaperOptions.map((paper) => <label key={paper.code} className={`flex min-h-11 cursor-pointer items-center gap-2.5 border px-3 py-2 text-sm font-medium transition-colors ${resolvedPaperCodes.has(paper.code) ? "border-text/25 bg-bg-soft text-text" : "border-text/10 bg-white text-text-muted"}`}><input type="checkbox" checked={resolvedPaperCodes.has(paper.code)} onChange={() => onPaperCodeToggle(paper.code)} disabled={!generationEnabled} className="ui-checkbox h-[18px] w-[18px] shrink-0 disabled:opacity-40" />{paper.label}</label>)}
        </div>
        {paperSourcesCustomized ? <button type="button" onClick={onResetPapers} className="mt-3 text-sm font-semibold text-accent hover:text-accent-deep">Reset to topic-matched sources</button> : null}
        <div className="mt-6 border-t border-text/10 pt-5"><h4 className="text-sm font-semibold text-text">Paper batch</h4><p className="mt-1 text-sm text-text-muted">Generate up to three papers from the same setup.</p><div className="mt-3 grid w-full grid-cols-3 overflow-hidden rounded-md border border-text/15 bg-white">{[1, 2, 3].map((count) => <button key={count} type="button" onClick={() => onPaperCountChange(count)} aria-pressed={paperCount === count} className={`btn-press border-r border-text/15 px-3 py-3 text-sm font-semibold last:border-r-0 ${paperCount === count ? "bg-accent text-white" : "text-text-muted hover:bg-bg-soft hover:text-text"}`}>{count} paper{count === 1 ? "" : "s"}</button>)}</div></div>
      </section>
      </details>
    </div>
  );
}
