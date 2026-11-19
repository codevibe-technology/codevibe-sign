export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#2DD4BF" />
      <path
        d="M8 20.5c2.4-3.6 4.2-5.4 5.4-5.4 1.8 0 .2 5.6 2 5.6 1.3 0 2.6-2.6 3.9-2.6 1 0 1 1.6 2.2 1.6.8 0 1.6-.6 2.5-1.7"
        fill="none"
        stroke="#0D1B2A"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 24h16" stroke="#0D1B2A" strokeWidth="2" strokeLinecap="round" opacity=".35" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="font-display text-[17px] leading-none font-bold">
        Codevibe <span className="text-accent">Sign</span>
      </span>
    </span>
  );
}
