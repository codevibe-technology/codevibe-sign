import 'server-only';
import type { FileStore } from '@codevibe_technology/sign-core';
import type postgres from 'postgres';
import { DEFAULT_BRAND_COLOR, isHexColor, type BrandFont, BRAND_FONTS } from '@/lib/brand';
import { AppError } from './errors';

export interface Brand {
  workspaceId: string;
  logoUrl: string | null;
  brandColor: string;
  font: BrandFont;
  senderName: string | null;
  replyTo: string | null;
  emailOverrides: Record<string, { subject?: string; intro?: string }>;
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
    showBadge: row?.show_badge ?? true,
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
