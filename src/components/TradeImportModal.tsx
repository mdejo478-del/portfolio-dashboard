"use client";

import { useMemo, useState } from "react";
import { X, AlertTriangle, CheckCircle2, FileWarning, ArrowRight, ArrowLeft, PackageOpen } from "lucide-react";
import {
  FIELD_DEFS, suggestHeaderRowIndex, suggestColumnMapping, parseRowsWithMapping,
  detectOpeningBalanceNeeds, buildOpeningBalanceRow,
  type FieldKey, type ParsedTradeRow, type LedgerLike,
} from "@/lib/tradeImport";
import { fmtUSD, parseNum } from "@/components/dashboard/format";
import type { Tone } from "@/components/dashboard/types";
import { Badge } from "@/components/dashboard/ui/Badge";
import { Button } from "@/components/dashboard/ui/Button";

const ACTION_TONE: Record<string, Tone> = {
  "קנייה": "green", "מכירה": "red", "הפקדה": "blue", "משיכה": "amber", "אחר": "blue",
};

const HEADER_ROW_PREVIEW_LIMIT = 20;
const SAMPLE_ROW_SCAN_LIMIT = 30; // how far past the header to look for a non-blank sample value per column

type Step = "header" | "mapping" | "opening" | "preview";

interface TradeImportModalProps {
  table: string[][];
  fileName: string;
  existingLedger: Record<string, LedgerLike>;
  onConfirm: (rows: ParsedTradeRow[]) => void;
  onClose: () => void;
}

function cellPreview(cell: string): string {
  const s = cell.trim();
  if (s.length <= 40) return s;
  return s.slice(0, 40) + "…";
}

export default function TradeImportModal({ table, fileName, existingLedger, onConfirm, onClose }: TradeImportModalProps) {
  const [step, setStep] = useState<Step>("header");
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(() => suggestHeaderRowIndex(table));
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, number>>>(() =>
    suggestColumnMapping(table[suggestHeaderRowIndex(table)] || [])
  );
  const [inferAction, setInferAction] = useState<boolean>(() => mapping.action === undefined && mapping.qty !== undefined);
  const [checkedRows, setCheckedRows] = useState<Set<number>>(new Set());

  function selectHeaderRow(idx: number) {
    setHeaderRowIndex(idx);
    const guess = suggestColumnMapping(table[idx] || []);
    setMapping(guess);
    setInferAction(guess.action === undefined && guess.qty !== undefined);
  }

  const headerRow = table[headerRowIndex] || [];
  const columnCount = Math.max(headerRow.length, ...table.slice(headerRowIndex + 1, headerRowIndex + 1 + SAMPLE_ROW_SCAN_LIMIT).map((r) => r.length), 0);

  function sampleValueFor(colIndex: number): string {
    for (let i = headerRowIndex + 1; i < Math.min(table.length, headerRowIndex + 1 + SAMPLE_ROW_SCAN_LIMIT); i++) {
      const v = (table[i][colIndex] || "").trim();
      if (v !== "") return v;
    }
    return "";
  }

  function fieldForColumn(colIndex: number): FieldKey | "" {
    for (const [field, idx] of Object.entries(mapping)) {
      if (idx === colIndex) return field as FieldKey;
    }
    return "";
  }

  function assignField(colIndex: number, field: FieldKey | "") {
    setMapping((prev) => {
      const next = { ...prev };
      // A field can only point at one column - clear it from wherever it
      // was before assigning it here (and clear whatever this column used
      // to be, since a column can only mean one thing).
      for (const key of Object.keys(next) as FieldKey[]) {
        if (next[key] === colIndex) delete next[key];
      }
      if (field !== "") next[field] = colIndex;
      return next;
    });
  }

  const mappingValid = mapping.date !== undefined && mapping.symbol !== undefined
    && (mapping.action !== undefined || (mapping.qty !== undefined && inferAction));

  const parsedRows = useMemo(
    () => parseRowsWithMapping(table, headerRowIndex, mapping, inferAction && mapping.action === undefined),
    [table, headerRowIndex, mapping, inferAction]
  );

  // Symbols whose sells in this batch aren't fully explained by prior buys
  // (already on the books, or earlier in this same batch) - importing just
  // a partial slice of a symbol's real history (a single month's statement
  // for a position opened earlier, say) otherwise produces a realized P&L
  // that's not just incomplete but actively wrong, computed against a cost
  // basis of $0 or whatever the first visible buy happened to cost.
  const openingNeeds = useMemo(
    () => detectOpeningBalanceNeeds(parsedRows.filter((r) => !r.error), existingLedger),
    [parsedRows, existingLedger]
  );
  const [openingInputs, setOpeningInputs] = useState<Record<string, { qty: string; avgCost: string; skip: boolean }>>({});

  function updateOpeningInput(symbol: string, patch: Partial<{ qty: string; avgCost: string; skip: boolean }>) {
    setOpeningInputs((prev) => {
      const current = prev[symbol] ?? { qty: "", avgCost: "", skip: false };
      return { ...prev, [symbol]: { ...current, ...patch } };
    });
  }

  const openingRows = useMemo(() => {
    const rows: ParsedTradeRow[] = [];
    let syntheticRowNumber = -1;
    for (const need of openingNeeds) {
      const input = openingInputs[need.symbol];
      if (!input || input.skip) continue;
      const qty = parseNum(input.qty);
      const avgCost = parseNum(input.avgCost);
      if (qty !== null && qty > 0 && avgCost !== null && avgCost > 0) {
        rows.push(buildOpeningBalanceRow(syntheticRowNumber--, need.symbol, qty, avgCost, need.firstDate));
      }
    }
    return rows;
  }, [openingNeeds, openingInputs]);

  // Needs neither skipped nor covered by a valid opening-balance entry yet -
  // gates leaving the "opening" step and is shown as a standing warning in
  // the preview if the user chose to skip past it anyway.
  const unresolvedNeeds = useMemo(() => {
    return openingNeeds.filter((need) => {
      const input = openingInputs[need.symbol];
      if (input?.skip) return false;
      const covered = openingRows.some((r) => r.symbol === need.symbol);
      return !covered;
    });
  }, [openingNeeds, openingInputs, openingRows]);

  const finalRows = useMemo(() => [...openingRows, ...parsedRows], [openingRows, parsedRows]);

  // Re-select every error-free row whenever the header/mapping/opening-
  // balance choices change the parse result - adjusted during render
  // (rather than in an Effect) since it's a pure reset keyed off finalRows'
  // own identity, not state that needs to persist across changes.
  const [checkedForRows, setCheckedForRows] = useState(finalRows);
  if (finalRows !== checkedForRows) {
    setCheckedForRows(finalRows);
    setCheckedRows(new Set(finalRows.filter((r) => !r.error).map((r) => r.rowNumber)));
  }

  const checkedCount = finalRows.filter((r) => !r.error && checkedRows.has(r.rowNumber)).length;

  function toggleRow(rowNumber: number) {
    setCheckedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber);
      return next;
    });
  }

  function handleConfirm() {
    const selected = finalRows.filter((r) => !r.error && checkedRows.has(r.rowNumber));
    onConfirm(selected);
  }

  const openingStepValid = openingNeeds.every((need) => {
    const input = openingInputs[need.symbol];
    if (input?.skip) return true;
    const qty = parseNum(input?.qty ?? "");
    const avgCost = parseNum(input?.avgCost ?? "");
    return qty !== null && qty > 0 && avgCost !== null && avgCost > 0;
  });

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
          width: "min(920px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
              ייבוא עסקאות מקובץ
              {step === "header" && " — שלב 1: שורת כותרת"}
              {step === "mapping" && " — שלב 2: מיפוי עמודות"}
              {step === "opening" && " — שלב 3: יתרת פתיחה"}
              {step === "preview" && (openingNeeds.length > 0 ? " — שלב 4: אישור סופי" : " — שלב 3: אישור סופי")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 3 }}>{fileName}</div>
          </div>
          <Button variant="icon" onClick={onClose} aria-label="סגור" title="סגור"><X size={16} /></Button>
        </div>

        <div style={{ padding: 22, overflowY: "auto", flex: 1 }}>
          {table.length === 0 ? (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px",
              background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: "var(--radius-md)", color: "var(--loss)", fontSize: 13.5,
            }}>
              <FileWarning size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>הקובץ ריק או שלא ניתן היה לקרוא אותו.</span>
            </div>
          ) : step === "header" ? (
            <>
              <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: "var(--space-4)" }}>
                בקבצים מסוימים (למשל דוחות ברוקר עם כמה טבלאות באותו קובץ) שורת הכותרת האמיתית לא בהכרח בשורה הראשונה. בחר את השורה שמכילה את שמות העמודות (תאריך, סימול, כמות וכו&apos;).
              </p>
              <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "auto", maxHeight: "50vh" }}>
                {table.slice(0, HEADER_ROW_PREVIEW_LIMIT).map((row, idx) => (
                  <label
                    key={idx}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer",
                      borderBottom: "1px solid var(--border)",
                      background: idx === headerRowIndex ? "var(--accent-subtle)" : "transparent",
                    }}
                  >
                    <input type="radio" name="headerRow" checked={idx === headerRowIndex} onChange={() => selectHeaderRow(idx)} />
                    <span style={{ fontSize: 11, color: "var(--text-faint)", flexShrink: 0, width: 28 }}>{idx + 1}</span>
                    <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "var(--mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {row.map(cellPreview).join(" | ")}
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : step === "mapping" ? (
            <>
              <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: "var(--space-4)" }}>
                עבור כל עמודה בקובץ, בחר מה היא מייצגת. תאריך וסימול חובה. אין צורך למפות עמודות שלא רלוונטיות - השאר &quot;התעלם&quot;.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {Array.from({ length: columnCount }, (_, colIndex) => {
                  const headerLabel = (headerRow[colIndex] || "").trim();
                  const sample = sampleValueFor(colIndex);
                  const currentField = fieldForColumn(colIndex);
                  return (
                    <div key={colIndex} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                      background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {headerLabel || "(עמודה " + (colIndex + 1) + ")"}
                        </div>
                        {sample && (
                          <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            לדוגמה: {cellPreview(sample)}
                          </div>
                        )}
                      </div>
                      <select
                        value={currentField}
                        onChange={(e) => assignField(colIndex, (e.target.value || "") as FieldKey | "")}
                        style={{
                          flexShrink: 0, minWidth: 170, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
                          background: "var(--panel)", color: "var(--text)", padding: "6px 8px", fontSize: 12.5,
                        }}
                      >
                        <option value="">— התעלם —</option>
                        {FIELD_DEFS.map((f) => (
                          <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {mapping.action === undefined && mapping.qty !== undefined && (
                <label style={{
                  display: "flex", alignItems: "flex-start", gap: 8, marginTop: "var(--space-4)", padding: "10px 12px",
                  background: "var(--info-subtle)", border: "1px solid var(--info-subtle-border)", borderRadius: "var(--radius-md)",
                  fontSize: 12.5, color: "var(--info)", cursor: "pointer",
                }}>
                  <input type="checkbox" checked={inferAction} onChange={(e) => setInferAction(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>אין עמודת &quot;סוג פעולה&quot; - הסק קנייה/מכירה מהסימן של הכמות (כמות חיובית = קנייה, שלילית = מכירה).</span>
                </label>
              )}

              {!mappingValid && (
                <div style={{ marginTop: "var(--space-4)", fontSize: 12.5, color: "var(--loss)" }}>
                  חובה למפות תאריך וסימול, וגם סוג פעולה (או כמות + הסקה מסימן).
                </div>
              )}
            </>
          ) : step === "opening" ? (
            <>
              <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: "var(--space-4)" }}>
                הקובץ מכיל מכירות של נכסים שאין להם מספיק קניות מוסברות - כנראה שהוחזקו עוד לפני תחילת הקובץ. בלי לדעת כמה יחידות ובאיזה מחיר ממוצע, הרווח/הפסד שיחושב לנכסים האלו יהיה שגוי, לא רק חסר. הזן יתרת פתיחה (כמות + מחיר ממוצע) נכון ליום שלפני העסקה הראשונה בקובץ, או דלג במפורש אם אין לך את המידע.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {openingNeeds.map((need) => {
                  const input = openingInputs[need.symbol] ?? { qty: "", avgCost: "", skip: false };
                  return (
                    <div key={need.symbol} style={{
                      padding: "10px 12px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{need.symbol}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                          חסרות לפחות {need.deficitQty} יחידות לפני {need.firstDate}
                        </div>
                      </div>
                      {!input.skip && (
                        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                          <input
                            type="text" inputMode="decimal" placeholder="כמות"
                            value={input.qty} onChange={(e) => updateOpeningInput(need.symbol, { qty: e.target.value })}
                            style={{ flex: 1, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", padding: "6px 8px", fontSize: 12.5 }}
                          />
                          <input
                            type="text" inputMode="decimal" placeholder="מחיר ממוצע"
                            value={input.avgCost} onChange={(e) => updateOpeningInput(need.symbol, { avgCost: e.target.value })}
                            style={{ flex: 1, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", padding: "6px 8px", fontSize: 12.5 }}
                          />
                        </div>
                      )}
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-faint)", cursor: "pointer" }}>
                        <input type="checkbox" checked={input.skip} onChange={(e) => updateOpeningInput(need.symbol, { skip: e.target.checked })} />
                        אין לי את המידע - דלג (הרווח/הפסד עבור {need.symbol} עלול להיות שגוי)
                      </label>
                    </div>
                  );
                })}
              </div>
              {!openingStepValid && (
                <div style={{ marginTop: "var(--space-4)", fontSize: 12.5, color: "var(--loss)" }}>
                  לכל נכס למעלה: מלא כמות ומחיר ממוצע תקינים, או סמן &quot;דלג&quot;.
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--gain)", fontSize: 13, fontWeight: 700 }}>
                  <CheckCircle2 size={15} /> {checkedCount} עסקאות מסומנות להוספה ליומן
                </div>
                {finalRows.some((r) => r.error) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--warning)", fontSize: 13, fontWeight: 700 }}>
                    <AlertTriangle size={15} /> {finalRows.filter((r) => r.error).length} שורות עם שגיאה - לא ניתנות לבחירה
                  </div>
                )}
              </div>
              <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: "var(--space-3)" }}>
                בטל סימון של כל שורה שנראית לא נכונה לפני האישור - רק שורות מסומנות ייכנסו ליומן המסחר.
              </p>
              {unresolvedNeeds.length > 0 && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 8, marginBottom: "var(--space-3)", padding: "10px 12px",
                  background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: "var(--radius-md)",
                  fontSize: 12.5, color: "var(--loss)",
                }}>
                  <PackageOpen size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    דילגת על יתרת פתיחה עבור: {unresolvedNeeds.map((n) => n.symbol).join(", ")}. הרווח/הפסד המחושב לנכסים האלו כנראה שגוי, לא רק חסר.
                  </span>
                </div>
              )}

              <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "auto", maxHeight: "48vh" }}>
                <table>
                  <thead style={{ position: "sticky", top: 0, background: "var(--panel-2)", zIndex: 1 }}>
                    <tr>
                      <th className="center"></th>
                      <th className="num">#</th><th className="num">תאריך</th><th>נכס</th><th className="center">פעולה</th>
                      <th className="num">כמות</th><th className="num">מחיר</th><th className="num">עמלה</th>
                      <th className="num">רווח/הפסד</th><th>סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalRows.map((row) => (
                      <tr key={row.rowNumber} style={row.error ? { background: "var(--loss-subtle)" } : undefined}>
                        <td className="center">
                          <input
                            type="checkbox" disabled={Boolean(row.error)}
                            checked={checkedRows.has(row.rowNumber) && !row.error}
                            onChange={() => toggleRow(row.rowNumber)}
                          />
                        </td>
                        <td className="num" style={{ color: "var(--text-faint)" }}>{row.rowNumber}</td>
                        <td className="num" style={{ color: "var(--text-dim)" }}>{row.date || "-"}</td>
                        <td style={{ fontWeight: 700 }}>{row.symbol || "-"}</td>
                        <td className="center">
                          {row.action ? (
                            <Badge tone={ACTION_TONE[row.action] || "amber"}>{row.action}</Badge>
                          ) : "-"}
                        </td>
                        <td className="num">{row.qty !== null ? row.qty : "-"}</td>
                        <td className="num">{row.price !== null ? fmtUSD(row.price, { digits: 2 }) : "-"}</td>
                        <td className="num" style={{ color: "var(--text-faint)" }}>{fmtUSD(row.fee)}</td>
                        <td className="num" style={{ color: "var(--text-faint)" }}>{row.pnlOverride !== null ? fmtUSD(row.pnlOverride) : "-"}</td>
                        <td style={{ maxWidth: 260 }}>
                          {row.error ? (
                            <span style={{ color: "var(--loss)", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                              <AlertTriangle size={12} style={{ flexShrink: 0 }} /> {row.error}
                            </span>
                          ) : (
                            <span style={{ color: "var(--gain)", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                              <CheckCircle2 size={12} /> תקין
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", padding: "16px 22px", borderTop: "1px solid var(--border)" }}>
          <div>
            {step !== "header" && table.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => setStep(
                  step === "preview" ? (openingNeeds.length > 0 ? "opening" : "mapping")
                  : step === "opening" ? "mapping"
                  : "header"
                )}
              >
                <ArrowRight size={14} /> חזור
              </Button>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={onClose}>ביטול</Button>
            {table.length > 0 && step === "header" && (
              <Button variant="primary" onClick={() => setStep("mapping")}>
                המשך <ArrowLeft size={14} />
              </Button>
            )}
            {table.length > 0 && step === "mapping" && (
              <Button
                variant="primary" disabled={!mappingValid}
                onClick={() => setStep(openingNeeds.length > 0 ? "opening" : "preview")}
              >
                המשך <ArrowLeft size={14} />
              </Button>
            )}
            {table.length > 0 && step === "opening" && (
              <Button variant="primary" disabled={!openingStepValid} onClick={() => setStep("preview")}>
                המשך לתצוגה מקדימה <ArrowLeft size={14} />
              </Button>
            )}
            {table.length > 0 && step === "preview" && (
              <Button variant="primary" disabled={checkedCount === 0} onClick={handleConfirm}>
                אישור והוספה ליומן ({checkedCount})
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
