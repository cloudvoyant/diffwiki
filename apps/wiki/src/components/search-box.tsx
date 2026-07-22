import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { cn } from '../lib/utils';

interface SearchBoxProps {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Controlled search input: on Enter/submit navigates to `/search?q=…`.
 * Shared by the home hero and the sidebar header.
 */
export function SearchBox({ className, placeholder = 'Search…', autoFocus = false }: SearchBoxProps) {
  const [value, setValue] = useState('');
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    void navigate({ to: '/search', search: { q, c: undefined, engine: undefined, type: undefined } });
  };

  return (
    <form onSubmit={submit} action="/search" method="get" role="search">
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label="Search"
        className={cn(
          'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
          className,
        )}
      />
    </form>
  );
}
