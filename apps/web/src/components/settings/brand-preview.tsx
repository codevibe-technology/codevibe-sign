import { BRAND_FONT_STACKS, textOn, type BrandFont } from '@/lib/brand';

/** The top of the signing page as recipients will see it, drawn from the form's current values. */
export function BrandPreview({
  logoUrl,
  brandColor,
  font,
  senderName,
  workspaceName,
}: {
  logoUrl: string | null;
  brandColor: string;
  font: BrandFont;
  senderName: string;
  workspaceName: string;
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
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${workspaceName} logo`}
            className="h-8 max-w-[140px] rounded bg-white/90 object-contain p-0.5"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded bg-white/20 text-sm font-bold">
            {from.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="truncate font-semibold">{from}</span>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm">
          <strong>{from}</strong> sent you <strong>Offer letter.pdf</strong> to sign.
        </p>
        <div className="h-16 rounded-md border border-[#D9E0EA] bg-white" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[#526277]">Secured by Codevibe Sign</span>
          <span
            className="shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap"
            style={{ background: brandColor, color: ink }}
          >
            Review and sign
          </span>
        </div>
      </div>
    </figure>
  );
}
