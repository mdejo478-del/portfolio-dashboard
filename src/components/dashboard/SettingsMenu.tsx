"use client";

import { useRef, useState, type CSSProperties } from "react";
import { MoreVertical, KeyRound, Trash2 } from "lucide-react";
import { usePopoverPosition } from "@/components/dashboard/usePopoverPosition";

// A dedicated "⋮ הגדרות" entry point for account-level actions (change
// password, delete account) - kept separate from the general "עוד פעולות"
// menu so these settings live under their own clearly-labeled category,
// exactly like AlertsBell: a self-contained trigger + popover that manages
// its own open/closed state, safe to render twice (desktop row + mobile row)
// since each instance is fully independent.
export function SettingsMenu({
  onChangePassword, onDeleteAccount, compact,
}: {
  onChangePassword: () => void;
  onDeleteAccount: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, wrapperRef, 200);

  const triggerStyle: CSSProperties = compact
    ? {
        display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
        borderRadius: 10, cursor: "pointer", background: "transparent",
        border: "1px solid var(--border)", color: "var(--text-dim)",
      }
    : {
        display: "flex", alignItems: "center", gap: 6, padding: "9px 15px",
        borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer",
        background: "transparent", border: "1px solid var(--border)", color: "var(--text-dim)",
      };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="הגדרות" title="הגדרות" style={triggerStyle}>
        <MoreVertical size={compact ? 17 : 15} />
        {!compact && "הגדרות"}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", left: pos.left, width: pos.width, zIndex: 50,
            background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)", overflow: "hidden", display: "flex", flexDirection: "column",
          }}>
            <div style={{
              padding: "9px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-faint)",
              borderBottom: "1px solid var(--border)", letterSpacing: 0.3, textTransform: "uppercase",
            }}>
              הגדרות
            </div>
            <button
              type="button"
              onClick={() => { onChangePassword(); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                fontSize: 13.5, fontWeight: 600, color: "var(--text-dim)", background: "transparent",
                border: "none", borderBottom: "1px solid var(--border)", textAlign: "right", width: "100%",
                cursor: "pointer",
              }}
            >
              <KeyRound size={15} /> שינוי סיסמה
            </button>
            <button
              type="button"
              onClick={() => { onDeleteAccount(); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                fontSize: 13.5, fontWeight: 600, color: "#FF8589", background: "transparent",
                border: "none", textAlign: "right", width: "100%", cursor: "pointer",
              }}
            >
              <Trash2 size={15} /> מחק חשבון
            </button>
          </div>
        </>
      )}
    </div>
  );
}
