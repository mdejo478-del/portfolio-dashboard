"use client";

import { useActionState, useState } from "react";
import { X, AlertTriangle, Trash2 } from "lucide-react";
import { deleteAccount, type AuthFormState } from "@/app/actions/auth";

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
      style={{
        position: "fixed", inset: 0, zIndex: 70, background: "rgba(4,7,10,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)", border: "1px solid var(--loss-subtle-border)", borderRadius: 16,
          width: "min(440px, 100%)", boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, color: "var(--loss)" }}>
            <AlertTriangle size={18} /> מחיקת חשבון
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגור" title="סגור"><X size={16} /></button>
        </div>

        <form action={formAction} style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{
            padding: "12px 14px", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)",
            borderRadius: 10, color: "var(--loss)", fontSize: 13, lineHeight: 1.7,
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
            <button
              type="submit" disabled={!isConfirmed || pending}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: isConfirmed ? "var(--loss-strong)" : "var(--loss-subtle)", color: "#2B0B0C",
                border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13.5,
                cursor: isConfirmed && !pending ? "pointer" : "not-allowed",
              }}
            >
              <Trash2 size={15} /> {pending ? "מוחק..." : "מחק לצמיתות"}
            </button>
            <button type="button" className="ghost" onClick={onClose} disabled={pending}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
}
