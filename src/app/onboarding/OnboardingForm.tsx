"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Sparkles, Wallet, ListChecks } from "lucide-react";
import { completeOnboarding } from "@/app/actions/auth";

interface Step {
  icon: ReactNode;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    icon: <Sparkles size={26} />,
    title: "ברוך הבא ל-IPMS",
    description: "מעקב אישי לתיק השקעות.",
  },
  {
    icon: <Wallet size={26} />,
    title: "מתחילים",
    description: "התחל בהוספת פוזיציה או הפקדת מזומן.",
  },
  {
    icon: <ListChecks size={26} />,
    title: "יומן מסחר חכם",
    description: "כל העסקאות נשמרות ביומן המסחר, כולל עמלות ורווח/הפסד.",
  },
];

export default function OnboardingForm() {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function finish() {
    startTransition(async () => {
      await completeOnboarding();
      window.location.assign("/");
    });
  }

  function next() {
    if (isLast) finish();
    else setStep((s) => s + 1);
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-[#0A0E13] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#1F2A35] bg-[#10161D] p-8">
        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 rounded-full transition-all " +
                (i === step ? "w-7 bg-[#22D3A8]" : "w-1.5 bg-[#1F2A35]")
              }
            />
          ))}
        </div>

        <div className="flex flex-col items-center text-center gap-4 mb-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#22D3A8]/12 text-[#22D3A8]">
            {current.icon}
          </div>
          <h1 className="text-xl font-bold text-[#E8EDF2]">{current.title}</h1>
          <p className="text-sm leading-relaxed text-[#8B98AB]">{current.description}</p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={finish}
            disabled={pending}
            className="flex-1 rounded-lg border border-[#1F2A35] bg-transparent px-4 py-2.5 text-sm font-semibold text-[#8B98AB] hover:border-[#8B98AB] hover:text-[#E8EDF2] disabled:opacity-60"
          >
            דלג
          </button>
          <button
            type="button"
            onClick={next}
            disabled={pending}
            className="flex-1 rounded-lg bg-[#22D3A8] px-4 py-2.5 text-sm font-bold text-[#04342C] hover:bg-[#2EE6BA] disabled:opacity-60"
          >
            {pending ? "רגע..." : isLast ? "התחל" : "הבא"}
          </button>
        </div>
      </div>
    </div>
  );
}
