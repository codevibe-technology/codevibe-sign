declare module 'virtual:font-assets' {
  /** HarfBuzz compiled to WebAssembly, brotli-compressed and base64-encoded. */
  export const harfbuzz: string;
  /** The HarfBuzz font subsetter, packed the same way. */
  export const harfbuzzSubset: string;
  /** The fallback fonts by file name (`NotoSansDevanagari-Regular`), packed the same way. */
  export const fonts: Record<string, string>;
}
