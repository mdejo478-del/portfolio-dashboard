"use client";

import { useState } from "react";
import { X, Gauge, CheckCircle2 } from "lucide-react";
import { saveMarketSettingsAction } from "@/app/actions/market";
import {
  DEFAULT_MARKET_SETTINGS, VIX_ZONE_LABEL, validateMarketSettings, type MarketSettings,
} from "@/lib/marketStatus";
import { parseNum } from "@/components/dashboard/format";
import { Button } from "@/components/dashboard/ui/Button";
import { Field } from "@/components/dashboard/ui/Layout";

interface Fields {
  calmBelow: string;
  alertBelow: string;
  buyBelow: string;
  panicUpTo: string;
  fearGreed: string;
}

const toFields = (s: MarketSettings): Fields => ({
  calmBelow: String(s.vixZones.calmBelow), alertBelow: String(s.vixZones.alertBelow), buyBelow: String(s.vixZones.buyBelow),
  panicUpTo: String(s.vixZones.panicUpTo), fearGreed: String(s.fearGreedExtremeBelow),
});

const fromFields = (f: Fields) => ({
  vixZones: { calmBelow: parseNum(f.calmBelow), alertBelow: parseNum(f.alertBelow), buyBelow: parseNum(f.buyBelow), panicUpTo: parseNum(f.panicUpTo) },
  fearGreedExtremeBelow: parseNum(f.fearGreed),
});

/** The owner's own thresholds for the market-status card (VIX zones, Fear & Greed extreme-fear level).
 * Checked with the same rules the server enforces, so a mistake is explained here, in Hebrew, before saving. */
export function MarketSettingsModal({ settings, onClose, onSaved }: {
  settings: MarketSettings; onClose: () => void; onSaved: (settings: MarketSettings) => void;
}) {
  const [fields, setFields] = useState<Fields>(toFields(settings));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const check = validateMarketSettings(fromFields(fields));

  function update(key: keyof Fields, value: string) { setFields((f) => ({ ...f, [key]: value })); setError(""); }

  async function save() {
    const verdict = validateMarketSettings(fromFields(fields));
    if (!verdict.ok) { setError(verdict.message); return; }
    setPending(true);
    setError("");
    try {
      const result = await saveMarketSettingsAction(verdict.settings);
      if (!result.ok) { setError(result.message); return; }
      onSaved(result.settings);
      setSuccess(true);
      setTimeout(onClose, 1200);
    } catch {
      setError("אירעה שגיאה בשמירה. נסה שוב.");
    } finally {
      setPending(false);
    }
  }

  const input = (key: keyof Fields) => (
    <input type="text" inputMode="decimal" value={fields[key]} onChange={(e) => update(key, e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") save(); }} style={{ direction: "ltr", textAlign: "left" }} />
  );

  return (
    <div dir="rtl" onClick={onClose} className="ds-modal-scrim-in" role="dialog" aria-label="הגדרות מצב שוק" style={{
      position: "fixed", inset: 0, zIndex: 70, background: "var(--scrim)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-5)",
    }}>
      <div onClick={(e) => e.stopPropagation()} className="ds-modal-panel-in" style={{
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-2xl)",
        width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow-lg)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            <Gauge size={17} color="var(--accent)" /> הגדרות מצב שוק
          </div>
          <Button variant="icon" onClick={onClose} aria-label="סגור" title="סגור"><X size={16} /></Button>
        </div>

        {success ? (
          <div style={{ padding: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)", textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--gain-subtle)", color: "var(--gain)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 size={26} />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>ההגדרות נשמרו</div>
          </div>
        ) : (
          <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
              אלה הכללים שלך להצגת מצב השוק. הכרטיס רק מראה באיזה אזור המדד נמצא לפיהם, ואינו המלצה.
            </div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>אזורי VIX</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
              <Field label={VIX_ZONE_LABEL.calm + " - עד (לא כולל)"}>{input("calmBelow")}</Field>
              <Field label={VIX_ZONE_LABEL.alert + " - עד (לא כולל)"}>{input("alertBelow")}</Field>
              <Field label={VIX_ZONE_LABEL.buy + " - עד (לא כולל)"}>{input("buyBelow")}</Field>
              <Field label={VIX_ZONE_LABEL.panic + " - עד (כולל)"}>{input("panicUpTo")}</Field>
            </div>
            {check.ok && (
              <div data-zones-preview style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.7 }}>
                {VIX_ZONE_LABEL.calm}: מתחת ל-{check.settings.vixZones.calmBelow} · {VIX_ZONE_LABEL.alert}: {check.settings.vixZones.calmBelow}-{check.settings.vixZones.alertBelow} · {VIX_ZONE_LABEL.buy}: {check.settings.vixZones.alertBelow}-{check.settings.vixZones.buyBelow} · {VIX_ZONE_LABEL.panic}: {check.settings.vixZones.buyBelow}-{check.settings.vixZones.panicUpTo} · {VIX_ZONE_LABEL.extreme}: מעל {check.settings.vixZones.panicUpTo}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 4 }}>Fear & Greed</div>
            <Field label="פחד קיצוני - מתחת ל-">{input("fearGreed")}</Field>

            {error && (
              <div role="alert" style={{ padding: "var(--space-2) var(--space-3)", background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: 8, color: "var(--loss)", fontSize: 12.5, lineHeight: 1.5 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button variant="primary" onClick={save} disabled={pending}>שמור</Button>
              <Button variant="ghost" onClick={() => { setFields(toFields(DEFAULT_MARKET_SETTINGS)); setError(""); }}>אפס לברירת מחדל</Button>
              <Button variant="ghost" onClick={onClose}>ביטול</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
