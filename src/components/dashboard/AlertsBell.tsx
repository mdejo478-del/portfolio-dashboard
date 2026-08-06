import { useRef } from "react";
import { Bell, X, CheckCircle2 } from "lucide-react";
import type { Alert } from "@/components/dashboard/types";
import { TONE_STYLES } from "@/components/dashboard/constants";
import { usePopoverPosition } from "@/components/dashboard/usePopoverPosition";
import { EmptyState } from "@/components/dashboard/ui/EmptyState";

export function AlertsBell({
  alerts, unseenCount, seenIds, open, onToggle, onClose, onDismiss,
}: {
  alerts: Alert[]; unseenCount: number; seenIds: Set<string>;
  open: boolean; onToggle: () => void; onClose: () => void; onDismiss: (id: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { left, width } = usePopoverPosition(open, wrapperRef, 340);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button" className="ghost" onClick={onToggle}
        title="התראות"
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, padding: "9px 12px" }}
      >
        <Bell size={15} />
        {unseenCount > 0 && (
          <span style={{
            position: "absolute", top: -5, left: -5, minWidth: 16, height: 16, borderRadius: 999,
            background: "var(--loss-strong)", color: "#fff", fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
          }}>
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div className="ds-popover-in" style={{
            position: "absolute", top: "calc(100% + 8px)", left, width,
            maxHeight: 420, overflowY: "auto", background: "var(--panel)", border: "1px solid var(--border)",
            borderRadius: 12, zIndex: 50, boxShadow: "var(--shadow-md)",
          }}>
            <div style={{
              padding: "12px 14px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13.5,
              display: "flex", alignItems: "center", gap: 8, color: "var(--text)",
            }}>
              <Bell size={14} color="var(--accent)" /> התראות{alerts.length > 0 ? " (" + alerts.length + ")" : ""}
            </div>

            {alerts.length === 0 ? (
              <EmptyState compact icon={<CheckCircle2 size={20} />} title="אין התראות פעילות" subtitle="נעדכן אותך כאן כשיהיה משהו שדורש תשומת לב." />
            ) : (
              alerts.map((a) => {
                const s = TONE_STYLES[a.tone];
                const isNew = !seenIds.has(a.id);
                return (
                  <div key={a.id} style={{
                    padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 9, alignItems: "flex-start",
                    background: isNew ? "var(--accent-subtle)" : "transparent",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, marginTop: 5, flexShrink: 0, background: s.text }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{a.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.4 }}>{a.message}</div>
                    </div>
                    <button type="button" className="icon-btn" onClick={() => onDismiss(a.id)} title="סגור התראה" aria-label="סגור התראה">
                      <X size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
