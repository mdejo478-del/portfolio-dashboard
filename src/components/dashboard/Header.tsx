import { useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Undo2, Eye, EyeOff, LogOut, Info, MoreVertical } from "lucide-react";
import { logout } from "@/app/actions/auth";
import type { Alert, UndoSnapshot } from "@/components/dashboard/types";
import { formatMoney } from "@/components/dashboard/format";
import { AlertsBell } from "@/components/dashboard/AlertsBell";
import { usePopoverPosition } from "@/components/dashboard/usePopoverPosition";
import { ChangePasswordModal } from "@/components/dashboard/ChangePasswordModal";
import { DeleteAccountModal } from "@/components/dashboard/DeleteAccountModal";
import { SettingsMenu } from "@/components/dashboard/SettingsMenu";

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
  const [moreOpen, setMoreOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const moreWrapperRef = useRef<HTMLDivElement>(null);
  const morePos = usePopoverPosition(moreOpen, moreWrapperRef, 200);

  const ghostBtnStyle: CSSProperties = {
    display: "flex", alignItems: "center", gap: 6, padding: "9px 15px",
    borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer",
    background: "transparent", border: "1px solid var(--border)", color: "var(--text-dim)",
  };

  return (
    <div style={{
      background: "linear-gradient(180deg, #131C24 0%, #0D1319 100%)",
      borderBottom: "1px solid var(--border)", padding: "16px 20px 18px",
    }}>
      {/* Compact title row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="IPMS"
            style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0 }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 16.5, fontWeight: 800, margin: 0, letterSpacing: 0.2 }}>
              IPMS
            </h1>
            <span className="header-subtitle" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-faint)" }}>
              מערכת לניהול תיק השקעות
            </span>
          </div>
        </div>
        <span className="header-greeting" style={{ color: "var(--text-faint)", fontSize: 12.5 }}>
          שלום, <strong style={{ color: "var(--text-dim)" }}>{userName}</strong>
        </span>
      </div>

      <div className="header-slogan" style={{ marginBottom: 12 }}>
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

        {/* Full action row: every action visible inline (desktop / tablet) */}
        <div className="header-actions-full" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <AlertsBell
            alerts={visibleAlerts} unseenCount={unseenAlertCount} seenIds={seenAlertIds}
            open={alertsOpen} onToggle={toggleAlerts} onClose={closeAlerts} onDismiss={dismissAlert}
          />
          <Link href="/about" title="אודות המערכת" style={{ ...ghostBtnStyle, textDecoration: "none" }}>
            <Info size={15} /> אודות
          </Link>
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
          <SettingsMenu
            onChangePassword={() => setChangePasswordOpen(true)}
            onDeleteAccount={() => setDeleteAccountOpen(true)}
          />
          <form action={logout}>
            <button type="submit" className="ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 15px" }}>
              <LogOut size={15} /> התנתקות
            </button>
          </form>
        </div>

        {/* Compact action row: logo + essentials only, everything else behind "עוד" (mobile) */}
        <div className="header-actions-compact" style={{ alignItems: "center", gap: 8 }}>
          <AlertsBell
            alerts={visibleAlerts} unseenCount={unseenAlertCount} seenIds={seenAlertIds}
            open={alertsOpen} onToggle={toggleAlerts} onClose={closeAlerts} onDismiss={dismissAlert}
          />
          <button
            type="button" onClick={() => setPrivacyMode((v) => !v)} aria-label="מצב פרטיות"
            title={privacyMode ? "כבה מצב פרטיות והצג נתונים כספיים" : "הפעל מצב פרטיות - הסתרת נתונים כספיים"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
              borderRadius: 10, cursor: "pointer",
              background: privacyMode ? "rgba(79,163,247,0.15)" : "transparent",
              border: "1px solid " + (privacyMode ? "rgba(79,163,247,0.45)" : "var(--border)"),
              color: privacyMode ? "#7FBBFA" : "var(--text-dim)",
            }}
          >
            {privacyMode ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>

          <SettingsMenu
            compact
            onChangePassword={() => setChangePasswordOpen(true)}
            onDeleteAccount={() => setDeleteAccountOpen(true)}
          />

          <div ref={moreWrapperRef} style={{ position: "relative" }}>
            <button
              type="button" onClick={() => setMoreOpen((v) => !v)} aria-label="עוד פעולות" title="עוד פעולות"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
                borderRadius: 10, cursor: "pointer", background: "transparent",
                border: "1px solid var(--border)", color: "var(--text-dim)",
              }}
            >
              <MoreVertical size={17} />
            </button>

            {moreOpen && (
              <>
                <div onClick={() => setMoreOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", left: morePos.left, width: morePos.width, zIndex: 50,
                  background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12,
                  boxShadow: "0 12px 32px rgba(0,0,0,0.45)", overflow: "hidden", display: "flex", flexDirection: "column",
                }}>
                  <Link
                    href="/about" onClick={() => setMoreOpen(false)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                      fontSize: 13.5, fontWeight: 600, color: "var(--text-dim)", textDecoration: "none",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <Info size={15} /> אודות
                  </Link>
                  <button
                    type="button" disabled={!undoSnapshot}
                    onClick={() => { undoLastAction(); setMoreOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                      fontSize: 13.5, fontWeight: 600, color: "var(--text-dim)", background: "transparent",
                      border: "none", borderBottom: "1px solid var(--border)", textAlign: "right", width: "100%",
                      cursor: undoSnapshot ? "pointer" : "not-allowed", opacity: undoSnapshot ? 1 : 0.45,
                    }}
                  >
                    <Undo2 size={15} /> בטל פעולה אחרונה
                  </button>
                  <form action={logout}>
                    <button
                      type="submit"
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                        fontSize: 13.5, fontWeight: 600, color: "#FF8589", background: "transparent",
                        border: "none", textAlign: "right", width: "100%", cursor: "pointer",
                      }}
                    >
                      <LogOut size={15} /> התנתקות
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {changePasswordOpen && <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />}
      {deleteAccountOpen && <DeleteAccountModal onClose={() => setDeleteAccountOpen(false)} />}
    </div>
  );
}
