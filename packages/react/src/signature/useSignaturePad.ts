import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { SignError } from '@codevibe/sign-core';
import { drawStrokes, addPoint, type Stroke, type StrokePoint } from './strokes';
import { imageFileToSignature, type UploadOptions } from './image';
import {
  defaultPenColors,
  defaultSignatureFonts,
  renderDrawnSignature,
  renderTypedSignature,
  type SignatureFont,
} from './render';

export type SignatureMode = 'draw' | 'type' | 'upload';

export interface UseSignaturePadOptions {
  /** The current signature as PNG base64. When it changes from outside, it is shown as a preview. */
  value?: string | null;
  onChange?: (png: string | null) => void;
  defaultMode?: SignatureMode;
  /** Width divided by height of the drawing area and of the composed image. */
  aspectRatio?: number;
  fonts?: SignatureFont[];
  colors?: string[];
  /** Pre-fills the typed name. */
  defaultText?: string;
  upload?: UploadOptions;
  /** Delay before a typed name is rendered, in milliseconds. */
  typeDelay?: number;
}

export interface SignaturePadState {
  mode: SignatureMode;
  setMode: (mode: SignatureMode) => void;
  color: string;
  setColor: (color: string) => void;
  colors: string[];
  fonts: SignatureFont[];
  fontIndex: number;
  setFontIndex: (index: number) => void;
  text: string;
  setText: (text: string) => void;
  strokes: Stroke[];
  canUndo: boolean;
  undo: () => void;
  clear: () => void;
  uploadFile: (file: Blob) => Promise<void>;
  uploading: boolean;
  uploadError: SignError | null;
  /** The current signature as PNG base64, as last reported through onChange. */
  png: string | null;
  /** A signature given through `value` that has not been replaced yet. */
  preview: string | null;
  isEmpty: boolean;
  aspectRatio: number;
  /** Spread onto the drawing canvas. */
  canvasProps: {
    ref: (el: HTMLCanvasElement | null) => void;
    onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
    style: { touchAction: 'none' };
  };
}

function pointFrom(e: ReactPointerEvent<HTMLCanvasElement>): StrokePoint {
  const box = e.currentTarget.getBoundingClientRect();
  const pressure = e.pointerType === 'mouse' || !e.pressure ? 0.5 : e.pressure;
  return {
    x: box.width ? (e.clientX - box.left) / box.width : 0,
    y: box.height ? (e.clientY - box.top) / box.height : 0,
    pressure,
  };
}

/** Headless state for a draw / type / upload signature pad. */
export function useSignaturePad(options: UseSignaturePadOptions = {}): SignaturePadState {
  const {
    value,
    onChange,
    defaultMode = 'draw',
    aspectRatio = 3,
    fonts = defaultSignatureFonts,
    colors = defaultPenColors.map((c) => c.value),
    defaultText = '',
    upload,
    typeDelay = 250,
  } = options;

  const [mode, setModeState] = useState<SignatureMode>(defaultMode);
  const [color, setColor] = useState(colors[0] ?? '#111111');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [text, setText] = useState(defaultText);
  const [fontIndex, setFontIndex] = useState(0);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<SignError | null>(null);
  const [png, setPng] = useState<string | null>(value ?? null);
  const [preview, setPreview] = useState<string | null>(value ?? null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmitted = useRef<string | null>(value ?? null);
  const emit = useCallback((next: string | null) => {
    setPng(next);
    setPreview(null);
    if (next === lastEmitted.current) return;
    lastEmitted.current = next;
    onChangeRef.current?.(next);
  }, []);

  // A value set from outside replaces the preview without echoing back through onChange.
  useEffect(() => {
    if (value === undefined || value === lastEmitted.current) return;
    lastEmitted.current = value;
    setPng(value);
    setPreview(value);
    if (value === null) {
      setStrokes([]);
      setUploaded(null);
    }
  }, [value]);

  const canvas = useRef<HTMLCanvasElement | null>(null);
  const active = useRef<{ id: number; stroke: Stroke } | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const redraw = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(el.clientWidth * dpr);
    const h = Math.round(el.clientHeight * dpr);
    if (w > 0 && h > 0 && (el.width !== w || el.height !== h)) {
      el.width = w;
      el.height = h;
    }
    ctx.clearRect(0, 0, el.width, el.height);
    const all = active.current
      ? [...strokesRef.current, active.current.stroke]
      : strokesRef.current;
    drawStrokes(ctx, all, el.width, el.height);
  }, []);

  useEffect(redraw, [strokes, mode, redraw]);

  const resizeObserver = useRef<ResizeObserver | null>(null);
  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      resizeObserver.current?.disconnect();
      resizeObserver.current = null;
      canvas.current = el;
      if (!el) return;
      redraw();
      if (typeof ResizeObserver === 'undefined') return;
      resizeObserver.current = new ResizeObserver(redraw);
      resizeObserver.current.observe(el);
    },
    [redraw],
  );

  const commitDrawing = useCallback(
    (next: Stroke[]) => {
      setStrokes(next);
      emit(renderDrawnSignature(next, aspectRatio));
    },
    [aspectRatio, emit],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (active.current) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      active.current = { id: e.pointerId, stroke: { color, points: [pointFrom(e)] } };
      setPreview(null);
      redraw();
    },
    [color, redraw],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const current = active.current;
      if (!current || current.id !== e.pointerId) return;
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      let added = false;
      if (events.length > 1) {
        const box = e.currentTarget.getBoundingClientRect();
        for (const ev of events) {
          added =
            addPoint(current.stroke, {
              x: (ev.clientX - box.left) / box.width,
              y: (ev.clientY - box.top) / box.height,
              pressure: ev.pointerType === 'mouse' || !ev.pressure ? 0.5 : ev.pressure,
            }) || added;
        }
      } else {
        added = addPoint(current.stroke, pointFrom(e));
      }
      if (added) redraw();
    },
    [redraw],
  );

  const endStroke = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const current = active.current;
      if (!current || current.id !== e.pointerId) return;
      active.current = null;
      commitDrawing([...strokesRef.current, current.stroke]);
    },
    [commitDrawing],
  );

  const font = fonts[fontIndex] ?? fonts[0] ?? defaultSignatureFonts[0]!;
  const typedDirty = useRef(false);

  useEffect(() => {
    if (mode !== 'type' || !typedDirty.current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderTypedSignature(text, font, color, aspectRatio).then((next) => {
        if (!cancelled) emit(next);
      });
    }, typeDelay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, text, font, color, aspectRatio, typeDelay, emit]);

  const setTypedText = useCallback((next: string) => {
    typedDirty.current = true;
    setText(next);
  }, []);

  const setMode = useCallback(
    (next: SignatureMode) => {
      setModeState(next);
      if (next === 'type') {
        if (text.trim() || !preview) typedDirty.current = true;
        return;
      }
      const content =
        next === 'draw' ? renderDrawnSignature(strokesRef.current, aspectRatio) : uploaded;
      // Switching to an empty tab keeps a signature that came from outside.
      if (content !== null || !preview) emit(content);
    },
    [aspectRatio, emit, uploaded, text, preview],
  );

  const undo = useCallback(() => {
    commitDrawing(strokesRef.current.slice(0, -1));
  }, [commitDrawing]);

  const clear = useCallback(() => {
    if (mode === 'draw') {
      active.current = null;
      commitDrawing([]);
    } else if (mode === 'type') {
      typedDirty.current = true;
      setText('');
      emit(null);
    } else {
      setUploaded(null);
      setUploadError(null);
      emit(null);
    }
  }, [mode, commitDrawing, emit]);

  const uploadFile = useCallback(
    async (file: Blob) => {
      setUploading(true);
      setUploadError(null);
      try {
        const next = await imageFileToSignature(file, upload);
        setUploaded(next);
        emit(next);
      } catch (error) {
        setUploadError(
          error instanceof SignError
            ? error
            : new SignError('VALIDATION', 'The image could not be read.', { reason: 'unreadable' }),
        );
      } finally {
        setUploading(false);
      }
    },
    [upload, emit],
  );

  return {
    mode,
    setMode,
    color,
    setColor,
    colors,
    fonts,
    fontIndex,
    setFontIndex: (index: number) => {
      typedDirty.current = true;
      setFontIndex(index);
    },
    text,
    setText: setTypedText,
    strokes,
    canUndo: strokes.length > 0,
    undo,
    clear,
    uploadFile,
    uploading,
    uploadError,
    png,
    preview,
    isEmpty: png === null,
    aspectRatio,
    canvasProps: {
      ref: canvasRef,
      onPointerDown,
      onPointerMove,
      onPointerUp: endStroke,
      onPointerCancel: endStroke,
      style: { touchAction: 'none' },
    },
  };
}
