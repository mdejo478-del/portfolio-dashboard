"use client";

import { useActionState } from "react";
import { verifyCode, type AuthFormState } from "@/app/actions/auth";

const initialState: AuthFormState = {};

export default function VerifyForm({ email, code }: { email: string; code: string }) {
  const [state, formAction, pending] = useActionState(verifyCode, initialState);

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-[#0A0E13] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#1F2A35] bg-[#10161D] p-8">
        <h1 className="text-xl font-bold text-[#E8EDF2] mb-1">אימות חשבון</h1>
        <p className="text-sm text-[#8B98AB] mb-6">
          נשלח קוד אימות בן 6 ספרות לכתובת{" "}
          <strong className="text-[#E8EDF2]">{email}</strong>
        </p>

        <div className="mb-6 rounded-lg border border-[#22D3A8] border-opacity-35 bg-[#22D3A8] bg-opacity-10 px-4 py-3 text-center">
          <div className="text-xs text-[#8B98AB] mb-1">קוד לדוגמה (בשלב זה אין שליחת מייל בפועל)</div>
          <div className="font-mono text-2xl font-bold tracking-[0.3em] text-[#5BE39D]">{code}</div>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div>
            <label htmlFor="code" className="block text-xs font-semibold text-[#8B98AB] mb-1.5">
              קוד אימות
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoComplete="one-time-code"
              className="w-full rounded-lg border border-[#1F2A35] bg-[#141B23] px-3 py-2.5 text-center text-lg tracking-[0.4em] text-[#E8EDF2] outline-none focus:border-[#22D3A8]"
            />
          </div>

          {state?.error && <p className="text-sm text-[#FF8589]">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-lg bg-[#22D3A8] px-4 py-2.5 text-sm font-bold text-[#04342C] hover:bg-[#2EE6BA] disabled:opacity-60"
          >
            {pending ? "מאמת..." : "אימות"}
          </button>
        </form>
      </div>
    </div>
  );
}
