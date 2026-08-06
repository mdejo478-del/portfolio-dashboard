"use client";

import { useActionState, useEffect } from "react";
import { X, KeyRound, CheckCircle2 } from "lucide-react";
import { changePassword, type ChangePasswordState } from "@/app/actions/auth";
import { Field } from "@/components/dashboard/ui/Layout";

const initialState: ChangePasswordState = {};

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  // Auto-close a beat after success, but the user can also close it right away.
  useEffect(() => {
    if (!state.success) return;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [state.success, onClose]);

  return (
    <div
      dir="rtl"
      onClick={onClose}
      className="ds-modal-scrim-in"
      style={{
        position: "fixed", inset: 0, zIndex: 70, background: "rgba(4,7,10,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ds-modal-panel-in"
        style={{
          background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16,
          width: "min(420px, 100%)", boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            <KeyRound size={17} color="var(--accent)" /> שינוי סיסמה
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגור" title="סגור"><X size={16} /></button>
        </div>

        {state.success ? (
          <div style={{ padding: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "var(--gain-subtle)",
              color: "var(--gain)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <CheckCircle2 size={26} />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>הסיסמה עודכנה בהצלחה</div>
            <button type="button" className="ghost" onClick={onClose} style={{ marginTop: 4 }}>סגור</button>
          </div>
        ) : (
          <form action={formAction} style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="סיסמה נוכחית">
              <input type="password" name="currentPassword" required autoComplete="current-password" />
            </Field>
            <Field label="סיסמה חדשה">
              <input type="password" name="newPassword" required minLength={6} autoComplete="new-password" />
            </Field>
            <Field label="אימות סיסמה חדשה">
              <input type="password" name="confirmPassword" required minLength={6} autoComplete="new-password" />
            </Field>

            {state.error && (
              <div style={{
                padding: "8px 12px", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)",
                borderRadius: 8, color: "var(--loss)", fontSize: 12.5,
              }}>
                {state.error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button type="submit" className="primary" disabled={pending} style={{ flex: 1 }}>
                {pending ? "מעדכן..." : "עדכן סיסמה"}
              </button>
              <button type="button" className="ghost" onClick={onClose} disabled={pending}>ביטול</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
