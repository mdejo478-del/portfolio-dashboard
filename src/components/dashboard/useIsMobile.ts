import { useEffect, useState } from "react";

// Some environments were observed not reliably applying a later, equal-specificity
// !important media-query override for grid-template-columns (the rule matched and
// had correct content, but computed style kept the earlier declaration) - tracking
// viewport width in JS and setting the value directly sidesteps that entirely.
export function useIsMobile(breakpointPx = 640): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpointPx]);

  return isMobile;
}
