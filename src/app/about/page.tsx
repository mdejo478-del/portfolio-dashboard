import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ListChecks, Rocket, ShieldAlert } from "lucide-react";

export const metadata: Metadata = {
  title: "אודות — IPMS",
};

export default function AboutPage() {
  return (
    <div dir="rtl" className="min-h-screen bg-[#0A0E13] px-4 py-8 sm:py-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[#8B98AB] hover:text-[#E8EDF2] transition-colors"
        >
          <ArrowRight size={16} />
          חזרה לדשבורד
        </Link>

        <div className="rounded-2xl border border-[#1F2A35] bg-[#10161D] p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="IPMS" className="h-10 w-10 flex-shrink-0 object-contain" />
            <div>
              <h1 className="text-lg font-extrabold text-[#E8EDF2]">מה זה IPMS?</h1>
              <p className="text-xs font-semibold text-[#8B98AB]">מערכת לניהול תיק השקעות</p>
            </div>
          </div>

          <p className="text-sm leading-7 text-[#B7C2CE]">
            IPMS היא מערכת אישית למעקב וניהול תיק השקעות.
            <br />
            המטרה: סדר, שקיפות ושליטה על העסקאות וההקצאות — במקום אקסל מפוזר.
          </p>

          <div className="my-6 h-px bg-[#1F2A35]" />

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#E8EDF2]">
              <ListChecks size={16} className="text-[#22D3A8]" />
              מה אפשר לעשות
            </h2>
            <ul className="space-y-2 text-sm leading-6 text-[#B7C2CE]">
              {[
                "ניהול פוזיציות ואחוזי אחזקה",
                "יומן מסחר מפורט",
                "מעקב אחרי מזומן, הפקדות ומשיכות",
                "עדכון מחירים",
                "תמונת מצב ברורה של התיק",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#22D3A8]" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <div className="my-6 h-px bg-[#1F2A35]" />

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#E8EDF2]">
              <Rocket size={16} className="text-[#22D3A8]" />
              איך מתחילים
            </h2>
            <ol className="space-y-2 text-sm leading-6 text-[#B7C2CE]">
              {[
                "נרשמים ומתחברים",
                "מאשרים את כתב הוויתור",
                "מוסיפים פוזיציות / עסקאות",
                "עוקבים אחרי התיק",
              ].map((item, i) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#141B23] border border-[#1F2A35] text-[11px] font-bold text-[#22D3A8]">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </section>

          <div className="my-6 h-px bg-[#1F2A35]" />

          <section className="rounded-lg border border-[#1F2A35] bg-[#141B23] p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-[#E8EDF2]">
              <ShieldAlert size={16} className="text-[#FF8589]" />
              חשוב לדעת
            </h2>
            <p className="text-sm leading-6 text-[#8B98AB]">
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
