import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND_COLORS, BRAND_NAME, LOCKUP } from '@/lib/brand-assets';
import { HOME_TITLE } from '@/lib/home-seo';

export const shareAlt = HOME_TITLE;
export const shareSize = { width: 1200, height: 630 };

const INK = '#0F172A';
const MUTED = '#5A6980';

/** The four claims above the promise, each after its own dot, as the home page hero shows them. */
const CLAIMS = [
  { label: 'PDF e-signatures', dot: '#1B6AE0' },
  { label: 'Aadhaar eSign', dot: '#E07A1F' },
  { label: 'API and webhooks', dot: '#8A3FC2' },
  { label: 'Self-host', dot: '#12A08A' },
];

/** The brand faces as files next/og can read: Inter for the text, Space Grotesk Bold for the promise. */
async function fonts() {
  const dir = join(process.cwd(), 'assets/fonts');
  const [display, text] = await Promise.all([
    readFile(join(dir, 'SpaceGrotesk-Bold.ttf')),
    readFile(join(dir, 'Inter-Regular.ttf')),
  ]);
  return [
    { name: 'Inter', data: text, weight: 400 as const, style: 'normal' as const },
    { name: 'Space Grotesk', data: display, weight: 700 as const, style: 'normal' as const },
  ];
}

/**
 * The card shown when the home page is shared, in the light style of the site: the logo, the
 * hero's four claims, the promise and the real dashboard in a browser frame. Rendered once at
 * build time.
 */
export async function shareImage() {
  const shot = await readFile(join(process.cwd(), 'src/app/share-shot.jpg'));
  const shotUrl = `data:image/jpeg;base64,${shot.toString('base64')}`;
  const lockup = await readFile(join(process.cwd(), 'public', LOCKUP.light));
  const lockupUrl = `data:image/svg+xml;base64,${lockup.toString('base64')}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          color: INK,
          backgroundColor: '#F7FAFF',
          backgroundImage:
            'radial-gradient(circle at 0% 0%, #DCE9FF 0%, rgba(220,233,255,0) 55%), radial-gradient(circle at 100% 100%, #D5F6F0 0%, rgba(213,246,240,0) 55%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '60px 0 60px 64px',
            width: 660,
          }}
        >
          <img
            src={lockupUrl}
            alt={BRAND_NAME}
            width={Math.round((LOCKUP.width * 46) / LOCKUP.height)}
            height={46}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ display: 'flex', gap: 16, fontSize: 17 }}>
              {CLAIMS.map((claim) => (
                <div key={claim.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 9, height: 9, borderRadius: 9, background: claim.dot }} />
                  {claim.label}
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Space Grotesk',
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1.06,
                letterSpacing: '-0.035em',
              }}
            >
              <span>Get documents signed.</span>
              <span style={{ color: BRAND_COLORS.blue }}>Keep the proof.</span>
            </div>
            <div style={{ fontSize: 21, color: MUTED, lineHeight: 1.45 }}>
              Send a PDF, people sign on any phone, and you get back a sealed PDF with a certificate
              anyone can check.
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              padding: '10px 20px',
              borderRadius: 999,
              background: BRAND_COLORS.navy,
              color: '#E2E8F0',
              fontSize: 18,
            }}
          >
            <span style={{ color: '#7CF0DF', marginRight: 10 }}>$</span>npm i codevibe-sign
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 728,
            top: 140,
            display: 'flex',
            flexDirection: 'column',
            width: 640,
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid #D6E2F5',
            boxShadow: '0 30px 60px rgba(27,106,224,0.28)',
            background: '#ffffff',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 7,
              padding: '11px 14px',
              background: '#F7F9FC',
              borderBottom: '1px solid #E3E6EB',
            }}
          >
            {['#F26B5B', '#F5BE4F', '#4CC38A'].map((c) => (
              <div key={c} style={{ width: 11, height: 11, borderRadius: 11, background: c }} />
            ))}
          </div>
          <img src={shotUrl} width={640} height={400} />
        </div>
      </div>
    ),
    { ...shareSize, fonts: await fonts() },
  );
}
