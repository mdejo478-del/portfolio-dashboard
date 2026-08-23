import type { CSSProperties } from "react";
import type { RiskTolerance, ConcentrationPreference } from "@/lib/portfolio";

// Shared between the onboarding step and the "עריכת סגנון השקעה" settings
// modal - same two questions, same visual language, so answering it once
// during onboarding and re-answering it later in settings feels like the
// same screen, not two different UIs for the same decision.

const RISK_OPTIONS: { value: RiskTolerance; label: string; hint: string }[] = [
  { value: "low", label: "נמוך", hint: "מעדיף יציבות על פני תשואה גבוהה" },
  { value: "medium", label: "בינוני", hint: "מאוזן בין יציבות לצמיחה" },
  { value: "high", label: "גבוה", hint: "מוכן לתנודתיות גבוהה יותר" },
];

const CONCENTRATION_OPTIONS: { value: ConcentrationPreference; label: string; hint: string }[] = [
  { value: "diversified", label: "מפוזר", hint: "הרבה פוזיציות קטנות" },
  { value: "focused", label: "ממוקד", hint: "פחות פוזיציות, כל אחת גדולה יותר" },
];

function OptionCard<T extends string>({
  option, selected, onSelect,
}: { option: { value: T; label: string; hint: string }; selected: boolean; onSelect: (v: T) => void }) {
  const style: CSSProperties = {
    flex: 1, textAlign: "center", cursor: "pointer", borderRadius: "var(--radius-md)",
    padding: "var(--space-3) var(--space-2)", display: "flex", flexDirection: "column", gap: 4,
    border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
    background: selected ? "var(--accent-subtle)" : "transparent",
    transition: "border-color 140ms ease, background 140ms ease",
  };
  return (
    <button type="button" onClick={() => onSelect(option.value)} style={style}>
      <span style={{ fontSize: 14, fontWeight: 700, color: selected ? "var(--accent)" : "var(--text)" }}>{option.label}</span>
      <span style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.3 }}>{option.hint}</span>
    </button>
  );
}

export function RiskConcentrationQuestionnaire({
  risk, setRisk, concentration, setConcentration,
}: {
  risk: RiskTolerance | null;
  setRisk: (v: RiskTolerance) => void;
  concentration: ConcentrationPreference | null;
  setConcentration: (v: ConcentrationPreference) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", width: "100%" }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", marginBottom: "var(--space-2)" }}>
          כמה סיכון אתה מוכן לקחת?
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {RISK_OPTIONS.map((opt) => (
            <OptionCard key={opt.value} option={opt} selected={risk === opt.value} onSelect={setRisk} />
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", marginBottom: "var(--space-2)" }}>
          כמה ריכוז אתה מעדיף בתיק?
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {CONCENTRATION_OPTIONS.map((opt) => (
            <OptionCard key={opt.value} option={opt} selected={concentration === opt.value} onSelect={setConcentration} />
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
        זה קובע רק את רוחב טווחי ההקצאה המוצעים לפוזיציות חדשות (min/max/רף דילול) - לא ממליץ על אף מניה ספציפית, ולא קובע איזו מניה &quot;טובה יותר&quot;. את המניות אתה בוחר בעצמך.
      </div>
    </div>
  );
}
