import Link from 'next/link';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="app-card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-2xl"
      >
        🌱
      </span>
      <h2 className="text-lg font-bold text-text">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {action ? (
        <Link href={action.href} className="btn-primary mt-2">
          {action.label}
        </Link>
      ) : null}
      {children}
    </div>
  );
}
