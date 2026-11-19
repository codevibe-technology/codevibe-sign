import { useId, type ComponentProps, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const control =
  'block w-full rounded-lg border bg-surface px-3 text-ink placeholder:text-muted/70 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        control,
        'h-10',
        props['aria-invalid'] ? 'border-danger' : 'border-line-strong',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        control,
        'min-h-24 py-2',
        props['aria-invalid'] ? 'border-danger' : 'border-line-strong',
        className,
      )}
      {...props}
    />
  );
}

export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        control,
        'h-10 pr-8',
        props['aria-invalid'] ? 'border-danger' : 'border-line-strong',
        className,
      )}
      {...props}
    />
  );
}

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: true;
  }) => ReactNode;
}

/** A label, the control, and a hint or error the control is described by. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {children({
        id,
        ...(note ? { 'aria-describedby': noteId } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {note ? (
        <p
          id={noteId}
          className={cn('text-sm', error ? 'text-danger' : 'text-muted')}
          role={error ? 'alert' : undefined}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
