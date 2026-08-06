import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

// The actual theme is set on <html> before hydration by the inline script
// in layout.tsx (see THEME_INIT_SCRIPT) - this hook just reads that back
// into React state so components can render the right icon/label, and
// writes both the DOM attribute and localStorage when the user toggles.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) || "dark");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch {
        // localStorage unavailable (private browsing, etc.) - theme still
        // applies for this page view, just won't persist across reloads.
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
