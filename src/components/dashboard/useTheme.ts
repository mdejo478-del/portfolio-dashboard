import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

// The actual theme is set on <html> before hydration by the inline script
// in layout.tsx (see THEME_INIT_SCRIPT) - this hook just reads that back
// into React state so components can render the right icon/label, and
// writes both the DOM attribute and localStorage when the user toggles.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    // Deliberately synced post-mount, not via a lazy useState initializer:
    // this component renders on the server (where document doesn't exist)
    // and must match that "dark" fallback on the client's first render too,
    // or React logs a hydration mismatch. THEME_INIT_SCRIPT already set the
    // real value on <html> before hydration - this just pulls it into React
    // state one tick later, which is the standard fix for this exact
    // SSR/client-only-value tension.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
