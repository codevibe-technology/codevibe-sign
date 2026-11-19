import { describe, expect, it } from 'vitest';
import { encodeMultipart } from './multipart';

const pdf = new TextEncoder().encode('%PDF-1.7\n');

describe('encodeMultipart', () => {
  it('gives the same bytes for the same input', async () => {
    const make = () =>
      encodeMultipart({ name: 'envelope', json: '{"title":"A"}' }, [
        { name: 'documents', content: pdf },
      ]);
    const [a, b] = await Promise.all([make(), make()]);
    expect(a.contentType).toBe(b.contentType);
    expect(a.bytes).toEqual(b.bytes);
  });

  it('changes the boundary when the content changes', async () => {
    const a = await encodeMultipart({ name: 'envelope', json: '{"title":"A"}' }, []);
    const b = await encodeMultipart({ name: 'envelope', json: '{"title":"B"}' }, []);
    expect(a.contentType).not.toBe(b.contentType);
  });

  it('is read back by a standard form-data parser', async () => {
    const encoded = await encodeMultipart({ name: 'envelope', json: '{"title":"Zoë"}' }, [
      { name: 'documents', content: pdf },
      { name: 'documents', content: new Blob([pdf]) },
    ]);
    const form = await new Request('https://x.example', {
      method: 'POST',
      headers: { 'content-type': encoded.contentType },
      body: encoded.bytes,
    }).formData();
    expect(form.get('envelope')).toBe('{"title":"Zoë"}');
    const files = form.getAll('documents') as File[];
    expect(files).toHaveLength(2);
    expect(new Uint8Array(await files[1]!.arrayBuffer())).toEqual(pdf);
  });
});
