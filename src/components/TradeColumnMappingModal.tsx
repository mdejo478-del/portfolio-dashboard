"use client";

import { useMemo, useState } from "react";
import { X, Info } from "lucide-react";
import type { ManualMappingRequest, RequiredMappingField } from "@/lib/tradeImport";
import { Field } from "@/components/dashboard/ui/Layout";
import { Button } from "@/components/dashboard/ui/Button";

interface FieldSpec {
  key: RequiredMappingField;
  label: string;
  required: boolean;
}

const FIELD_SPECS: FieldSpec[] = [
  { key: "date", label: "תאריך", required: true },
  { key: "symbol", label: "סימול / נכס", required: true },
  { key: "qty", label: "כמות", required: true },
  { key: "price", label: "מחיר", required: false },
  { key: "action", label: "סוג פעולה (קנייה / מכירה)", required: false },
];

interface TradeColumnMappingModalProps {
  request: ManualMappingRequest;
  fileName: string;
  onCancel: () => void;
  onContinue: (mapping: Partial<Record<RequiredMappingField, number>>) => void;
}

export default function TradeColumnMappingModal({ request, fileName, onCancel, onContinue }: TradeColumnMappingModalProps) {
  const [mapping, setMapping] = useState<Partial<Record<RequiredMappingField, number>>>(request.suggested);

  const headerRow = request.table[request.headerRowIndex] || [];
  const columnCount = headerRow.length;

  const columnLabel = (idx: number) => {
    const raw = (headerRow[idx] || "").trim();
    return raw !== "" ? raw : `עמודה ${idx + 1} (ללא כותרת)`;
  };

  const sampleRows = useMemo(() => {
    const out: string[][] = [];
    for (let i = request.headerRowIndex + 1; i < request.table.length && out.length < 3; i++) {
      const row = request.table[i];
      if (row.some((c) => c.trim() !== "")) out.push(row);
    }
    return out;
  }, [request]);

  const columnToField = useMemo(() => {
    const rev: Record<number, string> = {};
    for (const spec of FIELD_SPECS) {
      const idx = mapping[spec.key];
      if (idx !== undefined) rev[idx] = spec.label;
    }
    return rev;
  }, [mapping]);

  const canContinue = mapping.date !== undefined && mapping.symbol !== undefined && mapping.qty !== undefined;

  function setField(key: RequiredMappingField, value: string) {
    setMapping((m) => ({ ...m, [key]: value === "" ? undefined : Number(value) }));
  }

  return (
    <div
      dir="rtl"
      onClick={onCancel}
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
          width: "min(980px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>מיפוי עמודות ידני — ייבוא עסקאות מקובץ</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 3 }}>{fileName}</div>
          </div>
          <Button variant="icon" onClick={onCancel} aria-label="סגור" title="סגור"><X size={16} /></Button>
        </div>

        <div style={{ padding: 22, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px",
            background: "var(--info-subtle)", border: "1px solid var(--info-subtle-border)", borderRadius: "var(--radius-md)",
            color: "var(--info)", fontSize: 13.5, lineHeight: 1.6,
          }}>
            <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>לא הצלחנו לזהות אוטומטית את כל העמודות הנדרשות בקובץ. בחר למטה איזו עמודה בקובץ שלך מתאימה לכל שדה, בעזרת שורות הדוגמה כעזר, ולחץ &quot;המשך&quot;.</span>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", marginBottom: 8 }}>תצוגה מקדימה של הקובץ</div>
            <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "auto", maxHeight: "30vh" }}>
              <table>
                <thead style={{ position: "sticky", top: 0, background: "var(--panel-2)", zIndex: 1 }}>
                  <tr>
                    {Array.from({ length: columnCount }, (_, idx) => (
                      <th
                        key={idx}
                        style={{
                          whiteSpace: "nowrap", padding: "8px 10px",
                          background: columnToField[idx] ? "var(--accent-subtle)" : undefined,
                        }}
                      >
                        <div>{columnLabel(idx)}</div>
                        {columnToField[idx] && (
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", marginTop: 2 }}>
                            → {columnToField[idx]}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, r) => (
                    <tr key={r}>
                      {Array.from({ length: columnCount }, (_, idx) => (
                        <td
                          key={idx}
                          style={{
                            whiteSpace: "nowrap", padding: "6px 10px", color: "var(--text-dim)",
                            background: columnToField[idx] ? "var(--accent-subtle)" : undefined,
                          }}
                        >
                          {(row[idx] || "").trim() || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", marginBottom: 8 }}>מיפוי שדות</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
              {FIELD_SPECS.map((spec) => (
                <Field key={spec.key} label={spec.label + (spec.required ? " *" : " (אופציונלי)")}>
                  <select
                    className="ds-select"
                    value={mapping[spec.key] ?? ""}
                    onChange={(e) => setField(spec.key, e.target.value)}
                  >
                    <option value="">— לא נבחר —</option>
                    {Array.from({ length: columnCount }, (_, idx) => (
                      <option key={idx} value={idx}>{columnLabel(idx)}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "16px 22px", borderTop: "1px solid var(--border)" }}>
          <Button variant="ghost" onClick={onCancel}>ביטול</Button>
          <Button variant="primary" disabled={!canContinue} onClick={() => onContinue(mapping)}>
            המשך
          </Button>
        </div>
      </div>
    </div>
  );
}
