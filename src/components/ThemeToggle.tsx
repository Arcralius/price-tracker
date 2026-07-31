"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Flips an explicit `data-theme` on <html>, which overrides the OS preference.
 * The choice is remembered; with nothing stored, the OS decides.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("pt-theme") as Theme | null;
    const initial =
      stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("pt-theme", next);
  }

  return (
    <button
      className="ghost"
      onClick={toggle}
      // Rendered before the effect resolves, so keep the label stable.
      aria-label="Toggle light and dark theme"
      title="Toggle theme"
      suppressHydrationWarning
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
