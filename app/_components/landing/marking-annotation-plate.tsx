import Image from "next/image";

export function MarkingAnnotationPlate() {
  return (
    <article data-marking-proof className="relative overflow-hidden border border-text/15 bg-[#ebe8df] px-5 py-8 text-[#17213f] sm:px-8 sm:py-10" aria-label="Example marked handwritten response">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(13,23,52,0.045)_1px,transparent_1px)] [background-size:100%_29px]" aria-hidden="true" />

      <div className="relative mx-auto grid max-w-[680px] gap-8 md:grid-cols-[minmax(0,410px)_minmax(0,1fr)] md:items-center md:gap-9">
        <div data-proof-answer className="relative z-0 mx-auto w-full max-w-[410px] rotate-[-0.35deg] bg-white p-[7px] shadow-[0_18px_38px_rgba(23,33,63,0.16)]">
          <header className="border-b border-text/25 px-3 py-3 font-serif text-text">
            <div className="flex items-start justify-between gap-4">
              <p className="text-[0.72rem] leading-5"><span className="mr-2 font-semibold">3(c)</span>Explain how flood defences can reduce the impact of flooding.</p>
              <span className="shrink-0 font-mono text-[0.58rem] font-semibold text-text-muted">[6 marks]</span>
            </div>
          </header>
          <div className="relative min-w-0 overflow-visible">
            <Image src="/landing/marks.png" alt="Handwritten flood defence response" width={1122} height={1402} className="block h-auto w-full" priority />
            <span data-answer-highlight className="pointer-events-none absolute left-[11%] top-[29.5%] h-[8%] w-[80%] -rotate-[0.4deg] bg-accent-warm/30 mix-blend-multiply" aria-hidden="true" />
            <span data-answer-highlight className="pointer-events-none absolute left-[11%] top-[59.5%] h-[12%] w-[80%] rotate-[0.35deg] bg-accent-warm/30 mix-blend-multiply" aria-hidden="true" />


          </div>
        </div>

        <aside className="relative z-0" aria-label="Examiner assessment">
          <div className="flex items-end justify-between gap-4 border-b border-text/20 pb-4">
            <div>
              <p className="mt-2 text-[0.72rem] leading-5 text-text-secondary">Accurate, relevant, but not fully developed.</p>
            </div>
            <p className="relative shrink-0 px-2 py-1 font-mono text-[1.45rem] font-bold tracking-[-0.06em] text-accent">
              4 / 6
              <svg data-score-emphasis className="pointer-events-none absolute -inset-x-1 -inset-y-0.5 h-[calc(100%+4px)] w-[calc(100%+8px)]" viewBox="0 0 84 48" fill="none" aria-hidden="true">
                <path d="M7 25C7 8 25 3 44 4C66 5 80 13 78 27C76 42 56 46 37 44C18 43 5 37 7 25Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M9 24C11 10 27 6 45 6C65 7 77 15 76 27" stroke="currentColor" strokeOpacity=".42" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </p>
          </div>

          <dl data-proof-evidence className="divide-y divide-text/12">
            <div className="grid grid-cols-[44px_1fr] gap-3 py-4">
              <dt data-evidence-target="assertion" className="font-mono text-[0.62rem] font-bold text-danger">0</dt>
              <dd>
                <p className="text-[0.72rem] font-bold text-text">Assertion only — no credit</p>
                <p className="mt-1 text-[0.65rem] leading-4 text-text-muted">The opening is too general to demonstrate separate knowledge.</p>
              </dd>
            </div>
            <div className="grid grid-cols-[44px_1fr] gap-3 py-4">
              <dt data-evidence-target="ao1" className="font-mono text-[0.62rem] font-bold text-success">AO1</dt>
              <dd>
                <p className="text-[0.72rem] font-bold text-text">AO1 · 2/2</p>
                <p className="mt-1 text-[0.65rem] leading-4 text-text-muted">Two accurate mechanisms: walls hold water back; embankments increase channel capacity.</p>
              </dd>
            </div>
            <div className="grid grid-cols-[44px_1fr] gap-3 py-4">
              <dt data-evidence-target="ao2" className="font-mono text-[0.62rem] font-bold text-success">AO2</dt>
              <dd>
                <p className="text-[0.72rem] font-bold text-text">AO2 · 2/4</p>
                <p className="mt-1 text-[0.65rem] leading-4 text-text-muted">Both mechanisms reach a relevant consequence, but each chain stops after one causal step.</p>
              </dd>
            </div>
          </dl>

          <div data-proof-next className="border-l-2 border-warning bg-warning-soft/55 px-3.5 py-3">
            <p className="font-mono text-[0.57rem] font-bold uppercase tracking-[0.12em] text-warning">Why this stops at 4/6</p>
            <p className="mt-1.5 text-[0.68rem] leading-5 text-text-secondary">Develop one chain further: reduced depth or velocity leads to less structural damage, disruption or danger. A precise example would strengthen it.</p>
          </div>
        </aside>

        <svg data-evidence-connectors className="pointer-events-none absolute inset-0 z-10 hidden h-full w-full overflow-visible md:block" viewBox="0 0 680 580" preserveAspectRatio="none" fill="none" aria-hidden="true">
          <g data-evidence-connector="assertion" stroke="#B33A3A" strokeLinecap="round" strokeLinejoin="round">
            <path d="M374 153C405 153 421 149 450 140M450 140L433 138M450 140L438 153" strokeWidth="2.2" />
          </g>
          <g data-evidence-connector="ao1" stroke="#0A6B4F" strokeLinecap="round" strokeLinejoin="round">
            <path d="M375 267C410 267 421 246 450 225M450 225L431 228M450 225L440 242" strokeWidth="2.2" />
          </g>
          <g data-evidence-connector="ao2" stroke="#0A6B4F" strokeLinecap="round" strokeLinejoin="round">
            <path d="M374 441C420 428 422 353 450 328M450 328L431 334M450 328L442 346" strokeWidth="2.2" />
          </g>
        </svg>
      </div>
    </article>
  );
}
