import Image from "next/image";
import type { CSSProperties } from "react";

export type PaperPreviewImage = {
  src: string;
  alt: string;
  eager?: boolean;
};

type PaperPreviewProps = {
  images: PaperPreviewImage[];
  selectedIndex?: number;
  className?: string;
};

export function PaperPreview({ images, selectedIndex, className = "" }: PaperPreviewProps) {
  const activeIndex = selectedIndex ?? Math.floor(images.length / 2);
  const occurrences = new Map<string, number>();
  const keyedImages = images.map((image) => {
    const occurrence = occurrences.get(image.src) ?? 0;
    occurrences.set(image.src, occurrence + 1);
    return { image, key: `${image.src}-${occurrence}` };
  });

  return (
    <div className={`relative aspect-[0.92] w-full ${className}`} role="group" aria-label="Paper preview">
      {keyedImages.map(({ image, key }, index) => {
        const offset = index - activeIndex;
        return (
          <figure
            key={key}
            className="paper-fan-sheet paper-surface absolute left-1/2 top-1/2 aspect-[0.707] w-[57%] overflow-hidden rounded-[3px] bg-white"
            style={{
              zIndex: images.length - Math.abs(offset),
              "--paper-x": `${offset * 27}%`,
              "--paper-y": `${Math.abs(offset) * 3}%`,
              "--paper-rotation": `${offset * 4}deg`,
            } as CSSProperties}
          >
            <Image src={image.src} alt={image.alt} fill sizes="(max-width: 768px) 70vw, 520px" loading={image.eager ? "eager" : undefined} className="object-cover object-top" />
          </figure>
        );
      })}
    </div>
  );
}
