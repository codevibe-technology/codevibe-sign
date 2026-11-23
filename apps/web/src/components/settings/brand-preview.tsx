import { BRAND_FONT_STACKS, textOn, type BrandFont } from '@/lib/brand';

/** The top of the signing page as recipients will see it, drawn from the form's current values. */
export function BrandPreview({
  logoUrl,
  logoWide = false,
  brandColor,
  font,
  senderName,
  workspaceName,
  showBadge = true,
}: {
  logoUrl: string | null;
  /** The logo carries the name, so the header shows it alone. */
  logoWide?: boolean;
  brandColor: string;
  font: BrandFont;
  senderName: string;
  workspaceName: string;
  showBadge?: boolean;
}) {
  const ink = textOn(brandColor);
  const from = senderName.trim() || workspaceName;
  return (
    <figure
      aria-label="Signing page preview"
      className="overflow-hidden rounded-xl border border-line bg-[#F4F6FA] text-[#0D1B2A]"
      style={{ fontFamily: BRAND_FONT_STACKS[font] }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ background: brandColor, color: ink }}
        data-testid="preview-header"
      >
        {logoUrl && logoWide ? (
          <img
            src={logoUrl}
            alt={`${workspaceName} logo`}
            data-shape="wide"
            className="h-8 w-auto max-w-[180px] rounded bg-white/90 object-contain px-1.5 py-0.5"
          />
        ) : logoUrl ? (
          <img
            src={logoUrl}
            alt={`${workspaceName} logo`}
            data-shape="mark"
            className="h-8 w-8 rounded bg-white/90 object-contain p-0.5"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded bg-white/20 text-sm font-bold">
            {from.slice(0, 1).toUpperCase()}
          </span>
        )}
        {logoUrl && logoWide ? null : <span className="truncate font-semibold">{from}</span>}
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm">
          <strong>{from}</strong> sent you <strong>Offer letter.pdf</strong> to sign.
        </p>
        <div className="h-16 rounded-md border border-[#D9E0EA] bg-white" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[#526277]">
            {showBadge ? 'Secured by Codevibe Sign' : ''}
          </span>
          <span
            className="shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap"
            style={{ background: brandColor, color: ink }}
          >
            Review and sign
          </span>
        </div>
      </div>
      {logoUrl ? (
        <figcaption className="border-t border-[#D9E0EA] bg-white px-4 py-2 text-xs text-[#526277]">
          {logoWide
            ? 'A wide logo already shows your name, so it stands on its own in the header.'
            : 'A square logo is a mark, so your name is shown next to it. Upload a logo at least twice as wide as it is tall to show it on its own.'}
        </figcaption>
      ) : null}
    </figure>
  );
}
