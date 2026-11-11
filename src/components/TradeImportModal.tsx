"use client";

import { useState } from "react";
import { X, AlertTriangle, CheckCircle2, FileWarning } from "lucide-react";
import type { ParseResult, ParsedTradeRow } from "@/lib/tradeImport";
import { countPositiveFees, effectiveFee } from "@/lib/importFees";
import { formatMoney } from "@/components/dashboard/format";
import type { Tone } from "@/components/dashboard/types";
import { Badge } from "@/components/dashboard/ui/Badge";
import { Button } from "@/components/dashboard/ui/Button";

const ACTION_TONE: Record<string, Tone> = {
  "קנייה": "green", "מכירה": "red", "הפקדה": "blue", "משיכה": "amber", "אחר": "blue",
};

interface TradeImportModalProps {
  result: ParseResult;
  fileName: string;
  privacyMode: boolean;
  /** Row numbers of valid rows already present in the journal - shown as
   * "will be skipped"; onConfirm still receives every valid row and the caller
   * drops those, so the preview and the import can't disagree. */
  duplicateRowNumbers?: Set<number>;
  /** `convertPositiveFees`: store a positive fee from the file as a negative one (a cost). */
  onConfirm: (rows: ParsedTradeRow[], options: { convertPositiveFees: boolean }) => void;
  onClose: () => void;
}

export default function TradeImportModal({ result, fileName, privacyMode, duplicateRowNumbers, onConfirm, onClose }: TradeImportModalProps) {
  const validRows = result.rows.filter((r) => !r.error);
  const errorRows = result.rows.filter((r) => r.error);
  const isDuplicate = (r: ParsedTradeRow) => !r.error && !!duplicateRowNumbers && duplicateRowNumbers.has(r.rowNumber);
  const duplicateCount = validRows.filter(isDuplicate).length;
  const newCount = validRows.length - duplicateCount;
  // Fees are stored as negative numbers (a cost). A file that lists a commission as a
  // positive number would otherwise INCREASE cash - so positive fees are converted
  // unless the user switches that off. Only rows that will actually be imported count.
  const [convertFees, setConvertFees] = useState<boolean>(true);
  const positiveFeeCount = countPositiveFees(validRows.filter((r) => !isDuplicate(r)));

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
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>תצוגה מקדימה — ייבוא עסקאות מקובץ</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 3 }}>{fileName}</div>
          </div>
          <Button variant="icon" onClick={onClose} aria-label="סגור" title="סגור"><X size={16} /></Button>
        </div>

        <div style={{ padding: 22, overflowY: "auto" }}>
          {result.fileError ? (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px",
              background: "var(--loss-subtle)", border: "1px solid var(--loss-subtle-border)", borderRadius: "var(--radius-md)", color: "var(--loss)", fontSize: 13.5, lineHeight: 1.6,
            }}>
              <FileWarning size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{result.fileError}</span>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--gain)", fontSize: 13, fontWeight: 700 }}>
                  <CheckCircle2 size={15} /> {newCount} עסקאות חדשות יתווספו ליומן
                </div>
                {positiveFeeCount > 0 && (
                  <div data-positive-fees={positiveFeeCount} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--warning)", fontSize: 13, fontWeight: 700 }}>
                    <AlertTriangle size={15} />
                    {convertFees
                      ? positiveFeeCount + " שורות עם עמלה חיובית – יומרו לשליליות"
                      : positiveFeeCount + " שורות עם עמלה חיובית – ייובאו כפי שהן (העמלה תגדיל את המזומן)"}
                  </div>
                )}
                {duplicateCount > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--warning)", fontSize: 13, fontWeight: 700 }}>
                    <AlertTriangle size={15} /> {duplicateCount} שורות כבר קיימות ביומן – ידולגו
                  </div>
                )}
                {errorRows.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--warning)", fontSize: 13, fontWeight: 700 }}>
                    <AlertTriangle size={15} /> {errorRows.length} שורות עם שגיאה יידלגו
                  </div>
                )}
              </div>

              {positiveFeeCount > 0 && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.6, marginBottom: "var(--space-4)", cursor: "pointer" }}>
                  <input type="checkbox" checked={convertFees} onChange={(e) => setConvertFees(e.target.checked)} style={{ marginTop: 4 }} />
                  <span>המר עמלות חיוביות לשליליות. עמלה נרשמת ביומן כמספר שלילי (עלות); עמלה חיובית הייתה מגדילה את המזומן במקום להקטין אותו. עסקאות שכבר ביומן לא משתנות.</span>
                </label>
              )}
              <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "auto", maxHeight: "48vh" }}>
                <table>
                  <thead style={{ position: "sticky", top: 0, background: "var(--panel-2)", zIndex: 1 }}>
                    <tr>
                      <th className="num">#</th><th className="num">תאריך</th><th>נכס</th><th className="center">פעולה</th>
                      <th className="num">כמות</th><th className="num">מחיר</th><th className="num">עמלה</th>
                      <th className="num">רווח/הפסד</th><th>סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.rowNumber} style={row.error ? { background: "var(--loss-subtle)" } : undefined}>
                        <td className="num" style={{ color: "var(--text-faint)" }}>{row.rowNumber}</td>
                        <td className="num" style={{ color: "var(--text-dim)" }}>{row.date || "-"}</td>
                        <td style={{ fontWeight: 700 }}>{row.symbol || "-"}</td>
                        <td className="center">
                          {row.action ? (
                            <Badge tone={ACTION_TONE[row.action] || "amber"}>{row.action}</Badge>
                          ) : "-"}
                        </td>
                        <td className="num">{row.qty !== null ? row.qty : "-"}</td>
                        <td className="num">{row.price !== null ? formatMoney(row.price, privacyMode, { digits: 2 }) : "-"}</td>
                        <td className="num" style={{ color: "var(--text-faint)" }}
                          title={convertFees && !row.error && row.fee > 0 ? "הקובץ: " + formatMoney(row.fee, privacyMode) + " - יומר לשלילי" : undefined}>
                          {formatMoney(effectiveFee(row.fee, convertFees && !row.error), privacyMode)}
                        </td>
                        <td className="num" style={{ color: "var(--text-faint)" }}>{row.pnlOverride !== null ? formatMoney(row.pnlOverride, privacyMode) : "-"}</td>
                        <td style={{ maxWidth: 260 }}>
                          {row.error ? (
                            <span style={{ color: "var(--loss)", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                              <AlertTriangle size={12} style={{ flexShrink: 0 }} /> {row.error}
                            </span>
                          ) : isDuplicate(row) ? (
                            <span style={{ color: "var(--warning)", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                              <AlertTriangle size={12} style={{ flexShrink: 0 }} /> כבר קיים ביומן – ידולג
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

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "16px 22px", borderTop: "1px solid var(--border)" }}>
          <Button variant="ghost" onClick={onClose}>ביטול</Button>
          {!result.fileError && (
            <Button
              variant="primary" disabled={newCount === 0}
              onClick={() => onConfirm(validRows, { convertPositiveFees: convertFees })}
            >
              אישור והוספה ליומן ({newCount})
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
