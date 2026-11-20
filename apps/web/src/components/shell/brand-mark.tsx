/** The Codevibe mark: an asterisk with an open corner, drawn on the brand blue tile. */
export function CodevibeMark({
  className,
  color = 'currentColor',
}: {
  className?: string;
  color?: string;
}) {
  return (
    <svg viewBox="380 380 1172 1172" className={className} aria-hidden fill="none">
      <g stroke={color} strokeWidth="108" strokeLinecap="butt" strokeLinejoin="miter">
        <path d="M890 577V1508M424 1043H1356M561 713L1219 1371M561 1371L890 1043" />
        <path d="M988 478H1454V943" />
      </g>
    </svg>
  );
}

export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[6px] bg-primary ${className}`}
    >
      <CodevibeMark className="h-[62%] w-[62%]" color="#ffffff" />
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="font-display text-[17px] leading-none font-bold tracking-tight">
        codevibe <span className="text-accent">sign</span>
      </span>
    </span>
  );
}
