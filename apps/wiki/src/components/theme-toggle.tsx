import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toggleColorMode } from '@/lib/theme';

/**
 * ThemeToggle — sun/moon icon button.
 * Sun icon is visible in dark mode (click to go light).
 * Moon icon is visible in light mode (click to go dark).
 *
 * Uses CSS visibility (dark: Tailwind variant) rather than React state so the
 * correct icon is shown even before hydration (no flash on SSR).
 */
export function ThemeToggle() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      aria-label="Toggle light/dark mode"
      onClick={() => toggleColorMode()}
    >
      {/* Sun — shown only in dark mode */}
      <Sun className="hidden h-[18px] w-[18px] dark:block" aria-hidden />
      {/* Moon — shown only in light mode */}
      <Moon className="block h-[18px] w-[18px] dark:hidden" aria-hidden />
    </Button>
  );
}
