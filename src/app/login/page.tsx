"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type AuthFormState } from "@/app/actions/auth";

const initialState: AuthFormState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-[#0A0E13] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#1F2A35] bg-[#10161D] p-8">
        <h1 className="text-xl font-bold text-[#E8EDF2] mb-1">התחברות</h1>
        <p className="text-sm text-[#8B98AB] mb-6">התחבר כדי לצפות בתיק ההשקעות שלך</p>

        <form action={formAction} className="flex flex-col gap-4">
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
              autoComplete="current-password"
              className="w-full rounded-lg border border-[#1F2A35] bg-[#141B23] px-3 py-2.5 text-base text-[#E8EDF2] outline-none focus:border-[#22D3A8]"
            />
          </div>

          {state?.error && <p className="text-sm text-[#FF8589]">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-lg bg-[#22D3A8] px-4 py-2.5 text-sm font-bold text-[#04342C] hover:bg-[#2EE6BA] disabled:opacity-60"
          >
            {pending ? "מתחבר..." : "התחברות"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#8B98AB]">
          אין לך חשבון?{" "}
          <Link href="/register" className="text-[#22D3A8] hover:underline">
            הרשמה
          </Link>
        </p>
      </div>
    </div>
  );
}
