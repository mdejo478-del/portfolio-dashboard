import { useEffect, useState, type RefObject } from "react";

// A popover anchored with a fixed `left: 0` only stays on-screen if its
// trigger happens to sit near the left edge - on a narrow phone, a trigger
// near the right edge (very common in this RTL header) pushes most of the
// popover off-screen. This measures the trigger's real position and clamps
// the popover within the viewport instead of assuming where the trigger is.
export function usePopoverPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  preferredWidth: number,
  margin = 12
): { left: number; width: number } {
  const [pos, setPos] = useState({ left: 0, width: preferredWidth });

  useEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;

    function compute() {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const width = Math.min(preferredWidth, viewportWidth - margin * 2);
      let desiredPageLeft = rect.left;
      if (desiredPageLeft + width > viewportWidth - margin) desiredPageLeft = viewportWidth - margin - width;
      if (desiredPageLeft < margin) desiredPageLeft = margin;
      setPos({ left: desiredPageLeft - rect.left, width });
    }

    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [open, triggerRef, preferredWidth, margin]);

  return pos;
}
