"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { ValidationIssue } from "@/lib/validation";

const SHOWN = 5;

/** Lists data problems found in the current portfolio (see lib/validation.ts).
 * Informational only: a portfolio with such values still loads, shows and saves
 * (the server only refuses problems a save would newly introduce) - this just
 * makes them visible instead of silent. Dismissible until the next page load. */
export function DataIssuesBanner({ issues }: { issues: ValidationIssue[] }) {
  const [hidden, setHidden] = useState<boolean>(false);
  if (hidden || issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const counts = [errors > 0 ? errors + " חריגות" : "", warnings > 0 ? warnings + " אזהרות" : ""].filter(Boolean).join(" ו-");
  return (
    <div role="status" data-data-issues={issues.length} style={{
      display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", marginBottom: "var(--space-4)",
      background: "var(--warning-subtle)", border: "1px solid var(--warning-subtle-border)", borderRadius: "var(--radius-md)",
      fontSize: 12.5, lineHeight: 1.6, color: "var(--text)",
    }}>
      <AlertTriangle size={16} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: "var(--warning)" }}>נמצאו בנתוני התיק {counts} (לא חוסם את הטעינה או השמירה)</div>
        <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
          {issues.slice(0, SHOWN).map((i, idx) => <li key={i.key + ":" + idx}>{i.message}</li>)}
        </ul>
        {issues.length > SHOWN && <div style={{ color: "var(--text-dim)" }}>ועוד {issues.length - SHOWN}.</div>}
      </div>
      <button type="button" onClick={() => setHidden(true)} aria-label="הסתר" title="הסתר"
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", padding: 2, display: "flex" }}>
        <X size={14} />
      </button>
    </div>
  );
}
