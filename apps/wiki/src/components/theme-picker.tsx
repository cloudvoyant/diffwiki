import { useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { applyTheme, getInitialTheme, type ThemeName } from '@/lib/theme';
import { THEMES } from '@/lib/themes';

// THEMES is the generated manifest of all 52 diffbook themes (see the "Port all
// diffbook themes" task). The dropdown below is height-capped + scrollable.

/**
 * ThemePicker — palette icon that opens a dropdown listing available themes.
 * Applies the selected theme via applyTheme() and persists to localStorage.
 * Initialises from localStorage so the active indicator survives page reload.
 */
export function ThemePicker() {
  const [active, setActive] = useState<ThemeName>(() => getInitialTheme());

  function handleSelect(name: ThemeName) {
    applyTheme(name);
    setActive(name);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Pick color theme">
          <Palette className="h-[18px] w-[18px]" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="max-h-80 min-w-36 overflow-y-auto">
        {THEMES.map(({ name, label }) => (
          <DropdownMenuItem
            key={name}
            className="flex cursor-pointer items-center justify-between gap-3"
            onSelect={() => handleSelect(name)}
          >
            <span>{label}</span>
            {name === active && <Check className="h-4 w-4 shrink-0" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
