import { BRAND_NAME, EMAIL_LOGO, LOCKUP } from './brand-assets';
import { DEFAULT_BRAND_COLOR, isHexColor, textOn } from './brand';

/**
 * The one layout every email uses: a white card on a light page, the logo, a heading, short
 * paragraphs, an optional details box, one button with its link written out below, and a
 * footer saying why the email came. Tables and inline styles only, so Gmail, Outlook and
 * Apple Mail draw it the same; the plain-text part is built from the same parts.
 */

export interface EmailButton {
  label: string;
  href: string;
}

export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailLink {
  name: string;
  url: string;
}

/** What sits at the top of the card. */
export type EmailHeader =
  /** The Codevibe Sign lockup, served by the app at `appUrl`. */
  | { kind: 'codevibe' }
  /**
   * A workspace's own uploaded logo, an absolute URL. With `name`, the logo is a square mark
   * and the name is set beside it; without, the logo is wide and carries the name itself.
   */
  | { kind: 'logo'; src: string; alt: string; name?: string }
  /** A workspace without a logo: its name, in its colour. */
  | { kind: 'name'; name: string };

export interface EmailFooter {
  /** Why this person got the email. */
  reason: string;
  /** Short lines under the reason, such as the certificate note or the company address. */
  lines?: string[];
  links?: { label: string; href: string }[];
}

export interface EmailSpec {
  /** The public URL of the app, without a trailing slash. Images and footer links use it. */
  appUrl: string;
  /** The line mail apps show after the subject in the inbox. */
  preheader: string;
  header: EmailHeader;
  heading: string;
  paragraphs: string[];
  /** A message written by a person, shown set apart with who wrote it. */
  quote?: { label: string; text: string };
  /** A one-time code, shown large so it is easy to read and copy. */
  code?: string;
  details?: EmailDetail[];
  button?: EmailButton;
  /** More links, one per line, such as a download per document. */
  links?: EmailLink[];
  /** Small print under the button. */
  notes?: string[];
  footer: EmailFooter;
  /** Button and accent colour; the brand blue when absent or not a hex colour. */
  color?: string;
}

export interface EmailBody {
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT = `Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const INK = '#0D1B2A';
const MUTED = '#5B6B80';
const LINE = '#E3E8EF';
const PAGE = '#F4F6FA';
const BOX = '#F7F9FC';

const DARK_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.cv-page{background:#0B1220!important}
.cv-card{background:#111A2B!important;border-left-color:#24324A!important;border-right-color:#24324A!important;border-bottom-color:#24324A!important}
.cv-ink{color:#E6EDF7!important}
.cv-muted{color:#9AA8BC!important}
.cv-box{background:#0D1627!important;border-color:#24324A!important}
.cv-logo-light{display:none!important}
.cv-logo-dark{display:block!important;max-height:none!important}
}
@media (max-width:480px){
.cv-pad{padding-left:20px!important;padding-right:20px!important}
.cv-outer{padding:16px 8px!important}
.cv-heading{font-size:20px!important;line-height:28px!important}
}`;

const lines = (text: string) => escapeHtml(text).replace(/\n/g, '<br>');

function header(spec: EmailSpec): string {
  const h = spec.header;
  if (h.kind === 'codevibe') {
    const { width, height } = EMAIL_LOGO;
    const img = (src: string) =>
      `<img src="${escapeHtml(spec.appUrl + src)}" alt="${BRAND_NAME}" width="${width}" height="${height}" style="display:block;border:0;outline:none;width:${width}px;height:${height}px">`;
    return (
      `<div class="cv-logo-light">${img(LOCKUP.email)}</div>` +
      `<!--[if !mso]><!--><div class="cv-logo-dark" style="display:none;max-height:0;overflow:hidden">${img(LOCKUP.emailDark)}</div><!--<![endif]-->`
    );
  }
  if (h.kind === 'logo' && h.name) {
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
<td valign="middle" style="padding:0 12px 0 0"><img src="${escapeHtml(h.src)}" alt="" width="40" height="40" style="display:block;border:0;outline:none;width:40px;height:40px"></td>
<td valign="middle" class="cv-ink" style="font-size:18px;line-height:24px;font-weight:700;color:${INK}">${escapeHtml(h.name)}</td>
</tr></table>`;
  }
  if (h.kind === 'logo') {
    return `<img src="${escapeHtml(h.src)}" alt="${escapeHtml(h.alt)}" height="32" style="display:block;border:0;outline:none;height:32px;width:auto;max-width:180px">`;
  }
  return `<span class="cv-ink" style="font-size:20px;line-height:28px;font-weight:700;color:${INK}">${escapeHtml(h.name)}</span>`;
}

function button(b: EmailButton, color: string): string {
  const ink = textOn(color);
  const href = escapeHtml(b.href);
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:28px 0 0"><tr>
<td align="center" bgcolor="${color}" style="border-radius:999px;background:${color}">
<a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${ink};text-decoration:none;border-radius:999px;border:1px solid ${color}">${escapeHtml(b.label)}</a>
</td></tr></table>
<p class="cv-muted" style="margin:16px 0 0;font-size:13px;line-height:20px;color:${MUTED}">Button not working? Paste this link into your browser:<br><a href="${href}" style="color:${color};word-break:break-all">${href}</a></p>`;
}

function details(items: EmailDetail[]): string {
  const rows = items
    .map(
      (d, i) => `<tr>
<td class="cv-muted" valign="top" style="padding:${i ? '8px' : '0'} 16px 0 0;font-size:13px;line-height:20px;color:${MUTED};white-space:nowrap">${escapeHtml(d.label)}</td>
<td class="cv-ink" valign="top" style="padding:${i ? '8px' : '0'} 0 0;font-size:14px;line-height:20px;font-weight:600;color:${INK};word-break:break-word">${lines(d.value)}</td>
</tr>`,
    )
    .join('');
  return `<table role="presentation" class="cv-box" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:20px 0 0;background:${BOX};border:1px solid ${LINE};border-radius:10px">
<tr><td style="padding:16px 18px"><table role="presentation" border="0" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
}

function quote(q: { label: string; text: string }, color: string): string {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:4px 0 16px"><tr>
<td width="3" bgcolor="${color}" style="background:${color};width:3px;border-radius:2px"></td>
<td class="cv-ink" style="padding:2px 0 2px 14px;font-size:15px;line-height:24px;color:${INK}">
<span class="cv-muted" style="display:block;font-size:12px;line-height:18px;color:${MUTED};font-weight:600">${escapeHtml(q.label)}</span>${lines(q.text)}</td>
</tr></table>`;
}

function code(value: string): string {
  return `<table role="presentation" class="cv-box" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;background:${BOX};border:1px solid ${LINE};border-radius:10px">
<tr><td class="cv-ink" style="padding:14px 24px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:30px;line-height:36px;font-weight:700;letter-spacing:6px;color:${INK}">${escapeHtml(value)}</td></tr></table>`;
}

function footer(f: EmailFooter): string {
  const p = (html: string) =>
    `<p class="cv-muted" style="margin:0 0 6px;font-size:12px;line-height:18px;color:${MUTED}">${html}</p>`;
  const links = f.links?.length
    ? p(
        f.links
          .map(
            (l) =>
              `<a href="${escapeHtml(l.href)}" class="cv-muted" style="color:${MUTED};text-decoration:underline">${escapeHtml(l.label)}</a>`,
          )
          .join(' &nbsp;·&nbsp; '),
      )
    : '';
  return [p(lines(f.reason)), ...(f.lines ?? []).map((line) => p(lines(line))), links].join('\n');
}

/** The HTML and plain-text parts of one email. */
export function renderEmail(spec: EmailSpec): EmailBody {
  const color = spec.color && isHexColor(spec.color) ? spec.color : DEFAULT_BRAND_COLOR;
  const para = (text: string) =>
    `<p class="cv-ink" style="margin:0 0 16px;font-size:15px;line-height:24px;color:${INK}">${lines(text)}</p>`;
  const linkList = (spec.links ?? [])
    .map(
      (l) =>
        `<p style="margin:0 0 8px;font-size:15px;line-height:22px"><a href="${escapeHtml(l.url)}" style="color:${color};font-weight:600;text-decoration:underline">${escapeHtml(l.name)}</a></p>`,
    )
    .join('');
  const notes = (spec.notes ?? [])
    .map(
      (n) =>
        `<p class="cv-muted" style="margin:16px 0 0;font-size:13px;line-height:20px;color:${MUTED}">${lines(n)}</p>`,
    )
    .join('');
  const preheader = escapeHtml(spec.preheader) + '&#847;&zwnj;&nbsp;'.repeat(40);

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(spec.heading)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>${DARK_CSS}</style>
</head>
<body class="cv-page" style="margin:0;padding:0;width:100%;background:${PAGE};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE}">${preheader}</div>
<table role="presentation" class="cv-page" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${PAGE}" style="background:${PAGE}">
<tr><td class="cv-outer" align="center" style="padding:32px 16px;font-family:${FONT}">
<!--[if mso]><table role="presentation" width="600" align="center" border="0" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
<tr><td class="cv-card" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ${LINE};border-top:4px solid ${color};border-radius:12px">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
<tr><td class="cv-pad" style="padding:28px 40px 0;font-family:${FONT}">${header(spec)}</td></tr>
<tr><td class="cv-pad" style="padding:24px 40px 36px;font-family:${FONT}">
<h1 class="cv-ink cv-heading" style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:700;color:${INK}">${escapeHtml(spec.heading)}</h1>
${spec.paragraphs.map(para).join('\n')}
${spec.quote ? quote(spec.quote, color) : ''}
${linkList}
${spec.code ? code(spec.code) : ''}
${spec.details?.length ? details(spec.details) : ''}
${spec.button ? button(spec.button, color) : ''}
${notes}
</td></tr>
</table>
</td></tr>
<tr><td class="cv-pad" align="left" style="padding:24px 40px 8px;font-family:${FONT}">
${footer(spec.footer)}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const text = [
    spec.heading,
    ...spec.paragraphs,
    ...(spec.quote ? [`${spec.quote.label}: ${spec.quote.text}`] : []),
    ...(spec.code ? [spec.code] : []),
    ...(spec.links?.length ? [spec.links.map((l) => `${l.name}: ${l.url}`).join('\n')] : []),
    ...(spec.details?.length
      ? [spec.details.map((d) => `${d.label}: ${d.value.replace(/\n/g, ', ')}`).join('\n')]
      : []),
    ...(spec.button ? [`${spec.button.label}: ${spec.button.href}`] : []),
    ...(spec.notes ?? []),
    [
      '--',
      spec.footer.reason,
      ...(spec.footer.lines ?? []),
      ...(spec.footer.links ?? []).map((l) => `${l.label}: ${l.href}`),
    ].join('\n'),
  ].join('\n\n');
  return { html, text };
}

/** Footer links every email can carry: help and the privacy notice of this app. */
export function standardLinks(appUrl: string): { label: string; href: string }[] {
  return [
    { label: 'Help', href: `${appUrl}/docs/` },
    { label: 'Privacy', href: `${appUrl}/privacy` },
  ];
}
