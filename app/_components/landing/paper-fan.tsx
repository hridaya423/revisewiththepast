import { PaperPreview, type PaperPreviewImage } from "@/app/_components/ui/paper-preview";

const PAPER_IMAGES: PaperPreviewImage[] = [
  {
    src: "/landing/generated-hero/2026-07-23T14-56-50/aqa-business/paper-1/page-01.png",
    alt: "The real generated cover page for a focused AQA GCSE Business practice paper",
  },
  {
    src: "/landing/aqa-geography-paper-page.png",
    alt: "A GCSE Geography question page with Arctic sea ice questions and a data table",
    eager: true,
  },
  {
    src: "/landing/generated-science-hero/2026-07-23T09-47-05/edexcel-combined-science-higher/paper-1/page-02.png",
    alt: "A real generated Edexcel Combined Science question page about DNA and natural selection",
  },
];

export function PaperFan() {
  return (
    <div data-paper-fan className="paper-fan-artifact" role="group" aria-label="Real pages from generated GCSE practice papers">
      <PaperPreview images={PAPER_IMAGES} className="h-[310px] sm:h-[390px] lg:h-[430px] xl:h-[460px]" />
    </div>
  );
}
