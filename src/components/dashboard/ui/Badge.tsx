import type { CSSProperties, ReactNode } from "react";
import type { Tone } from "@/components/dashboard/types";
import { ACTION_LABELS } from "@/components/dashboard/constants";

// Maps this app's Tone system onto the design-system's .ds-badge color
// variants (tokens.css) - "neutral" and "accent" exist in the CSS but have
// no Tone equivalent, so they're left available for future direct use.
export const TONE_TO_DS_BADGE: Record<Tone, string> = {
  green: "ds-badge-gain",
  amber: "ds-badge-warning",
  red: "ds-badge-loss",
  blue: "ds-badge-info",
};

export function Badge({
  tone, children, size = "sm", title, style,
}: { tone: Tone; children: ReactNode; size?: "sm" | "md"; title?: string; style?: CSSProperties }) {
  const variant = TONE_TO_DS_BADGE[tone] || TONE_TO_DS_BADGE.green;
  return (
    <span
      className={`ds-badge ${variant}`}
      title={title}
      // .ds-badge has one built-in size; "md" is a documented larger reading-size
      // used where these pills carry primary information (e.g. Holdings table).
      style={{ ...(size === "md" ? { fontSize: 14, padding: "4px 11px" } : undefined), ...style }}
    >
      {children}
    </span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_LABELS[action] || { label: action, tone: "amber" as Tone, icon: null };
  const variant = TONE_TO_DS_BADGE[meta.tone] || TONE_TO_DS_BADGE.amber;
  return (
    <span className={`ds-badge ${variant}`}>
      {meta.icon}{meta.label}
    </span>
  );
}
