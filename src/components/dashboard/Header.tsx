import { useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Undo2, Eye, EyeOff, LogOut, Info, MoreVertical, Sun, Moon } from "lucide-react";
import { logout } from "@/app/actions/auth";
import type { Alert, UndoSnapshot } from "@/components/dashboard/types";
import { formatMoney } from "@/components/dashboard/format";
import { AlertsBell } from "@/components/dashboard/AlertsBell";
import { usePopoverPosition } from "@/components/dashboard/usePopoverPosition";
import { useTheme } from "@/components/dashboard/useTheme";
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
  const morePos = usePopoverPosition(moreOpen, moreWrapperRef, 210);
  const { theme, toggleTheme } = useTheme();

  // Quiet pill action (About / undo / privacy / logout) - same shape in the
  // resting and "active" (privacy-on) state, just different token colors.
  const actionBtnStyle = (active?: boolean): CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
    padding: "10px var(--space-4)", borderRadius: "var(--radius-md)",
    fontFamily: "var(--sans)", fontSize: "14px", fontWeight: 600,
    color: active ? "var(--info)" : "var(--text-dim)",
    background: active ? "var(--info-subtle)" : "transparent",
    border: "1px solid " + (active ? "var(--info-subtle-border)" : "var(--border)"),
    cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap",
  });

  // Square icon-only button for the mobile compact row - 40px touch target.
  const iconBtnStyle = (active?: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 40, height: 40, borderRadius: "var(--radius-md)",
    color: active ? "var(--info)" : "var(--text-dim)",
    background: active ? "var(--info-subtle)" : "transparent",
    border: "1px solid " + (active ? "var(--info-subtle-border)" : "var(--border)"),
    cursor: "pointer",
  });

  return (
    <div className="hdr" style={{
      background: "var(--bg-elevated)",
      borderBottom: "1px solid var(--border)",
      padding: "var(--space-4) var(--space-5)",
    }}>
      <style>{`
        .hdr .hdr-action { transition: border-color 140ms ease, background 140ms ease, color 140ms ease; }
        .hdr .hdr-action:hover { border-color: var(--border-strong); background: var(--hover-overlay); color: var(--text); }
        .hdr .hdr-action[data-active="true"]:hover { border-color: var(--info); background: var(--info-subtle); color: var(--info); }
        .hdr .hdr-action:disabled { opacity: 0.4; cursor: not-allowed; }
        .hdr .hdr-action:disabled:hover { border-color: var(--border); background: transparent; color: var(--text-dim); }
        .hdr .hdr-icon { transition: border-color 140ms ease, background 140ms ease, color 140ms ease; }
        .hdr .hdr-icon:hover { border-color: var(--border-strong); background: var(--hover-overlay); color: var(--text); }
        .hdr .hdr-icon[data-active="true"]:hover { border-color: var(--info); background: var(--info-subtle); color: var(--info); }
        .hdr .hdr-menu-item { transition: background 140ms ease, color 140ms ease; }
        .hdr .hdr-menu-item:hover { background: var(--hover-overlay); color: var(--text); }
        .hdr .hdr-menu-item:disabled { opacity: 0.4; cursor: not-allowed; }
        .hdr .hdr-menu-item:disabled:hover { background: transparent; color: var(--text-dim); }
      `}</style>

      {/* Identity row: logo/name on one side, greeting on the other */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: "var(--space-1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="IPMS"
            style={{ width: 38, height: 38, objectFit: "contain", flexShrink: 0, borderRadius: "var(--radius-sm)" }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <h1 style={{ fontFamily: "var(--sans)", fontSize: "20px", fontWeight: 700, margin: 0, letterSpacing: "var(--letter-spacing-heading)", color: "var(--text)" }}>
              IPMS
            </h1>
            <span className="header-subtitle" style={{ fontFamily: "var(--sans)", fontSize: "15.5px", fontWeight: 600, letterSpacing: "var(--letter-spacing-subtitle)", color: "var(--text-dim)" }}>
              מערכת לניהול תיק השקעות
            </span>
          </div>
        </div>
        <span className="header-greeting" style={{ fontFamily: "var(--sans)", color: "var(--text-faint)", fontSize: "14px" }}>
          שלום, <strong style={{ color: "var(--text-dim)", fontWeight: 600 }}>{userName}</strong>
        </span>
      </div>

      <div className="header-slogan" style={{ marginBottom: "var(--space-3)" }}>
        <span style={{ fontFamily: "var(--sans)", fontSize: "15.5px", fontWeight: 500, fontStyle: "italic", letterSpacing: "var(--letter-spacing-subtitle)", color: "var(--text-dim)" }}>
          השקעה לפי הקצאה, לא לפי רגש.
        </span>
      </div>

      {/* Balances on one side, account actions on the other */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-5)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
            <span style={{ fontFamily: "var(--sans)", color: "var(--text-dim)", fontWeight: 600, fontSize: "14px" }}>שווי תיק כולל</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: "25px", fontWeight: 700, color: "var(--gain)", direction: "ltr", unicodeBidi: "plaintext" }}>
              {formatMoney(total, privacyMode)}
            </span>
          </div>
          <div style={{ width: 1, height: 26, background: "var(--border)" }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
            <span style={{ fontFamily: "var(--sans)", color: "var(--text-dim)", fontWeight: 600, fontSize: "14px" }}>מזומן פנוי</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: "20px", fontWeight: 700, color: "var(--text)", direction: "ltr", unicodeBidi: "plaintext" }}>
              {formatMoney(cashFree, privacyMode)}
            </span>
          </div>
        </div>

        {/* Full action row: every action visible inline (desktop / tablet) */}
        <div className="header-actions-full" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <AlertsBell
            alerts={visibleAlerts} unseenCount={unseenAlertCount} seenIds={seenAlertIds}
            open={alertsOpen} onToggle={toggleAlerts} onClose={closeAlerts} onDismiss={dismissAlert}
          />
          <Link href="/about" title="אודות המערכת" className="hdr-action" style={actionBtnStyle()}>
            <Info size={15} /> אודות
          </Link>
          <button
            type="button" className="hdr-action" onClick={undoLastAction} disabled={!undoSnapshot}
            title={undoSnapshot ? "בטל: " + undoSnapshot.label : "אין פעולה לביטול"}
            style={actionBtnStyle()}
          >
            <Undo2 size={15} /> בטל פעולה אחרונה
          </button>
          <button
            type="button" className="hdr-action" data-active={privacyMode} onClick={() => setPrivacyMode((v) => !v)}
            title={privacyMode ? "כבה מצב פרטיות והצג נתונים כספיים" : "הפעל מצב פרטיות - הסתרת נתונים כספיים"}
            style={actionBtnStyle(privacyMode)}
          >
            {privacyMode ? <EyeOff size={15} /> : <Eye size={15} />}
            {privacyMode ? "מצב פרטיות פעיל" : "הסתר מידע רגיש"}
          </button>
          <button
            type="button" className="hdr-action" onClick={toggleTheme}
            title={theme === "light" ? "עבור למצב כהה" : "עבור למצב בהיר"}
            style={actionBtnStyle()}
          >
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            {theme === "light" ? "מצב כהה" : "מצב בהיר"}
          </button>
          <SettingsMenu
            onChangePassword={() => setChangePasswordOpen(true)}
            onDeleteAccount={() => setDeleteAccountOpen(true)}
          />
          <form action={logout}>
            <button type="submit" className="hdr-action" style={actionBtnStyle()}>
              <LogOut size={15} /> התנתקות
            </button>
          </form>
        </div>

        {/* Compact action row: essentials only, rest behind "עוד" (mobile) */}
        <div className="header-actions-compact" style={{ alignItems: "center", gap: "var(--space-2)" }}>
          <AlertsBell
            alerts={visibleAlerts} unseenCount={unseenAlertCount} seenIds={seenAlertIds}
            open={alertsOpen} onToggle={toggleAlerts} onClose={closeAlerts} onDismiss={dismissAlert}
          />
          <button
            type="button" className="hdr-icon" data-active={privacyMode} onClick={() => setPrivacyMode((v) => !v)} aria-label="מצב פרטיות"
            title={privacyMode ? "כבה מצב פרטיות והצג נתונים כספיים" : "הפעל מצב פרטיות - הסתרת נתונים כספיים"}
            style={iconBtnStyle(privacyMode)}
          >
            {privacyMode ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>

          <button
            type="button" className="hdr-icon" onClick={toggleTheme} aria-label="החלף ערכת נושא"
            title={theme === "light" ? "עבור למצב כהה" : "עבור למצב בהיר"}
            style={iconBtnStyle()}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <SettingsMenu
            compact
            onChangePassword={() => setChangePasswordOpen(true)}
            onDeleteAccount={() => setDeleteAccountOpen(true)}
          />

          <div ref={moreWrapperRef} style={{ position: "relative" }}>
            <button
              type="button" className="hdr-icon" onClick={() => setMoreOpen((v) => !v)} aria-label="עוד פעולות" title="עוד פעולות"
              style={iconBtnStyle()}
            >
              <MoreVertical size={16} />
            </button>

            {moreOpen && (
              <>
                <div onClick={() => setMoreOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", left: morePos.left, width: morePos.width, zIndex: 50,
                  background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-md)", overflow: "hidden", display: "flex", flexDirection: "column",
                }}>
                  <Link
                    href="/about" onClick={() => setMoreOpen(false)} className="hdr-menu-item"
                    style={{
                      display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)",
                      fontFamily: "var(--sans)", fontSize: "14px", fontWeight: 600, color: "var(--text-dim)", textDecoration: "none",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <Info size={15} /> אודות
                  </Link>
                  <button
                    type="button" className="hdr-menu-item" disabled={!undoSnapshot}
                    onClick={() => { undoLastAction(); setMoreOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)",
                      fontFamily: "var(--sans)", fontSize: "14px", fontWeight: 600, color: "var(--text-dim)", background: "transparent",
                      border: "none", borderBottom: "1px solid var(--border)", textAlign: "right", width: "100%",
                      cursor: undoSnapshot ? "pointer" : "not-allowed",
                    }}
                  >
                    <Undo2 size={15} /> בטל פעולה אחרונה
                  </button>
                  <form action={logout}>
                    <button
                      type="submit" className="hdr-menu-item"
                      style={{
                        display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)",
                        fontFamily: "var(--sans)", fontSize: "14px", fontWeight: 600, color: "var(--loss)", background: "transparent",
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
