"use client";

import { useState } from "react";
import { acceptDisclaimer } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth/AuthShell";

export default function DisclaimerForm() {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <AuthShell maxWidth={672}>
      <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 800, color: "var(--text)", margin: 0, marginBottom: "var(--space-6)" }}>
        כתב ויתור והצהרה משפטית
      </h1>

      <div style={{
        maxHeight: "55vh", overflowY: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
        background: "var(--panel-2)", padding: "var(--space-5)", fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)",
        color: "var(--text-dim)", display: "flex", flexDirection: "column", gap: "var(--space-4)",
      }}>
        <p>
          הכלי מיועד לצורכי מעקב אישי, ניהול תיק השקעות ולימוד בלבד.
        </p>
        <p>
          המידע, הנתונים, החישובים, הגרפים, ההתראות והסטטוסים המוצגים במערכת נועדו לספק מידע
          טכני בלבד ואינם מהווים ייעוץ השקעות, ייעוץ פיננסי, ייעוץ מס, ייעוץ משפטי או כל ייעוץ
          מקצועי אחר.
        </p>
        <p>
          המערכת אינה ממליצה על קנייה, מכירה, החזקה, דילול, הגדלת פוזיציה או ביצוע כל פעולה
          בניירות ערך, מטבעות דיגיטליים או כל נכס פיננסי אחר.
        </p>
        <p>
          כל חיווי, התראה או סטטוס (לרבות &quot;תקין&quot;, &quot;דורש חיזוק&quot;, &quot;מעל היעד&quot;, &quot;חובה לדלל&quot;,
          &quot;להחזיק&quot;, &quot;Priority Buy&quot; וכדומה) מחושבים באופן אוטומטי על בסיס כללים, יעדי הקצאה
          והגדרות שהוזנו על-ידי המשתמש בלבד, ואינם מבטאים המלצה, שיקול דעת מקצועי או הערכת
          כדאיות השקעה.
        </p>
        <p>
          הנתונים המוצגים במערכת עשויים להיות חלקיים, לא מעודכנים או להכיל שגיאות חישוב, הזנת
          נתונים או תקלות טכניות. המשתמש אחראי באופן בלעדי לוודא את נכונות הנתונים לפני קבלת כל
          החלטה.
        </p>
        <p>
          כל החלטת השקעה, מסחר או פעולה פיננסית שתתקבל בעקבות השימוש במערכת היא באחריותו
          הבלעדית של המשתמש. אין להסתמך על המידע המוצג במערכת כתחליף לשיקול דעת עצמאי או
          לייעוץ מקצועי מתאים.
        </p>
        <p>
          יוצר המערכת, מפתחיה וכל גורם הקשור אליה אינם נושאים בכל אחריות, במישרין או בעקיפין,
          לכל הפסד, נזק, אובדן רווח, חבות או הוצאה מכל סוג שייגרמו כתוצאה מהשימוש במערכת,
          מהסתמכות על המידע המוצג בה או מביצוע פעולות השקעה בעקבותיו.
        </p>
        <p>
          עצם השימוש במערכת מהווה אישור מצד המשתמש כי קרא, הבין והסכים לאמור בהצהרה זו.
        </p>
      </div>

      <label style={{ marginTop: "var(--space-6)", display: "flex", alignItems: "flex-start", gap: "var(--space-3)", cursor: "pointer", userSelect: "none" }}>
        <input
          type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
          style={{ marginTop: 2, flexShrink: 0, width: 16, height: 16, accentColor: "var(--accent)" }}
        />
        <span style={{ fontSize: "var(--font-size-base)", fontWeight: 600, color: "var(--text)" }}>קראתי והבנתי את כתב הוויתור</span>
      </label>

      <form action={acceptDisclaimer} onSubmit={() => setPending(true)}>
        <button
          type="submit" disabled={!confirmed || pending}
          className="auth-btn-primary"
          style={{
            marginTop: "var(--space-6)", width: "100%", borderRadius: "var(--radius-sm)",
            background: !confirmed || pending ? "var(--border)" : "var(--accent)",
            color: !confirmed || pending ? "var(--text-faint)" : "var(--accent-on)",
            padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-size-base)", fontWeight: 700,
            border: "none", cursor: !confirmed || pending ? "not-allowed" : "pointer", opacity: 1,
          }}
        >
          {pending ? "מאשר..." : "אני מאשר וממשיך"}
        </button>
      </form>
    </AuthShell>
  );
}
