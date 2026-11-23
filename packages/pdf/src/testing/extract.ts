import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * The text of every page as a PDF reader extracts it (pdf.js, as used by Firefox and the web
 * app), one entry per text item, with zero-width spaces removed.
 */
export async function extractText(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const items: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent();
    for (const item of content.items) {
      if ('str' in item && item.str.trim() !== '') {
        items.push(item.str.replaceAll('​', '').normalize('NFC'));
      }
    }
  }
  await pdf.destroy();
  return items;
}

/** Names in every script the bundled fonts cover, plus accented Latin and Devanagari conjuncts. */
export const SAMPLE_NAMES = [
  'आशा राव',
  'தமிழ்செல்வி',
  'ಕಾವ್ಯ',
  'മീര',
  'রাহুল',
  'ગીતા',
  'ਹਰਪ੍ਰੀਤ',
  'ଅନିତା',
  'علی',
  'Zoë Ñúñez',
  'Łukasz Żółć',
  'क्ष त्र श्री',
];
