"use client";

import { useState } from "react";
import { X, SlidersHorizontal, CheckCircle2 } from "lucide-react";
import { saveRangeWidthPreferenceAction } from "@/app/actions/portfolio";
// From portfolioTypes.ts, not portfolio.ts - this is a client component, and
// portfolio.ts does Node-only file I/O that must never reach the browser bundle.
import { deriveRangeWidthPreference, type RiskTolerance, type ConcentrationPreference, type RangeWidthPreference } from "@/lib/portfolioTypes";
import { RiskConcentrationQuestionnaire } from "@/components/dashboard/RiskConcentrationQuestionnaire";
import { Button } from "@/components/dashboard/ui/Button";

// Lets the user re-answer the same two onboarding questions any time - the
// only thing persisted is the derived narrow/medium/wide preference, so this
// always starts blank rather than trying to reverse-map a stored preference
// back into one specific pair of answers (several pairs can produce the
// same preference - see deriveRangeWidthPreference).
export function PortfolioStyleModal({ onClose, onSaved }: { onClose: () => void; onSaved: (pref: RangeWidthPreference) => void }) {
  const [risk, setRisk] = useState<RiskTolerance | null>(null);
  const [concentration, setConcentration] = useState<ConcentrationPreference | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function save() {
    if (!risk || !concentration) { setError("נא לענות על שתי השאלות."); return; }
    setPending(true);
    setError("");
    try {
      const pref = deriveRangeWidthPreference(risk, concentration);
      await saveRangeWidthPreferenceAction(pref);
      onSaved(pref);
      setSuccess(true);
      setTimeout(onClose, 1400);
    } catch {
      setError("אירעה שגיאה. נסה שוב.");
    } finally {
      setPending(false);
    }
  }

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
          background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-2xl)",
          width: "min(480px, 100%)", boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            <SlidersHorizontal size={17} color="var(--accent)" /> סגנון השקעה
          </div>
          <Button variant="icon" onClick={onClose} aria-label="סגור" title="סגור"><X size={16} /></Button>
        </div>

        {success ? (
          <div style={{ padding: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)", textAlign: "center" }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "var(--gain-subtle)",
              color: "var(--gain)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <CheckCircle2 size={26} />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>העדפת רוחב הטווחים עודכנה</div>
          </div>
        ) : (
          <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
              הבחירה כאן קובעת רק את רוחב טווחי ה-min/max/רף דילול המוצעים כברירת מחדל בהוספת פוזיציה חדשה. ניתן לשנות כל פוזיציה בנפרד תמיד.
            </div>
            <RiskConcentrationQuestionnaire risk={risk} setRisk={setRisk} concentration={concentration} setConcentration={setConcentration} />

            {error && (
              <div style={{
                padding: "8px 12px", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)",
                borderRadius: 8, color: "var(--loss)", fontSize: 12.5,
              }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="primary" onClick={save} disabled={pending} style={{ flex: 1 }}>
                {pending ? "שומר..." : "שמור"}
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={pending}>ביטול</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
