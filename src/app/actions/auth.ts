"use server";

import { redirect } from "next/navigation";
import { createUser, verifyCredentials, findUserById, markUserVerified, markOnboardingCompleted, updatePassword } from "@/lib/users";
import {
  createSession, deleteSession, getSession,
  acceptDisclaimer as acceptDisclaimerSession,
  completeOnboarding as completeOnboardingSession,
} from "@/lib/session";
import {
  createPendingVerification,
  getPendingVerification,
  clearPendingVerification,
} from "@/lib/pendingVerification";
import { checkRateLimit, getClientIp, rateLimitMessage } from "@/lib/rateLimit";
import { notifyNewUserRegistration } from "@/lib/telegram";

export interface AuthFormState {
  error?: string;
}

export interface ChangePasswordState {
  error?: string;
  success?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_NAME_LEN = 100;
const MAX_PASSWORD_LEN = 200;
const CODE_RE = /^\d{6}$/;

export async function signup(
  _prevState: AuthFormState | undefined,
  formData: FormData
): Promise<AuthFormState> {
  const ip = await getClientIp();
  const ipLimit = checkRateLimit("signup:" + ip, 5, 60 * 60 * 1000); // 5 signups / hour / IP
  if (!ipLimit.allowed) return { error: rateLimitMessage(ipLimit.retryAfterSeconds) };

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!name || name.length > MAX_NAME_LEN) return { error: "נא להזין שם מלא תקין." };
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) return { error: "נא להזין כתובת אימייל תקינה." };
  if (password.length < 6 || password.length > MAX_PASSWORD_LEN) {
    return { error: "הסיסמה חייבת להכיל בין 6 ל-" + MAX_PASSWORD_LEN + " תווים." };
  }

  try {
    const user = await createUser(name, email, password);
    await createPendingVerification(user);
    notifyNewUserRegistration(user);
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
  const ip = await getClientIp();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  const ipLimit = checkRateLimit("login-ip:" + ip, 20, 10 * 60 * 1000); // 20 attempts / 10 min / IP
  if (!ipLimit.allowed) return { error: rateLimitMessage(ipLimit.retryAfterSeconds) };
  if (email) {
    const emailLimit = checkRateLimit("login-email:" + email, 8, 10 * 60 * 1000); // 8 attempts / 10 min / email
    if (!emailLimit.allowed) return { error: rateLimitMessage(emailLimit.retryAfterSeconds) };
  }

  if (!email || !password || email.length > MAX_EMAIL_LEN || password.length > MAX_PASSWORD_LEN) {
    return { error: "נא להזין אימייל וסיסמה." };
  }

  const user = await verifyCredentials(email, password);
  if (!user) return { error: "אימייל או סיסמה שגויים." };

  if (!user.verified) {
    await createPendingVerification(user);
    redirect("/verify?reason=login");
  }

  await createSession(user);
  redirect("/");
}

export async function verifyCode(
  _prevState: AuthFormState | undefined,
  formData: FormData
): Promise<AuthFormState> {
  const ip = await getClientIp();
  const ipLimit = checkRateLimit("verify:" + ip, 10, 15 * 60 * 1000); // 10 attempts / 15 min / IP
  if (!ipLimit.allowed) return { error: rateLimitMessage(ipLimit.retryAfterSeconds) };

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

  if (!CODE_RE.test(code) || code !== user.verificationCode) {
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

export async function completeOnboarding(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");

  await markOnboardingCompleted(session.userId);
  await completeOnboardingSession(session);
  // No redirect() here - it doesn't reliably reach the client when the action
  // is invoked directly from an event handler instead of a <form> submission
  // (see the requireSession comment in dal.ts). The caller navigates itself
  // once this resolves.
}

export async function changePassword(
  _prevState: ChangePasswordState | undefined,
  formData: FormData
): Promise<ChangePasswordState> {
  const session = await getSession();
  if (!session) redirect("/login");

  // Rate-limited per account (not just IP) - this endpoint lets someone probe
  // the current password, so it needs the same brute-force protection as login.
  const limit = checkRateLimit("change-password:" + session.userId, 8, 10 * 60 * 1000);
  if (!limit.allowed) return { error: rateLimitMessage(limit.retryAfterSeconds) };

  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "נא למלא את כל השדות." };
  }
  if (newPassword.length < 6 || newPassword.length > MAX_PASSWORD_LEN) {
    return { error: "הסיסמה החדשה חייבת להכיל בין 6 ל-" + MAX_PASSWORD_LEN + " תווים." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "הסיסמה החדשה ואימות הסיסמה אינם תואמים." };
  }

  const result = await updatePassword(session.userId, currentPassword, newPassword);
  if (result === "WRONG_PASSWORD") return { error: "הסיסמה הנוכחית שגויה." };
  if (result === "NOT_FOUND") return { error: "אירעה שגיאה. נסה שוב." };

  return { success: true };
}
