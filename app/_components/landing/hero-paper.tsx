import Image from "next/image";

const BUILD_CHOICES = [
  { label: "Course", value: "AQA Geography" },
  { label: "Topics", value: "Climate change" },
  { label: "Length", value: "20 minutes" },
];

export function HeroPaper() {
  return (
    <figure data-hero-paper className="relative mx-auto w-full max-w-[560px]">
      <dl className="grid grid-cols-3 overflow-hidden rounded-md border border-text/15 bg-white text-left">
        {BUILD_CHOICES.map((choice, index) => (
          <div key={choice.label} className={`min-w-0 px-3 py-2.5 sm:px-4 ${index > 0 ? "border-l border-text/10" : ""}`}>
            <dt className="text-xs text-text-secondary">{choice.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold leading-5 text-text">{choice.value}</dd>
          </div>
        ))}
      </dl>
      <div className="relative mt-4">
        <div className="absolute inset-x-6 -bottom-3 top-3 rounded-[3px] border border-text/10 bg-white/70" aria-hidden="true" />
        <div className="relative aspect-[1/1.02] overflow-hidden rounded-[3px] border border-text/15 bg-white shadow-[0_18px_40px_rgba(13,23,52,0.12)]">
          <Image
            src="/landing/aqa-geography-paper-page.png"
            alt="Question page from a generated AQA Geography paper: questions on Arctic sea ice using a data table"
            width={1275}
            height={1650}
            priority
            sizes="(min-width: 1024px) 560px, 92vw"
            className="h-auto w-full"
          />
        </div>
      </div>
      <figcaption className="mt-5 text-center text-sm text-text-secondary lg:text-left">Illustrative example · a page from a generated paper</figcaption>
    </figure>
  );
}
