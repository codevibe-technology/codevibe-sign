import 'server-only';
import type { FileStore } from '@codevibe_technology/sign-core';
import type postgres from 'postgres';
import { DEFAULT_BRAND_COLOR, isHexColor, type BrandFont, BRAND_FONTS } from '@/lib/brand';
import {
  INTRO_MAX,
  MAIL_KINDS,
  SUBJECT_MAX,
  unknownVariables,
  type MailOverrides,
} from '@/lib/mail-templates';
import { AppError } from './errors';
import { assertBadgeOptional, assertCustomDomain, workspacePlan } from './plans';

export interface Brand {
  workspaceId: string;
  logoUrl: string | null;
  brandColor: string;
  font: BrandFont;
  senderName: string | null;
  replyTo: string | null;
  emailOverrides: MailOverrides;
  signingDomain: string | null;
  signingDomainVerified: boolean;
  certificateFooter: string | null;
  showBadge: boolean;
}

export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const logoKey = (workspaceId: string) => `workspaces/${workspaceId}/brand/logo`;

interface Row {
  logo_content_type: string | null;
  logo_updated_at: Date | null;
  brand_color: string | null;
  font: BrandFont | null;
  sender_name: string | null;
  reply_to: string | null;
  email_overrides: Brand['emailOverrides'];
  signing_domain: string | null;
  signing_domain_verified_at: Date | null;
  certificate_footer: string | null;
  show_badge: boolean;
}

/** A workspace's brand with Codevibe defaults filled in for anything not set. */
export async function getBrand(sql: postgres.Sql, workspaceId: string): Promise<Brand> {
  const [row] = await sql<
    Row[]
  >`select * from app_brand_settings where workspace_id = ${workspaceId}`;
  const plan = await workspacePlan(sql, workspaceId).catch(() => null);
  return {
    workspaceId,
    logoUrl:
      row?.logo_content_type && row.logo_updated_at
        ? `/brand/${workspaceId}/logo?v=${row.logo_updated_at.getTime()}`
        : null,
    brandColor: row?.brand_color ?? DEFAULT_BRAND_COLOR,
    font: row?.font ?? 'inter',
    senderName: row?.sender_name ?? null,
    replyTo: row?.reply_to ?? null,
    emailOverrides: row?.email_overrides ?? {},
    signingDomain: row?.signing_domain ?? null,
    signingDomainVerified: Boolean(row?.signing_domain_verified_at),
    certificateFooter: row?.certificate_footer ?? null,
    showBadge: plan?.limits.badgeRequired ? true : (row?.show_badge ?? true),
  };
}

/** What anyone holding a signing link for the workspace sees: the header of the signing page. */
export interface SigningBrand {
  name: string;
  logoUrl: string | null;
  brandColor: string;
  font: BrandFont;
  showBadge: boolean;
}

export async function getSigningBrand(
  sql: postgres.Sql,
  workspaceId: string,
): Promise<SigningBrand | null> {
  const [workspace] = await sql<{ name: string }[]>`
    select name from app_workspaces where id = ${workspaceId}`;
  if (!workspace) return null;
  const brand = await getBrand(sql, workspaceId);
  return {
    name: brand.senderName ?? workspace.name,
    logoUrl: brand.logoUrl,
    brandColor: brand.brandColor,
    font: brand.font,
    showBadge: brand.showBadge,
  };
}

export interface BrandPatch {
  brandColor?: string;
  font?: string;
  senderName?: string | null;
}

export async function updateBrand(sql: postgres.Sql, workspaceId: string, patch: BrandPatch) {
  if (patch.brandColor !== undefined && !isHexColor(patch.brandColor)) {
    throw new AppError('VALIDATION', 'Use a colour like #1B6AE0', 'brandColor');
  }
  if (patch.font !== undefined && !(BRAND_FONTS as readonly string[]).includes(patch.font)) {
    throw new AppError('VALIDATION', 'Pick one of the listed fonts', 'font');
  }
  const senderName = patch.senderName?.replace(/[\r\n"<>]/g, '').trim() || null;
  if (senderName && senderName.length > 60) {
    throw new AppError('VALIDATION', 'Keep the sender name under 60 characters', 'senderName');
  }
  await sql`
    insert into app_brand_settings (workspace_id, brand_color, font, sender_name)
    values (${workspaceId}, ${patch.brandColor?.toUpperCase() ?? null}, ${patch.font ?? null},
      ${senderName})
    on conflict (workspace_id) do update set
      brand_color = coalesce(excluded.brand_color, app_brand_settings.brand_color),
      font = coalesce(excluded.font, app_brand_settings.font),
      sender_name = ${patch.senderName === undefined ? sql`app_brand_settings.sender_name` : sql`excluded.sender_name`},
      updated_at = now()`;
}

const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/;

/** The sender name as it can go in a `From` header: no quotes, brackets or line breaks. */
export const cleanSenderName = (value: string | null | undefined) =>
  value?.replace(/[\r\n"<>\\]/g, '').trim() || null;

export interface EmailSettings {
  senderName: string | null;
  replyTo: string | null;
  overrides: MailOverrides;
}

/** Checks every override, naming the field to fix, and drops empty ones. */
export function checkOverrides(input: MailOverrides): MailOverrides {
  const out: MailOverrides = {};
  for (const kind of MAIL_KINDS) {
    const given = input[kind];
    if (!given) continue;
    const subject = given.subject?.replace(/[\r\n]+/g, ' ').trim() ?? '';
    const intro = given.intro?.replace(/\r\n/g, '\n').trim() ?? '';
    if (subject.length > SUBJECT_MAX) {
      throw new AppError(
        'VALIDATION',
        `Keep the subject under ${SUBJECT_MAX} characters`,
        `overrides.${kind}.subject`,
      );
    }
    if (intro.length > INTRO_MAX) {
      throw new AppError(
        'VALIDATION',
        `Keep the text under ${INTRO_MAX} characters`,
        `overrides.${kind}.intro`,
      );
    }
    for (const [part, text] of [
      ['subject', subject],
      ['intro', intro],
    ] as const) {
      const unknown = unknownVariables(kind, text);
      if (unknown.length > 0) {
        throw new AppError(
          'VALIDATION',
          `{{${unknown[0]}}} is not available in this email. Use one of the variables listed.`,
          `overrides.${kind}.${part}`,
        );
      }
    }
    if (subject || intro) {
      out[kind] = { ...(subject ? { subject } : {}), ...(intro ? { intro } : {}) };
    }
  }
  return out;
}

export async function updateEmailSettings(
  sql: postgres.Sql,
  workspaceId: string,
  input: EmailSettings,
) {
  const senderName = cleanSenderName(input.senderName);
  if (senderName && senderName.length > 60) {
    throw new AppError('VALIDATION', 'Keep the sender name under 60 characters', 'senderName');
  }
  const replyTo = input.replyTo?.trim().toLowerCase() || null;
  if (replyTo && (replyTo.length > 254 || !EMAIL.test(replyTo))) {
    throw new AppError('VALIDATION', 'Enter an email address like hr@example.com', 'replyTo');
  }
  const overrides = checkOverrides(input.overrides);
  await sql`
    insert into app_brand_settings (workspace_id, sender_name, reply_to, email_overrides)
    values (${workspaceId}, ${senderName}, ${replyTo}, ${sql.json(overrides as never)})
    on conflict (workspace_id) do update set
      sender_name = excluded.sender_name, reply_to = excluded.reply_to,
      email_overrides = excluded.email_overrides, updated_at = now()`;
}

const DOMAIN =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A host name typed with or without a scheme or path, lower-cased; null when blank. */
export function normalizeDomain(value: string | null | undefined): string | null {
  const host = value
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
  if (!host) return null;
  if (!DOMAIN.test(host)) {
    throw new AppError(
      'VALIDATION',
      'Enter a domain like sign.example.com, without https:// or a path',
      'signingDomain',
    );
  }
  return host;
}

export interface SigningSettings {
  showBadge: boolean;
  certificateFooter: string | null;
  signingDomain: string | null;
}

export const FOOTER_MAX = 400;

export async function updateSigningSettings(
  sql: postgres.Sql,
  workspaceId: string,
  input: SigningSettings,
  appHost: string,
) {
  const footer = input.certificateFooter?.replace(/\s+/g, ' ').trim() || null;
  if (footer && footer.length > FOOTER_MAX) {
    throw new AppError(
      'VALIDATION',
      `Keep the footer under ${FOOTER_MAX} characters`,
      'certificateFooter',
    );
  }
  const domain = normalizeDomain(input.signingDomain);
  const plan = await workspacePlan(sql, workspaceId);
  if (!input.showBadge) assertBadgeOptional(plan);
  if (domain) assertCustomDomain(plan);
  if (domain && domain === appHost.toLowerCase()) {
    throw new AppError(
      'VALIDATION',
      'That is already the address of this app. Use a domain of your own, like sign.example.com',
      'signingDomain',
    );
  }
  try {
    await sql`
      insert into app_brand_settings (workspace_id, show_badge, certificate_footer, signing_domain)
      values (${workspaceId}, ${input.showBadge}, ${footer}, ${domain})
      on conflict (workspace_id) do update set
        show_badge = excluded.show_badge,
        certificate_footer = excluded.certificate_footer,
        signing_domain_verified_at = case
          when app_brand_settings.signing_domain is not distinct from excluded.signing_domain
          then app_brand_settings.signing_domain_verified_at end,
        signing_domain = excluded.signing_domain,
        updated_at = now()`;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AppError(
        'CONFLICT',
        'Another workspace already uses this domain. Pick a different one.',
        'signingDomain',
      );
    }
    throw err;
  }
}

/** The image type from the file's first bytes, never from its name or the browser's claim. */
export function sniffImage(bytes: Uint8Array): LogoType | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export async function setLogo(
  sql: postgres.Sql,
  files: FileStore,
  workspaceId: string,
  bytes: Uint8Array,
) {
  if (bytes.byteLength === 0) throw new AppError('VALIDATION', 'Choose an image file', 'logo');
  if (bytes.byteLength > LOGO_MAX_BYTES) {
    throw new AppError('VALIDATION', 'Use an image under 512 KB', 'logo');
  }
  const type = sniffImage(bytes);
  if (!type) throw new AppError('VALIDATION', 'Use a PNG, JPEG or WebP image', 'logo');
  await files.put(logoKey(workspaceId), bytes, type);
  await sql`
    insert into app_brand_settings (workspace_id, logo_content_type, logo_updated_at)
    values (${workspaceId}, ${type}, now())
    on conflict (workspace_id) do update set
      logo_content_type = excluded.logo_content_type,
      logo_updated_at = excluded.logo_updated_at, updated_at = now()`;
}

export async function removeLogo(sql: postgres.Sql, files: FileStore, workspaceId: string) {
  await sql`update app_brand_settings set logo_content_type = null, logo_updated_at = null,
    updated_at = now() where workspace_id = ${workspaceId}`;
  await files.delete(logoKey(workspaceId));
}

export async function readLogo(
  sql: postgres.Sql,
  files: FileStore,
  workspaceId: string,
): Promise<{ bytes: Uint8Array; type: LogoType } | null> {
  const [row] = await sql<{ logo_content_type: LogoType | null }[]>`
    select logo_content_type from app_brand_settings where workspace_id = ${workspaceId}`;
  if (!row?.logo_content_type) return null;
  const bytes = await files.get(logoKey(workspaceId));
  return bytes ? { bytes, type: row.logo_content_type } : null;
}
