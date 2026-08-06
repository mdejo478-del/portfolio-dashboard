"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signup, type AuthFormState } from "@/app/actions/auth";

const initialState: AuthFormState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-[#0A0E13] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#1F2A35] bg-[#10161D] p-8">
        <h1 className="text-xl font-bold text-[#E8EDF2] mb-1">הרשמה</h1>
        <p className="text-sm text-[#8B98AB] mb-6">צור חשבון כדי לנהל את תיק ההשקעות שלך</p>

        <form action={formAction} className="flex flex-col gap-4">
          <div>
            <label htmlFor="name" className="block text-xs font-semibold text-[#8B98AB] mb-1.5">
              שם מלא
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoComplete="name"
              className="w-full rounded-lg border border-[#1F2A35] bg-[#141B23] px-3 py-2.5 text-base text-[#E8EDF2] outline-none focus:border-[#22D3A8]"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-[#8B98AB] mb-1.5">
              אימייל
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-[#1F2A35] bg-[#141B23] px-3 py-2.5 text-base text-[#E8EDF2] outline-none focus:border-[#22D3A8]"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-[#8B98AB] mb-1.5">
              סיסמה
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={6}
              className="w-full rounded-lg border border-[#1F2A35] bg-[#141B23] px-3 py-2.5 text-base text-[#E8EDF2] outline-none focus:border-[#22D3A8]"
            />
            <p className="mt-1 text-xs text-[#4E5A6B]">לפחות 6 תווים</p>
          </div>

          {state?.error && <p className="text-sm text-[#FF8589]">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-lg bg-[#22D3A8] px-4 py-2.5 text-sm font-bold text-[#04342C] hover:bg-[#2EE6BA] disabled:opacity-60"
          >
            {pending ? "יוצר חשבון..." : "הרשמה"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#8B98AB]">
          כבר יש לך חשבון?{" "}
          <Link href="/login" className="text-[#22D3A8] hover:underline">
            התחברות
          </Link>
        </p>
      </div>
    </div>
  );
}
