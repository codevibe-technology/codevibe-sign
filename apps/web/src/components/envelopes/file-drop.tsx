'use client';

import { Upload } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A drop zone that is also a file button, for mouse, touch and keyboard alike. */
export function FileDrop({
  onFiles,
  multiple = false,
  title,
  hint,
  disabled,
  children,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  title: string;
  hint: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      data-testid="file-drop"
      className={cn(
        'flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
        over ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface',
        disabled && 'opacity-60',
      )}
    >
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-ink">
        <Upload aria-hidden className="h-6 w-6" />
      </span>
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted">{hint}</p>
      <label
        htmlFor={id}
        className={cn(
          'mt-4 inline-flex h-10 cursor-pointer items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-ink shadow-sm hover:bg-primary-hover focus-within:outline-2 focus-within:outline-primary',
          disabled && 'pointer-events-none',
        )}
      >
        Choose {multiple ? 'files' : 'a file'}
        <input
          ref={input}
          id={id}
          type="file"
          accept="application/pdf,.pdf"
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files);
            if (input.current) input.current.value = '';
          }}
        />
      </label>
      {children}
    </div>
  );
}
