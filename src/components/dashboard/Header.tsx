import { Landmark, Undo2, Eye, EyeOff, LogOut } from "lucide-react";
import { logout } from "@/app/actions/auth";
import type { Alert, UndoSnapshot } from "@/components/dashboard/types";
import { formatMoney } from "@/components/dashboard/format";
import { AlertsBell } from "@/components/dashboard/AlertsBell";

export function Header({
  userName, total, cashFree, privacyMode, setPrivacyMode,
  visibleAlerts, unseenAlertCount, seenAlertIds, alertsOpen, toggleAlerts, closeAlerts, dismissAlert,
  undoSnapshot, undoLastAction,
}: {
  userName: string; total: number; cashFree: number; privacyMode: boolean; setPrivacyMode: (fn: (v: boolean) => boolean) => void;
  visibleAlerts: Alert[]; unseenAlertCount: number; seenAlertIds: Set<string>;
  alertsOpen: boolean; toggleAlerts: () => void; closeAlerts: () => void; dismissAlert: (id: string) => void;
  undoSnapshot: UndoSnapshot | null; undoLastAction: () => void;
}) {
  return (
    <div style={{
      background: "linear-gradient(180deg, #131C24 0%, #0D1319 100%)",
      borderBottom: "1px solid var(--border)", padding: "16px 20px 18px",
    }}>
      {/* Compact title row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, background: "rgba(34,211,168,0.12)",
            border: "1px solid rgba(34,211,168,0.35)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Landmark size={17} color="var(--accent)" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <h1 style={{ fontSize: 16.5, fontWeight: 800, margin: 0, letterSpacing: 0.2 }}>
              IPMS
            </h1>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-faint)" }}>
              מערכת לניהול תיק השקעות
            </span>
          </div>
        </div>
        <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>
          שלום, <strong style={{ color: "var(--text-dim)" }}>{userName}</strong>
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontStyle: "italic", color: "var(--text-faint)" }}>
          השקעה לפי הקצאה, לא לפי רגש.
        </span>
      </div>

      {/* Single row: balances on one side, account actions on the other */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>שווי תיק כולל</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 800, color: "#5BE39D" }}>{formatMoney(total, privacyMode)}</span>
          </div>
          <div style={{ width: 1, height: 20, background: "var(--border)" }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>מזומן פנוי</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 800 }}>{formatMoney(cashFree, privacyMode)}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <AlertsBell
            alerts={visibleAlerts} unseenCount={unseenAlertCount} seenIds={seenAlertIds}
            open={alertsOpen} onToggle={toggleAlerts} onClose={closeAlerts} onDismiss={dismissAlert}
          />
          <button
            type="button" className="ghost" onClick={undoLastAction} disabled={!undoSnapshot}
            title={undoSnapshot ? "בטל: " + undoSnapshot.label : "אין פעולה לביטול"}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "9px 15px",
              opacity: undoSnapshot ? 1 : 0.45, cursor: undoSnapshot ? "pointer" : "not-allowed",
            }}
          >
            <Undo2 size={15} /> בטל פעולה אחרונה
          </button>
          <button
            type="button" onClick={() => setPrivacyMode((v) => !v)}
            title={privacyMode ? "כבה מצב פרטיות והצג נתונים כספיים" : "הפעל מצב פרטיות - הסתרת נתונים כספיים"}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "9px 15px",
              borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer",
              background: privacyMode ? "rgba(79,163,247,0.15)" : "transparent",
              border: "1px solid " + (privacyMode ? "rgba(79,163,247,0.45)" : "var(--border)"),
              color: privacyMode ? "#7FBBFA" : "var(--text-dim)",
            }}
          >
            {privacyMode ? <EyeOff size={15} /> : <Eye size={15} />}
            {privacyMode ? "מצב פרטיות פעיל" : "הסתר מידע רגיש"}
          </button>
          <form action={logout}>
            <button type="submit" className="ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 15px" }}>
              <LogOut size={15} /> התנתקות
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
