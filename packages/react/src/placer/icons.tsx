import type { FieldType } from '@codevibe_technology/sign-core';

const PATHS = {
  signature:
    'M3 17c3-5 5.2-7.5 6.6-7.5 2.1 0 .3 6.6 2.4 6.6 1.6 0 3-3 4.6-3 1.2 0 1.2 1.9 2.6 1.9M3 21h18',
  initials: 'M5 18V6l5 12V6M14 6h5M16.5 6v12M14 18h5',
  date_signed: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3',
  name: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.4-4 4.4-6 8-6s6.6 2 8 6',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  checkbox: 'M4 4h16v16H4zM8 12l3 3 5-6',
  email: 'M3 6h18v12H3zM3 7l9 6 9-6',
  company: 'M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20',
  title: 'M4 7h16v13H4zM9 7V4h6v3M4 12h16',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  paste: 'M9 4h6v3H9zM15 5h3v16H6V5h3M9 12h6M9 16h4',
  duplicate: 'M8 8h12v12H8zM16 8V4H4v12h4M14 11v6M11 14h6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  warning: 'M12 4 2 20h20L12 4zM12 10v4M12 17h.01',
  check: 'm5 12 5 5 9-10',
  cursor: 'M5 3l14 8-6 2-2 6L5 3z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  alignLeft: 'M4 3v18M8 7h12v4H8zM8 14h7v4H8z',
  alignTop: 'M3 4h18M7 8v12h4V8zM14 8v7h4V8z',
  sameSize: 'M4 8h16M4 16h16M8 4v16M16 4v16',
  close: 'M6 6l12 12M18 6 6 18',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={['cvs-icon', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'grip' ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The icon for a field: its preset when it has one (Email, Company, Title), else its type. */
export function fieldIcon(type: FieldType, preset?: string): IconName {
  if (preset === 'email' || preset === 'company' || preset === 'title') return preset;
  return type;
}
