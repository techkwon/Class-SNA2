"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-secondary"
      aria-label="테마 전환"
      title="테마 전환"
    >
      <Sun className="hidden h-4 w-4 text-primary dark:block" />
      <Moon className="h-4 w-4 text-accent dark:hidden" />
    </button>
  );
}
