'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

export interface SectionLink {
  label: string;
  /** A home page section, written `/#id` so it also works from the other public pages. */
  href: `/#${string}`;
}

const idOf = (link: SectionLink) => link.href.slice(2);

/**
 * The header's links to the home page sections. On the home page the one for the section in
 * view is marked as the current location; elsewhere they are plain links back to the home page.
 */
export function SectionLinks({
  links,
  className,
  samePage = false,
}: {
  links: SectionLink[];
  className?: string;
  /** Link to the sections on this page rather than on the home page. */
  samePage?: boolean;
}) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sections = links
      .map((link) => document.getElementById(idOf(link)))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const visible = new Set<string>();
    // A section counts once it crosses a line a third of the way down the screen.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = sections.find((section) => visible.has(section.id));
        setCurrent(first?.id ?? null);
      },
      { rootMargin: '-33% 0px -66% 0px' },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [links]);

  return (
    <>
      {links.map((link) => {
        const here = current === idOf(link);
        return (
          <a
            key={link.href}
            href={samePage ? link.href.slice(1) : link.href}
            aria-current={here ? 'location' : undefined}
            className={cn(
              'relative rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-2 hover:text-ink',
              here ? 'text-ink' : 'text-muted',
              className,
            )}
          >
            {link.label}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-3 -bottom-[13px] h-0.5 origin-left bg-primary transition-transform duration-300',
                here ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </a>
        );
      })}
    </>
  );
}
