type BrandMarkProps = {
  className?: string;
  title?: string;
};

export function BrandMark({ className = "h-10 w-9", title }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 48 52"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d="M7 7.5 30 2l9 36-23 6z" fill="#0D1734" opacity=".98" />
      <path d="M13 11 38 7l5 37-25 4z" fill="currentColor" />
      <path d="M38 7l5 37-7-5z" fill="#62E2B6" />
      <path d="m20 29 6 5 10-14" fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.2" />
    </svg>
  );
}
