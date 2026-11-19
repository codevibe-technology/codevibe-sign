import type { Metadata } from 'next';
import { BrandForm } from '@/components/settings/brand-form';
import { EmailBrandForm } from '@/components/settings/email-brand-form';
import { SigningBrandForm } from '@/components/settings/signing-brand-form';
import { requireWorkspace } from '@/server/auth/guards';
import { getBrand } from '@/server/brand';
import { db } from '@/server/db';
import { env } from '@/server/env';

export const metadata: Metadata = { title: 'Brand' };

export default async function BrandSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'brand.manage');
  const brand = await getBrand(db(), workspace.id);
  const appUrl = env().APP_URL;
  return (
    <>
      <BrandForm
        workspace={workspace}
        brand={{
          logoUrl: brand.logoUrl,
          brandColor: brand.brandColor,
          font: brand.font,
          senderName: brand.senderName ?? '',
          showBadge: brand.showBadge,
        }}
      />
      <EmailBrandForm
        workspace={workspace}
        values={{
          senderName: brand.senderName ?? '',
          replyTo: brand.replyTo ?? '',
          overrides: brand.emailOverrides,
        }}
        look={{
          brandColor: brand.brandColor,
          logoUrl: brand.logoUrl,
          showBadge: brand.showBadge,
        }}
      />
      <SigningBrandForm
        workspaceId={workspace.id}
        appHost={new URL(appUrl).hostname}
        values={{
          showBadge: brand.showBadge,
          certificateFooter: brand.certificateFooter ?? '',
          signingDomain: brand.signingDomain ?? '',
          signingDomainVerified: brand.signingDomainVerified,
        }}
      />
    </>
  );
}
