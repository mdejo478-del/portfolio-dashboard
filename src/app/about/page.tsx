import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ListChecks, Rocket, ShieldAlert } from "lucide-react";

export const metadata: Metadata = {
  title: "אודות — IPMS",
};

const dividerStyle = { margin: "var(--space-6) 0", height: 1, background: "var(--border)" };
const sectionTitleStyle = {
  marginBottom: "var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-2)",
  fontSize: "var(--font-size-base)", fontWeight: 700, color: "var(--text)",
};
const bodyListStyle = { display: "flex", flexDirection: "column" as const, gap: "var(--space-2)", fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--text-dim)" };

export default function AboutPage() {
  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "var(--bg)", padding: "var(--space-8) var(--space-4)" }}>
      <style>{`
        .about-back-link { transition: color 140ms ease; }
        .about-back-link:hover { color: var(--text); }
      `}</style>
      <div style={{ margin: "0 auto", width: "100%", maxWidth: 672 }}>
        <Link
          href="/"
          className="about-back-link"
          style={{
            marginBottom: "var(--space-6)", display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
            fontSize: "var(--font-size-base)", color: "var(--text-dim)", textDecoration: "none",
          }}
        >
          <ArrowRight size={16} />
          חזרה לדשבורד
        </Link>

        <div style={{ borderRadius: "var(--radius-xl)", border: "1px solid var(--border)", background: "var(--panel)", padding: "var(--space-6) var(--space-8)" }}>
          <div style={{ marginBottom: "var(--space-6)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="IPMS" style={{ height: 40, width: 40, flexShrink: 0, objectFit: "contain" }} />
            <div>
              <h1 style={{ fontSize: "var(--font-size-md)", fontWeight: 700, color: "var(--text)", margin: 0 }}>מה זה IPMS?</h1>
              <p style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--text-dim)", margin: 0 }}>מערכת לניהול תיק השקעות</p>
            </div>
          </div>

          <p style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--text-dim)" }}>
            IPMS היא מערכת אישית למעקב וניהול תיק השקעות.
            <br />
            המטרה: סדר, שקיפות ושליטה על העסקאות וההקצאות — במקום אקסל מפוזר.
          </p>

          <div style={dividerStyle} />

          <section>
            <h2 style={sectionTitleStyle}>
              <ListChecks size={16} color="var(--accent)" />
              מה אפשר לעשות
            </h2>
            <ul style={{ ...bodyListStyle, listStyle: "none", margin: 0, padding: 0 }}>
              {[
                "ניהול פוזיציות ואחוזי אחזקה",
                "יומן מסחר מפורט",
                "מעקב אחרי מזומן, הפקדות ומשיכות",
                "עדכון מחירים",
                "תמונת מצב ברורה של התיק",
              ].map((item) => (
                <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                  <span style={{ marginTop: "var(--space-2)", height: 6, width: 6, flexShrink: 0, borderRadius: "var(--radius-full)", background: "var(--accent)" }} />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <div style={dividerStyle} />

          <section>
            <h2 style={sectionTitleStyle}>
              <Rocket size={16} color="var(--accent)" />
              איך מתחילים
            </h2>
            <ol style={{ ...bodyListStyle, listStyle: "none", margin: 0, padding: 0 }}>
              {[
                "נרשמים ומתחברים",
                "מאשרים את כתב הוויתור",
                "מוסיפים פוזיציות / עסקאות",
                "עוקבים אחרי התיק",
              ].map((item, i) => (
                <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
                  <span style={{
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    height: 20, width: 20, borderRadius: "var(--radius-full)", background: "var(--panel-2)",
                    border: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--accent)",
                  }}>
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </section>

          <div style={dividerStyle} />

          <section style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--panel-2)", padding: "var(--space-4)" }}>
            <h2 style={sectionTitleStyle}>
              <ShieldAlert size={16} color="var(--loss)" />
              חשוב לדעת
            </h2>
            <p style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--text-dim)", margin: 0 }}>
              הכלי מיועד למעקב אישי ולימודי בלבד.
              <br />
              אינו ייעוץ השקעות ואינו המלצה לקנייה, מכירה או דילול.
              <br />
              כל החלטה היא באחריות המשתמש בלבד.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
