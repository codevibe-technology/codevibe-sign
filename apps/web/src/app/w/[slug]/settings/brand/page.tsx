import type { Metadata } from 'next';
import { BrandForm } from '@/components/settings/brand-form';
import { requireWorkspace } from '@/server/auth/guards';
import { getBrand } from '@/server/brand';
import { db } from '@/server/db';

export const metadata: Metadata = { title: 'Brand' };

export default async function BrandSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'brand.manage');
  const brand = await getBrand(db(), workspace.id);
  return (
    <BrandForm
      workspace={workspace}
      brand={{
        logoUrl: brand.logoUrl,
        brandColor: brand.brandColor,
        font: brand.font,
        senderName: brand.senderName ?? '',
      }}
    />
  );
}
