import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND_COLORS, MARK_SVG } from '@/lib/brand-assets';
import { HOME_TITLE } from '@/lib/home-seo';

const MARK = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString('base64')}`;

export const shareAlt = HOME_TITLE;
export const shareSize = { width: 1200, height: 630 };

/**
 * The card shown when the home page is shared: navy, the promise, the four steps and a frame of
 * the real app. Rendered once at build time.
 */
export async function shareImage() {
  const shot = await readFile(join(process.cwd(), 'src/app/share-shot.jpg'));
  const shotUrl = `data:image/jpeg;base64,${shot.toString('base64')}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: BRAND_COLORS.navy,
          color: '#ffffff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -180,
            top: -220,
            width: 640,
            height: 640,
            borderRadius: 640,
            background: '#12333F',
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '64px 0 64px 72px',
            width: 620,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <img src={MARK} width={56} height={56} />
            <div style={{ fontSize: 34, fontWeight: 700 }}>Codevibe Sign</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.05 }}>
              Send documents for signature in minutes
            </div>
            <div style={{ fontSize: 26, color: '#C9D5E3', lineHeight: 1.35 }}>
              Signed on any phone. Sealed PDF with a certificate. Open source.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 22, fontWeight: 600 }}>
            {['Send', 'Sign', 'Seal', 'Verify'].map((step, i) => (
              <div
                key={step}
                style={{
                  padding: '8px 22px',
                  borderRadius: 4,
                  background:
                    i === 0 ? BRAND_COLORS.blue : i === 3 ? BRAND_COLORS.teal : 'transparent',
                  color: i === 3 ? BRAND_COLORS.navy : i === 0 ? '#ffffff' : BRAND_COLORS.teal,
                  border: i === 1 || i === 2 ? `2px solid ${BRAND_COLORS.teal}` : 'none',
                }}
              >
                {step}
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 690,
            top: 120,
            display: 'flex',
            flexDirection: 'column',
            width: 640,
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 30px 60px rgba(0,0,0,0.45)',
            background: '#ffffff',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 7,
              padding: '10px 12px',
              background: '#EEF0F3',
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
