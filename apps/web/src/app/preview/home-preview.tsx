import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Landing, type HomeOption } from '@/components/marketing/landing';
import { planFeatures } from '@/lib/plans';
import { getSessionUser } from '@/server/auth/session';
import { currentPricing } from '@/server/billing/pricing';
import { planSettings } from '@/server/plans';

const NAMES: Record<HomeOption, string> = {
  a: 'tinted bands',
  b: 'colour mesh',
  c: 'colour blocks, paper and ink',
};

/** A design option for the home page: kept out of search and off every menu. */
export function previewMetadata(option: HomeOption): Metadata {
  return {
    title: `Home page option ${option.toUpperCase()}: ${NAMES[option]}`,
    robots: { index: false, follow: false, nocache: true },
  };
}

/** The home page in one of its colour options, on the hosted cloud only. */
export async function HomePreview({ option }: { option: HomeOption }) {
  const settings = planSettings();
  if (settings.mode !== 'hosted') notFound();
  const user = await getSessionUser();
  return (
    <Landing
      option={option}
      features={planFeatures(settings)}
      pricing={currentPricing()}
      viewer={user ? { name: user.name, email: user.email } : null}
    />
  );
}
