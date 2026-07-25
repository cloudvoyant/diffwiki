import { useEffect, useState, type CSSProperties } from 'react';
import { Settings2, Sun, Moon, Monitor, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  applyColorMode,
  getInitialColorMode,
  resolveColorMode,
  applyTheme,
  getInitialTheme,
  type ColorMode,
} from '@/lib/theme';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';

const MODES: { value: ColorMode; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/**
 * Light/Dark/System segmented button group. Owns the color-mode state and drives
 * it through applyColorMode; reports the resolved dark/light back up so the theme
 * previews can mirror it.
 */
function ColorModeToggle({ onResolvedDarkChange }: { onResolvedDarkChange: (isDark: boolean) => void }) {
  const [mode, setMode] = useState<ColorMode>(() => getInitialColorMode());

  function selectMode(m: ColorMode) {
    applyColorMode(m);
    setMode(m);
  }

  // Re-resolve on mode change, and (in system mode) live-follow the OS scheme so
  // previews stay honest if the OS flips while the dialog is open.
  useEffect(() => {
    onResolvedDarkChange(resolveColorMode(mode) === 'dark');
    if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => onResolvedDarkChange(resolveColorMode('system') === 'dark');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [mode, onResolvedDarkChange]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">Color mode</div>
      <div role="group" className="flex w-full items-stretch">
        {MODES.map((m, i) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => selectMode(m.value)}
              aria-pressed={active}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 border bg-card px-3 py-2 text-xs transition-colors',
                i === 0 && 'rounded-l-md',
                i === MODES.length - 1 && 'rounded-r-md',
                i > 0 && '-ml-px',
                active
                  ? 'z-10 border-foreground text-foreground'
                  : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              {active && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-green-500" />}
              <m.Icon className="size-3.5" aria-hidden />
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A single theme swatch: applies its own `theme-{name}` class (plus `dark` when
 * the effective mode is dark) so its mini preview renders in that theme's actual
 * colors, and applies the theme on click.
 */
function ThemeSwatch({
  theme,
  active,
  isDark,
  onSelect,
}: {
  theme: (typeof THEMES)[number];
  active: boolean;
  isDark: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      type="button"
      title={theme.label}
      onClick={() => onSelect(theme.name)}
      aria-pressed={active}
      className={cn(
        // The theme class themes the whole button, so bg + text below
        // resolve to this theme's colors (correct contrast in the preview).
        `theme-${theme.name}`,
        isDark && 'dark',
        'relative flex flex-col gap-1.5 overflow-hidden rounded-md border bg-background p-1.5 text-left text-foreground transition-colors',
        active ? 'border-foreground' : 'border-border hover:border-muted-foreground',
      )}
    >
      {active && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-green-500" />}
      {/* Mini preview rendered in the theme's own colors. */}
      <div className="flex h-9 flex-col justify-center gap-1 rounded-sm bg-foreground/10 p-1.5">
        <div className="h-1.5 w-4/5 rounded-full bg-primary" />
        <div className="h-1.5 w-3/5 rounded-full bg-foreground/40" />
      </div>
      {/* Label in the theme's own sans font (49/52 themes define one;
          the rest fall back to the neutral --font-sans on the grid). */}
      <span className="truncate text-[11px] font-medium" style={{ fontFamily: 'var(--font-sans)' }}>
        {theme.label}
      </span>
    </button>
  );
}

/**
 * Scrollable grid of live-preview theme swatches. Owns the selected-theme state
 * and drives it through applyTheme; each swatch mirrors the current dark/light.
 */
function ThemeGrid({ isDark }: { isDark: boolean }) {
  const [theme, setTheme] = useState<string>(() => getInitialTheme());

  function selectTheme(name: string) {
    applyTheme(name);
    setTheme(name);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">Theme</div>
      <div className="max-h-64 overflow-y-auto rounded-md border p-2">
        {/* Neutral --font-sans so swatches whose theme doesn't define one fall back
            here (not to the active theme's font), preventing font bleed. Each
            theme's own class overrides this for its swatch. */}
        <div
          className="grid grid-cols-2 gap-2"
          style={
            {
              ['--font-sans']: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            } as CSSProperties
          }
        >
          {THEMES.map((t) => (
            <ThemeSwatch key={t.name} theme={t} active={theme === t.name} isDark={isDark} onSelect={selectTheme} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * SettingsDialog — a gear button that opens a centered modal with appearance
 * controls: a Light/Dark/System segmented toggle, and a scrollable grid of theme
 * swatches. Each swatch applies its own `theme-{name}` class, so its mini preview
 * renders in that theme's actual colors (bg/primary/text resolve to its vars).
 */
export function SettingsDialog() {
  // Swatches mirror the current effective light/dark so previews match the page.
  const [isDark, setIsDark] = useState(() => resolveColorMode(getInitialColorMode()) === 'dark');

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Open settings">
          <Settings2 className="h-[18px] w-[18px]" aria-hidden />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4" aria-hidden />
            Settings
          </DialogTitle>
        </DialogHeader>

        <ColorModeToggle onResolvedDarkChange={setIsDark} />
        <ThemeGrid isDark={isDark} />
      </DialogContent>
    </Dialog>
  );
}
