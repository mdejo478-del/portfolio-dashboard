"use client";

import { useActionState, useState } from "react";
import { X, AlertTriangle, Trash2 } from "lucide-react";
import { deleteAccount, type AuthFormState } from "@/app/actions/auth";
import { Button } from "@/components/dashboard/ui/Button";

const initialState: AuthFormState = {};

export function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(deleteAccount, initialState);
  const [confirmText, setConfirmText] = useState("");
  const normalized = confirmText.trim();
  const isConfirmed = normalized.toUpperCase() === "DELETE" || normalized === "מחק";

  return (
    <div
      dir="rtl"
      onClick={onClose}
      className="ds-modal-scrim-in"
      style={{
        position: "fixed", inset: 0, zIndex: 70, background: "var(--scrim)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-5)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ds-modal-panel-in"
        style={{
          background: "var(--panel)", border: "1px solid var(--loss-subtle-border)", borderRadius: 16,
          width: "min(440px, 100%)", boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 16, fontWeight: 700, color: "var(--loss)" }}>
            <AlertTriangle size={18} /> מחיקת חשבון
          </div>
          <Button variant="icon" onClick={onClose} aria-label="סגור" title="סגור"><X size={16} /></Button>
        </div>

        <form action={formAction} style={{ padding: 22, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{
            padding: "12px 14px", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)",
            borderRadius: "var(--radius-md)", color: "var(--loss)", fontSize: 13, lineHeight: 1.7,
          }}>
            פעולה זו תמחק לצמיתות את החשבון, התיק, יומן המסחר וכל הנתונים. לא ניתן לשחזר.
          </div>

          <div>
            <label htmlFor="confirmText" style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", fontWeight: 600, marginBottom: 5 }}>
              כדי לאשר, הקלד DELETE או &quot;מחק&quot;
            </label>
            <input
              id="confirmText" name="confirmText" type="text" autoComplete="off"
              value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              placeholder='DELETE / מחק'
            />
          </div>

          {state.error && (
            <div style={{
              padding: "8px 12px", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)",
              borderRadius: 8, color: "var(--loss)", fontSize: 12.5,
            }}>
              {state.error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <Button
              type="submit" variant="danger" disabled={!isConfirmed || pending}
              style={{ flex: 1 }}
            >
              <Trash2 size={15} /> {pending ? "מוחק..." : "מחק לצמיתות"}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={pending}>ביטול</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
