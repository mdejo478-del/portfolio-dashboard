"use server";

import { redirect } from "next/navigation";
import { createUser, verifyCredentials, findUserById, markUserVerified } from "@/lib/users";
import { createSession, deleteSession, getSession, acceptDisclaimer as acceptDisclaimerSession } from "@/lib/session";
import {
  createPendingVerification,
  getPendingVerification,
  clearPendingVerification,
} from "@/lib/pendingVerification";

export interface AuthFormState {
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signup(
  _prevState: AuthFormState | undefined,
  formData: FormData
): Promise<AuthFormState> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!name) return { error: "נא להזין שם מלא." };
  if (!email || !EMAIL_RE.test(email)) return { error: "נא להזין כתובת אימייל תקינה." };
  if (password.length < 6) return { error: "הסיסמה חייבת להכיל לפחות 6 תווים." };

  try {
    const user = await createUser(name, email, password);
    await createPendingVerification(user);
  } catch (err) {
    if (err instanceof Error && err.message === "EMAIL_TAKEN") {
      return { error: "קיים כבר משתמש עם כתובת האימייל הזו." };
    }
    return { error: "אירעה שגיאה. נסה שוב." };
  }

  redirect("/verify");
}

export async function login(
  _prevState: AuthFormState | undefined,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) return { error: "נא להזין אימייל וסיסמה." };

  const user = await verifyCredentials(email, password);
  if (!user) return { error: "אימייל או סיסמה שגויים." };

  if (!user.verified) {
    await createPendingVerification(user);
    redirect("/verify");
  }

  await createSession(user);
  redirect("/");
}

export async function verifyCode(
  _prevState: AuthFormState | undefined,
  formData: FormData
): Promise<AuthFormState> {
  const code = String(formData.get("code") || "").trim();

  const pending = await getPendingVerification();
  if (!pending) {
    return { error: "פג תוקף תהליך האימות. נא להתחבר שוב כדי לקבל קוד חדש." };
  }

  const user = await findUserById(pending.userId);
  if (!user) {
    await clearPendingVerification();
    return { error: "המשתמש לא נמצא." };
  }

  if (user.verified) {
    await clearPendingVerification();
    redirect("/login");
  }

  if (!code || code !== user.verificationCode) {
    return { error: "קוד האימות שגוי." };
  }

  await markUserVerified(user.id);
  await clearPendingVerification();
  redirect("/login");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}

export async function acceptDisclaimer(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");

  await acceptDisclaimerSession(session);
  redirect("/");
}
