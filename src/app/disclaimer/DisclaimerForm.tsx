"use client";

import { useState } from "react";
import { acceptDisclaimer } from "@/app/actions/auth";

export default function DisclaimerForm() {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-[#0A0E13] px-4 py-10">
      <div className="w-full max-w-2xl rounded-2xl border border-[#1F2A35] bg-[#10161D] p-8">
        <h1 className="text-xl font-bold text-[#E8EDF2] mb-6">כתב ויתור והצהרה משפטית</h1>

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-[#1F2A35] bg-[#141B23] p-5 text-sm leading-7 text-[#B7C2CE] space-y-4">
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

        <label className="mt-6 flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#22D3A8]"
          />
          <span className="text-sm font-medium text-[#E8EDF2]">קראתי והבנתי את כתב הוויתור</span>
        </label>

        <form
          action={acceptDisclaimer}
          onSubmit={() => setPending(true)}
        >
          <button
            type="submit"
            disabled={!confirmed || pending}
            className="mt-6 w-full rounded-lg bg-[#22D3A8] px-4 py-3 text-sm font-bold text-[#04342C] transition-colors hover:bg-[#2EE6BA] disabled:cursor-not-allowed disabled:bg-[#1F2A35] disabled:text-[#4E5A6B]"
          >
            {pending ? "מאשר..." : "אני מאשר וממשיך"}
          </button>
        </form>
      </div>
    </div>
  );
}
