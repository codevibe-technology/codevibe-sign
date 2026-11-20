import { ImageResponse } from 'next/og';

export const alt = 'Codevibe Sign: send documents for signature in minutes';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The card shown when the home page is shared: navy, teal, the headline and the promise. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#0D1B2A',
          color: '#ffffff',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -160,
            top: -200,
            width: 620,
            height: 620,
            borderRadius: 620,
            background: '#12333F',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 10,
              background: '#1B6AE0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="40" height="40" viewBox="380 380 1172 1172" fill="none">
              <g stroke="#ffffff" strokeWidth="108" strokeLinecap="butt" strokeLinejoin="miter">
                <path d="M890 577V1508M424 1043H1356M561 713L1219 1371M561 1371L890 1043" />
                <path d="M988 478H1454V943" />
              </g>
            </svg>
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>Codevibe Sign</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, maxWidth: 900 }}>
            Send documents for signature in minutes
          </div>
          <div style={{ fontSize: 32, color: '#C9D5E3' }}>
            Sealed PDFs, a signing certificate and an audit trail. Open source.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 26, fontWeight: 600 }}>
          <div style={{ padding: '10px 28px', borderRadius: 4, background: '#1B6AE0' }}>Send</div>
          <div
            style={{
              padding: '10px 28px',
              borderRadius: 4,
              border: '2px solid #2DD4BF',
              color: '#2DD4BF',
            }}
          >
            Sign
          </div>
          <div
            style={{
              padding: '10px 28px',
              borderRadius: 4,
              background: '#2DD4BF',
              color: '#0D1B2A',
            }}
          >
            Verify
          </div>
        </div>
      </div>
    ),
    size,
  );
}
