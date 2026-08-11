import Image from "next/image";

export type PaperPreviewImage = {
  src: string;
  alt: string;
};

type PaperPreviewProps = {
  images: PaperPreviewImage[];
  selectedIndex?: number;
  className?: string;
};

export function PaperPreview({ images, selectedIndex = 0, className = "" }: PaperPreviewProps) {
  return (
    <div className={`relative aspect-[0.92] w-full ${className}`} role="group" aria-label="Paper preview">
      {images.map((image, index) => {
        const offset = index - selectedIndex;
        return (
          <figure
            key={`${image.src}-${index}`}
            className="paper-surface absolute left-1/2 top-1/2 aspect-[0.707] w-[62%] overflow-hidden rounded-[3px] bg-white"
            style={{
              zIndex: images.length - Math.abs(offset),
              transform: `translate(calc(-50% + ${offset * 27}%), calc(-50% + ${Math.abs(offset) * 3}%)) rotate(${offset * 4}deg)`,
            }}
          >
            <Image src={image.src} alt={image.alt} fill sizes="(max-width: 768px) 70vw, 520px" className="object-cover object-top" />
          </figure>
        );
      })}
    </div>
  );
}
