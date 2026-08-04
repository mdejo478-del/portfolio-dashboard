import type { ReactNode } from "react";
import type { Tone } from "@/components/dashboard/types";
import { TONE_STYLES, ACTION_LABELS } from "@/components/dashboard/constants";

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const s = TONE_STYLES[tone] || TONE_STYLES.green;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: s.bg, border: "1px solid " + s.border, color: s.text,
      borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_LABELS[action] || { label: action, tone: "amber" as Tone, icon: null };
  const s = TONE_STYLES[meta.tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: s.bg, border: "1px solid " + s.border, color: s.text,
      borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
    }}>{meta.icon}{meta.label}</span>
  );
}
