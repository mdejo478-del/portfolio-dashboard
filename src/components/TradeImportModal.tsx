"use client";

import { X, AlertTriangle, CheckCircle2, FileWarning } from "lucide-react";
import type { ParseResult, ParsedTradeRow } from "@/lib/tradeImport";
import { fmtUSD } from "@/components/dashboard/format";
import { TONE_STYLES } from "@/components/dashboard/constants";
import type { Tone } from "@/components/dashboard/types";

const ACTION_TONE: Record<string, Tone> = {
  "קנייה": "green", "מכירה": "red", "הפקדה": "blue", "משיכה": "amber",
};

interface TradeImportModalProps {
  result: ParseResult;
  fileName: string;
  onConfirm: (rows: ParsedTradeRow[]) => void;
  onClose: () => void;
}

export default function TradeImportModal({ result, fileName, onConfirm, onClose }: TradeImportModalProps) {
  const validRows = result.rows.filter((r) => !r.error);
  const errorRows = result.rows.filter((r) => r.error);

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
          background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16,
          width: "min(920px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>תצוגה מקדימה — ייבוא עסקאות מקובץ</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 3 }}>{fileName}</div>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="סגור" title="סגור"><X size={16} /></button>
        </div>

        <div style={{ padding: 22, overflowY: "auto" }}>
          {result.fileError ? (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px",
              background: "rgba(255,90,95,0.1)", border: "1px solid rgba(255,90,95,0.35)", borderRadius: 10, color: "#FF8589", fontSize: 13.5, lineHeight: 1.6,
            }}>
              <FileWarning size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{result.fileError}</span>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#5BE39D", fontSize: 13, fontWeight: 700 }}>
                  <CheckCircle2 size={15} /> {validRows.length} עסקאות תקינות יתווספו ליומן
                </div>
                {errorRows.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#F5BE6B", fontSize: 13, fontWeight: 700 }}>
                    <AlertTriangle size={15} /> {errorRows.length} שורות עם שגיאה יידלגו
                  </div>
                )}
              </div>

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
                      <tr key={row.rowNumber} style={row.error ? { background: "rgba(255,90,95,0.06)" } : undefined}>
                        <td className="num" style={{ color: "var(--text-faint)" }}>{row.rowNumber}</td>
                        <td className="num" style={{ color: "var(--text-dim)" }}>{row.date || "-"}</td>
                        <td style={{ fontWeight: 700 }}>{row.symbol || "-"}</td>
                        <td className="center">
                          {row.action ? (
                            <span style={{
                              display: "inline-block", fontSize: 11.5, fontWeight: 700, borderRadius: 8, padding: "2px 8px",
                              background: TONE_STYLES[ACTION_TONE[row.action] || "amber"].bg,
                              border: "1px solid " + TONE_STYLES[ACTION_TONE[row.action] || "amber"].border,
                              color: TONE_STYLES[ACTION_TONE[row.action] || "amber"].text,
                            }}>{row.action}</span>
                          ) : "-"}
                        </td>
                        <td className="num">{row.qty !== null ? row.qty : "-"}</td>
                        <td className="num">{row.price !== null ? fmtUSD(row.price, { digits: 2 }) : "-"}</td>
                        <td className="num" style={{ color: "var(--text-faint)" }}>{fmtUSD(row.fee)}</td>
                        <td className="num" style={{ color: "var(--text-faint)" }}>{row.pnlOverride !== null ? fmtUSD(row.pnlOverride) : "-"}</td>
                        <td style={{ maxWidth: 260 }}>
                          {row.error ? (
                            <span style={{ color: "#FF8589", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                              <AlertTriangle size={12} style={{ flexShrink: 0 }} /> {row.error}
                            </span>
                          ) : (
                            <span style={{ color: "#5BE39D", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
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
          <button type="button" className="ghost" onClick={onClose}>ביטול</button>
          {!result.fileError && (
            <button
              type="button" className="primary" disabled={validRows.length === 0}
              onClick={() => onConfirm(validRows)}
              style={validRows.length === 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              אישור והוספה ליומן ({validRows.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
