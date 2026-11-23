import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND_COLORS, BRAND_NAME, LOCKUP } from '@/lib/brand-assets';
import { HOME_TITLE } from '@/lib/home-seo';

export const shareAlt = HOME_TITLE;
export const shareSize = { width: 1200, height: 630 };

const INK = '#0F172A';
const MUTED = '#5A6980';

/** The four claims under the promise, each in its own colour, as the home page shows them. */
const PILLS = [
  { label: 'PAdES seal', bg: '#E6EFFC', fg: '#1860D0' },
  { label: 'Audit trail', bg: '#DDF7F2', fg: '#0E7466' },
  { label: 'Aadhaar eSign', bg: '#FDEDE3', fg: '#B4471A' },
  { label: 'Open source', bg: '#F1E8FB', fg: '#7A35B5' },
];

/**
 * The card shown when the home page is shared, in the light style of the site: the logo, the
 * promise, four claims and the real app in a browser frame. Rendered once at build time.
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
            width: 640,
          }}
        >
          <img
            src={lockupUrl}
            alt={BRAND_NAME}
            width={Math.round((LOCKUP.width * 46) / LOCKUP.height)}
            height={46}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 54,
                fontWeight: 700,
                lineHeight: 1.04,
                letterSpacing: '-0.03em',
              }}
            >
              <span>Get documents signed.</span>
              <span style={{ color: BRAND_COLORS.blue }}>Keep the proof.</span>
            </div>
            <div style={{ fontSize: 25, color: MUTED, lineHeight: 1.4 }}>
              Signed on any phone, sealed with a certificate anyone can check. Aadhaar eSign built
              in.
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 18, fontWeight: 600 }}>
            {PILLS.map((pill) => (
              <div
                key={pill.label}
                style={{
                  padding: '7px 14px',
                  borderRadius: 999,
                  background: pill.bg,
                  color: pill.fg,
                }}
              >
                {pill.label}
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 700,
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
    shareSize,
  );
}
