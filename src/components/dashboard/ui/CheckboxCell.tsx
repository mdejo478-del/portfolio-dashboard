import { useEffect, useRef } from "react";

// Plain <input type="checkbox"> doesn't support an `indeterminate` JSX prop -
// it's DOM-only, so it needs an imperative ref. Used for "select all" header
// checkboxes where the state can be all/none/some-selected.
export function CheckboxCell({
  checked, indeterminate, onChange, ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref} type="checkbox" checked={checked} onChange={onChange}
      aria-label={ariaLabel} style={{ width: 15, height: 15, cursor: "pointer" }}
    />
  );
}
