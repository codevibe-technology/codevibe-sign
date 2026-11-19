import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { defaultPenColors, type PenColor, type SignatureFont } from './render';
import type { UploadOptions } from './image';
import { useSignaturePad, type SignatureMode } from './useSignaturePad';

export interface SignaturePadLabels {
  modes: string;
  draw: string;
  type: string;
  upload: string;
  drawArea: string;
  drawHint: string;
  typeInput: string;
  typePlaceholder: string;
  font: string;
  color: string;
  undo: string;
  clear: string;
  chooseImage: string;
  uploadHint: string;
  uploading: string;
  current: string;
  uploadErrors: Record<string, string>;
}

export const defaultSignaturePadLabels: SignaturePadLabels = {
  modes: 'How to sign',
  draw: 'Draw',
  type: 'Type',
  upload: 'Upload',
  drawArea: 'Signature drawing area',
  drawHint: 'Sign with your finger, a pen or the mouse. To use the keyboard, choose Type.',
  typeInput: 'Your name',
  typePlaceholder: 'Type your name',
  font: 'Style',
  color: 'Ink colour',
  undo: 'Undo',
  clear: 'Clear',
  chooseImage: 'Choose an image',
  uploadHint: 'PNG, JPEG or WebP. The background is removed and the image is trimmed.',
  uploading: 'Preparing the image…',
  current: 'Current signature',
  uploadErrors: {
    not_image: 'Choose a PNG, JPEG or WebP image.',
    file_too_large: 'That file is too large. Choose an image under 5 MB.',
    too_large: 'That image is too detailed to use. Try a simpler or smaller picture.',
    unreadable: 'That image could not be opened. Try another file.',
    blank: 'No signature was found in that image.',
  },
};

export interface SignaturePadProps {
  /** Current signature as PNG base64 (no data URL prefix). */
  value?: string | null;
  /** Called with PNG base64 whenever the signature changes, or null when it is cleared. */
  onChange?: (png: string | null) => void;
  modes?: SignatureMode[];
  defaultMode?: SignatureMode;
  /** Width divided by height of the pad. Use about 3 for signatures and 1.5 for initials. */
  aspectRatio?: number;
  fonts?: SignatureFont[];
  colors?: PenColor[];
  /** Pre-fills the name in Type mode. */
  defaultText?: string;
  upload?: UploadOptions;
  labels?: Partial<SignaturePadLabels>;
  className?: string;
}

const MODE_ORDER: SignatureMode[] = ['draw', 'type', 'upload'];

export function SignaturePad({
  value,
  onChange,
  modes = MODE_ORDER,
  defaultMode,
  aspectRatio = 3,
  fonts,
  colors = defaultPenColors,
  defaultText,
  upload,
  labels: labelOverrides,
  className,
}: SignaturePadProps) {
  const labels = { ...defaultSignaturePadLabels, ...labelOverrides };
  const pad = useSignaturePad({
    value,
    onChange,
    defaultMode: defaultMode ?? modes[0] ?? 'draw',
    aspectRatio,
    fonts,
    colors: colors.map((c) => c.value),
    defaultText,
    upload,
  });
  const id = useId();
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const surfaceStyle = { aspectRatio: String(aspectRatio) } as CSSProperties;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const index = modes.indexOf(pad.mode);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (index + 1) % modes.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + modes.length) % modes.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = modes.length - 1;
    if (next === null) return;
    e.preventDefault();
    const mode = modes[next]!;
    pad.setMode(mode);
    tabs.current[mode]?.focus();
  };

  const colorPicker = (
    <div className="cvs-swatches" role="radiogroup" aria-label={labels.color}>
      {colors.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={pad.color === c.value}
          aria-label={c.label}
          title={c.label}
          className="cvs-swatch"
          style={{ '--cvs-swatch': c.value } as CSSProperties}
          onClick={() => pad.setColor(c.value)}
        />
      ))}
    </div>
  );

  const preview = pad.preview && (
    <img
      className="cvs-pad-preview"
      src={`data:image/png;base64,${pad.preview}`}
      alt={labels.current}
    />
  );

  return (
    <div className={['cvs-pad', className].filter(Boolean).join(' ')}>
      {modes.length > 1 && (
        <div className="cvs-tabs" role="tablist" aria-label={labels.modes}>
          {modes.map((mode) => (
            <button
              key={mode}
              ref={(el) => {
                tabs.current[mode] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${mode}`}
              aria-controls={`${id}-panel`}
              aria-selected={pad.mode === mode}
              tabIndex={pad.mode === mode ? 0 : -1}
              className="cvs-tab"
              onClick={() => pad.setMode(mode)}
              onKeyDown={onTabKey}
            >
              {labels[mode]}
            </button>
          ))}
        </div>
      )}

      <div
        className="cvs-pad-panel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${pad.mode}`}
      >
        {pad.mode === 'draw' && (
          <>
            <div className="cvs-pad-surface" style={surfaceStyle}>
              <canvas
                {...pad.canvasProps}
                className="cvs-pad-canvas"
                role="img"
                aria-label={labels.drawArea}
                aria-describedby={`${id}-hint`}
              />
              {preview}
              <span className="cvs-pad-baseline" aria-hidden="true" />
            </div>
            <p className="cvs-hint" id={`${id}-hint`}>
              {labels.drawHint}
            </p>
            <div className="cvs-pad-tools">
              {colorPicker}
              <span className="cvs-spacer" />
              <button
                type="button"
                className="cvs-button cvs-button--ghost"
                onClick={pad.undo}
                disabled={!pad.canUndo}
              >
                {labels.undo}
              </button>
              <button
                type="button"
                className="cvs-button cvs-button--ghost"
                onClick={pad.clear}
                disabled={pad.isEmpty && !pad.canUndo}
              >
                {labels.clear}
              </button>
            </div>
          </>
        )}

        {pad.mode === 'type' && (
          <>
            <label className="cvs-label" htmlFor={`${id}-text`}>
              {labels.typeInput}
            </label>
            <input
              id={`${id}-text`}
              className="cvs-input"
              type="text"
              autoComplete="name"
              placeholder={labels.typePlaceholder}
              value={pad.text}
              maxLength={80}
              onChange={(e) => pad.setText(e.target.value)}
            />
            <div className="cvs-fonts" role="radiogroup" aria-label={labels.font}>
              {pad.fonts.map((font, index) => (
                <button
                  key={font.label}
                  type="button"
                  role="radio"
                  aria-checked={pad.fontIndex === index}
                  aria-label={font.label}
                  className="cvs-font"
                  style={{ fontFamily: font.family, color: pad.color }}
                  onClick={() => pad.setFontIndex(index)}
                >
                  {pad.text.trim() || font.label}
                </button>
              ))}
            </div>
            {!pad.text.trim() && pad.preview && (
              <div className="cvs-pad-surface" style={surfaceStyle}>
                {preview}
              </div>
            )}
            <div className="cvs-pad-tools">
              {colorPicker}
              <span className="cvs-spacer" />
              <button
                type="button"
                className="cvs-button cvs-button--ghost"
                onClick={pad.clear}
                disabled={!pad.text && pad.isEmpty}
              >
                {labels.clear}
              </button>
            </div>
          </>
        )}

        {pad.mode === 'upload' && (
          <>
            <div className="cvs-pad-surface cvs-pad-surface--upload" style={surfaceStyle}>
              {pad.png ? (
                <img
                  className="cvs-pad-preview"
                  src={`data:image/png;base64,${pad.png}`}
                  alt={labels.current}
                />
              ) : (
                <button
                  type="button"
                  className="cvs-button"
                  onClick={() => fileInput.current?.click()}
                  disabled={pad.uploading}
                >
                  {pad.uploading ? labels.uploading : labels.chooseImage}
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              className="cvs-visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={labels.chooseImage}
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void pad.uploadFile(file);
              }}
            />
            <p className="cvs-hint">{labels.uploadHint}</p>
            {pad.uploadError && (
              <p className="cvs-error" role="alert">
                {labels.uploadErrors[String(pad.uploadError.details?.reason)] ??
                  pad.uploadError.message}
              </p>
            )}
            <div className="cvs-pad-tools">
              <span className="cvs-spacer" />
              {pad.png && (
                <button
                  type="button"
                  className="cvs-button cvs-button--ghost"
                  onClick={() => fileInput.current?.click()}
                >
                  {labels.chooseImage}
                </button>
              )}
              <button
                type="button"
                className="cvs-button cvs-button--ghost"
                onClick={pad.clear}
                disabled={pad.isEmpty}
              >
                {labels.clear}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
