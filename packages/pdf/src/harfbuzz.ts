import { brotliDecompressSync } from 'node:zlib';
import { harfbuzz as packedWasm, harfbuzzSubset as packedSubsetWasm } from 'virtual:font-assets';

/** One shaped glyph, in font units, in visual order (left to right). */
export interface ShapedGlyph {
  /** Glyph id in the font. 0 is the font's "missing glyph" box. */
  id: number;
  /** UTF-16 index of the first character this glyph belongs to. */
  cluster: number;
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

export type Direction = 'ltr' | 'rtl';

interface Exports {
  memory: WebAssembly.Memory;
  __wasm_call_ctors(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_get_upem(face: number): number;
  hb_font_create(face: number): number;
  hb_buffer_create(): number;
  hb_buffer_destroy(buffer: number): void;
  hb_buffer_add_utf16(
    buffer: number,
    text: number,
    length: number,
    offset: number,
    items: number,
  ): void;
  hb_buffer_set_direction(buffer: number, direction: number): void;
  hb_buffer_guess_segment_properties(buffer: number): void;
  hb_buffer_get_length(buffer: number): number;
  hb_buffer_get_glyph_infos(buffer: number, length: number): number;
  hb_buffer_get_glyph_positions(buffer: number, length: number): number;
  hb_shape(font: number, buffer: number, features: number, count: number): void;
}

const MEMORY_MODE_READONLY = 1;
const DIRECTION = { ltr: 4, rtl: 5 } as const;
const GLYPH_INFO_BYTES = 20;
const GLYPH_POSITION_BYTES = 20;
const PAGE = 65536;

let instance: Exports | undefined;

function grow(memory: WebAssembly.Memory | undefined, requested: number): number {
  if (!memory) return 0;
  const missing = (requested >>> 0) - memory.buffer.byteLength;
  try {
    memory.grow(Math.ceil(Math.max(0, missing) / PAGE));
    return 1;
  } catch {
    return 0;
  }
}

/** HarfBuzz is built with Emscripten; these are the few host calls it makes. */
function instantiate(): Exports {
  const module = new WebAssembly.Module(brotliDecompressSync(Buffer.from(packedWasm, 'base64')));
  const holder: { exports?: Exports } = {};
  const imports = {
    env: {
      _abort_js: () => {
        throw new Error('HarfBuzz aborted.');
      },
      _emscripten_runtime_keepalive_clear: () => undefined,
      _setitimer_js: () => 0,
      emscripten_resize_heap: (requested: number) => grow(holder.exports?.memory, requested),
    },
    wasi_snapshot_preview1: {
      proc_exit: (code: number) => {
        throw new Error(`HarfBuzz exited with ${code}.`);
      },
    },
  };
  const exports = new WebAssembly.Instance(module, imports).exports as unknown as Exports;
  holder.exports = exports;
  exports.__wasm_call_ctors();
  return exports;
}

function hb(): Exports {
  instance ??= instantiate();
  return instance;
}

/** A font loaded into HarfBuzz. Kept for the life of the process. */
export class HbFont {
  private readonly pointer: number;
  readonly unitsPerEm: number;

  constructor(bytes: Uint8Array) {
    const exports = hb();
    const data = exports.malloc(bytes.byteLength);
    new Uint8Array(exports.memory.buffer, data, bytes.byteLength).set(bytes);
    const blob = exports.hb_blob_create(data, bytes.byteLength, MEMORY_MODE_READONLY, 0, 0);
    const face = exports.hb_face_create(blob, 0);
    this.unitsPerEm = exports.hb_face_get_upem(face);
    this.pointer = exports.hb_font_create(face);
  }

  /**
   * Shapes one run of text: picks the glyphs (conjuncts, vowel signs, joining forms) and
   * places them, including the offsets of marks above and below the base letter.
   */
  shape(text: string, direction: Direction): ShapedGlyph[] {
    const exports = hb();
    const buffer = exports.hb_buffer_create();
    const units = exports.malloc(Math.max(1, text.length) * 2);
    try {
      const view = new Uint16Array(exports.memory.buffer, units, text.length);
      for (let index = 0; index < text.length; index += 1) {
        view[index] = text.charCodeAt(index);
      }
      exports.hb_buffer_add_utf16(buffer, units, text.length, 0, text.length);
      exports.hb_buffer_set_direction(buffer, DIRECTION[direction]);
      exports.hb_buffer_guess_segment_properties(buffer);
      exports.hb_shape(this.pointer, buffer, 0, 0);
      const length = exports.hb_buffer_get_length(buffer);
      const infos = exports.hb_buffer_get_glyph_infos(buffer, 0);
      const positions = exports.hb_buffer_get_glyph_positions(buffer, 0);
      const heap = new DataView(exports.memory.buffer);
      const glyphs: ShapedGlyph[] = [];
      for (let index = 0; index < length; index += 1) {
        const info = infos + index * GLYPH_INFO_BYTES;
        const position = positions + index * GLYPH_POSITION_BYTES;
        glyphs.push({
          id: heap.getUint32(info, true),
          cluster: heap.getUint32(info + 8, true),
          xAdvance: heap.getInt32(position, true),
          xOffset: heap.getInt32(position + 8, true),
          yOffset: heap.getInt32(position + 12, true),
        });
      }
      return glyphs;
    } finally {
      exports.free(units);
      exports.hb_buffer_destroy(buffer);
    }
  }
}

interface SubsetExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_length(blob: number): number;
  hb_blob_get_data(blob: number, length: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_set_clear(set: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_glyph_set(input: number): number;
  hb_subset_input_set(input: number, which: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const SUBSET_FLAGS_NO_HINTING = 0x1;
const SUBSET_FLAGS_RETAIN_GIDS = 0x2;
const SUBSET_SETS_DROP_TABLE_TAG = 3;
const SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
/** Text is shaped before it is written, so the file needs outlines and metrics only. */
const DROPPED_TABLES = [
  'GSUB',
  'GPOS',
  'GDEF',
  'BASE',
  'JSTF',
  'MATH',
  'kern',
  'morx',
  'name',
  'post',
];

let subsetInstance: SubsetExports | undefined;

function subsetter(): SubsetExports {
  if (!subsetInstance) {
    const module = new WebAssembly.Module(
      brotliDecompressSync(Buffer.from(packedSubsetWasm, 'base64')),
    );
    subsetInstance = new WebAssembly.Instance(module, {}).exports as unknown as SubsetExports;
    subsetInstance._initialize();
  }
  return subsetInstance;
}

const tag = (name: string) =>
  ((name.charCodeAt(0) << 24) |
    (name.charCodeAt(1) << 16) |
    (name.charCodeAt(2) << 8) |
    name.charCodeAt(3)) >>>
  0;

/**
 * A copy of a TrueType font that holds only the given glyphs, under their original ids. Glyphs
 * that a composite glyph is built from come along with it.
 */
export function subsetFont(bytes: Uint8Array, glyphs: Iterable<number>): Uint8Array {
  const exports = subsetter();
  const data = exports.malloc(bytes.byteLength);
  new Uint8Array(exports.memory.buffer, data, bytes.byteLength).set(bytes);
  const blob = exports.hb_blob_create(data, bytes.byteLength, MEMORY_MODE_READONLY, 0, 0);
  const face = exports.hb_face_create(blob, 0);
  const input = exports.hb_subset_input_create_or_fail();
  let result = 0;
  let resultBlob = 0;
  try {
    if (!input) {
      throw new Error('The font subsetter ran out of memory.');
    }
    const glyphSet = exports.hb_subset_input_glyph_set(input);
    for (const glyph of glyphs) {
      exports.hb_set_add(glyphSet, glyph);
    }
    exports.hb_set_clear(exports.hb_subset_input_set(input, SUBSET_SETS_LAYOUT_FEATURE_TAG));
    const dropped = exports.hb_subset_input_set(input, SUBSET_SETS_DROP_TABLE_TAG);
    for (const name of DROPPED_TABLES) {
      exports.hb_set_add(dropped, tag(name));
    }
    exports.hb_subset_input_set_flags(input, SUBSET_FLAGS_RETAIN_GIDS | SUBSET_FLAGS_NO_HINTING);
    result = exports.hb_subset_or_fail(face, input);
    if (!result) {
      throw new Error('The font could not be subset.');
    }
    resultBlob = exports.hb_face_reference_blob(result);
    const length = exports.hb_blob_get_length(resultBlob);
    const pointer = exports.hb_blob_get_data(resultBlob, 0);
    return new Uint8Array(exports.memory.buffer, pointer, length).slice();
  } finally {
    if (resultBlob) exports.hb_blob_destroy(resultBlob);
    if (result) exports.hb_face_destroy(result);
    if (input) exports.hb_subset_input_destroy(input);
    exports.hb_face_destroy(face);
    exports.hb_blob_destroy(blob);
    exports.free(data);
  }
}
