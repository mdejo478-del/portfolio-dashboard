"use server";

import { redirect } from "next/navigation";
import {
  createUser, verifyCredentials, findUserById, findUserByEmail, markUserVerified,
  markOnboardingCompleted, updatePassword, resetPasswordWithToken, deleteUser, invalidateAllSessions,
} from "@/lib/users";
import {
  createSession, deleteSession, getSession, refreshSession,
  acceptDisclaimer as acceptDisclaimerSession,
  completeOnboarding as completeOnboardingSession,
} from "@/lib/session";
import {
  createPendingVerification,
  getPendingVerification,
  clearPendingVerification,
} from "@/lib/pendingVerification";
import { createPasswordResetToken, decodePasswordResetToken } from "@/lib/passwordReset";
import { checkRateLimit, getClientIp, rateLimitMessage, checkLoginLock, recordLoginFailure, resetLoginFailures } from "@/lib/rateLimit";
import { notifyNewUserRegistration } from "@/lib/telegram";
import { sendPasswordResetEmail } from "@/lib/email";
import { deletePortfolio } from "@/lib/portfolio";
import { deleteUserPortfolioBackups } from "@/lib/backup";

export interface AuthFormState {
  error?: string;
}

export interface ChangePasswordState {
  error?: string;
  success?: boolean;
}

export interface RequestPasswordResetState {
  error?: string;
  success?: boolean;
}

export interface ResetPasswordState {
  error?: string;
  // Only ever set in the rare case the password WAS reset but the follow-up
  // auto-login hit an unexpected error - redirect() handles the normal
  // success path directly, so the form never needs to render a "success"
  // state for that case.
  resetButLoginFailed?: boolean;
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
    // Not calling sendVerificationEmail here (still defined in lib/email.ts,
    // deliberately unused for now): RESEND_FROM_EMAIL isn't configured yet
    // (no domain), so the send would silently no-op and a new signup would
    // have no way at all to see their code - VerifyForm below still shows
    // it on-screen instead, until email is actually wired back in.
  } catch (err) {
    if (err instanceof Error && err.message === "EMAIL_TAKEN") {
      // Deliberately not "this email is already registered" - that lets
      // anyone enumerate which addresses have accounts here just by trying
      // to sign up with them.
      return { error: "לא ניתן להשלים את ההרשמה עם הפרטים שסופקו. אם כבר יש לך חשבון, נסה להתחבר." };
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

  const ipKey = "login-ip:" + ip;
  const emailKey = email ? "login-email:" + email : null;

  // 5 failed attempts / 10 min for the same email or IP triggers a 5-minute
  // lockout. Only failures count (checked here, recorded below on a bad
  // password) so legitimate users who get it right on attempt 1 are never
  // affected, and a successful login clears the bucket entirely.
  const ipLock = checkLoginLock(ipKey);
  if (!ipLock.allowed) return { error: rateLimitMessage(ipLock.retryAfterSeconds) };
  if (emailKey) {
    const emailLock = checkLoginLock(emailKey);
    if (!emailLock.allowed) return { error: rateLimitMessage(emailLock.retryAfterSeconds) };
  }

  if (!email || !password || email.length > MAX_EMAIL_LEN || password.length > MAX_PASSWORD_LEN) {
    return { error: "נא להזין אימייל וסיסמה." };
  }

  let user: Awaited<ReturnType<typeof verifyCredentials>>;
  try {
    user = await verifyCredentials(email, password);
  } catch {
    return { error: "אירעה שגיאה. נסה שוב." };
  }
  if (!user) {
    const ipResult = recordLoginFailure(ipKey);
    const emailResult = emailKey ? recordLoginFailure(emailKey) : { allowed: true, retryAfterSeconds: 0 };
    if (!ipResult.allowed || !emailResult.allowed) {
      return { error: rateLimitMessage(Math.max(ipResult.retryAfterSeconds, emailResult.retryAfterSeconds)) };
    }
    return { error: "אימייל או סיסמה שגויים." };
  }

  resetLoginFailures(ipKey);
  if (emailKey) resetLoginFailures(emailKey);

  if (!user.verified) {
    try {
      await createPendingVerification(user);
    } catch {
      return { error: "אירעה שגיאה. נסה שוב." };
    }
    // This branch is reachable with a CORRECT password (an attacker who has
    // it, or a real user just retrying), so unlike the wrong-password path
    // above it never touches checkLoginLock. Kept independent of whether
    // sendVerificationEmail is actually wired up below (it isn't right
    // now - see the comment in signup() - VerifyForm shows the code
    // on-screen instead): without a limit here, this would still be an
    // easy way to force-refresh the pending-verification cookie
    // repeatedly, and once email sending resumes, it'd be a way to
    // email-bomb the account's inbox or burn through the Resend quota.
    // Rate-limited by user id (not IP - the caller already needs the
    // correct password to reach here at all).
    checkRateLimit("verify-resend:" + user.id, 3, 15 * 60 * 1000);
    redirect("/verify?reason=login");
  }

  try {
    await createSession(user);
  } catch {
    return { error: "אירעה שגיאה. נסה שוב." };
  }
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

  let pending: Awaited<ReturnType<typeof getPendingVerification>> = null;
  let user: Awaited<ReturnType<typeof findUserById>> = undefined;
  try {
    pending = await getPendingVerification();
    if (pending) user = await findUserById(pending.userId);
  } catch {
    return { error: "אירעה שגיאה. נסה שוב." };
  }

  if (!pending) {
    return { error: "פג תוקף תהליך האימות. נא להתחבר שוב כדי לקבל קוד חדש." };
  }

  if (!user) {
    try {
      await clearPendingVerification();
    } catch {
      return { error: "אירעה שגיאה. נסה שוב." };
    }
    return { error: "המשתמש לא נמצא." };
  }

  if (user.verified) {
    try {
      await clearPendingVerification();
    } catch {
      return { error: "אירעה שגיאה. נסה שוב." };
    }
    redirect("/login");
  }

  if (!CODE_RE.test(code) || code !== user.verificationCode) {
    return { error: "קוד האימות שגוי." };
  }

  try {
    await markUserVerified(user.id);
    await clearPendingVerification();
  } catch {
    return { error: "אירעה שגיאה. נסה שוב." };
  }
  redirect("/login");
}

export async function requestPasswordReset(
  _prevState: RequestPasswordResetState | undefined,
  formData: FormData
): Promise<RequestPasswordResetState> {
  const ip = await getClientIp();
  const email = String(formData.get("email") || "").trim().toLowerCase();

  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return { error: "נא להזין כתובת אימייל תקינה." };
  }

  // Rate-limited by IP AND by the submitted email itself - the email bucket
  // is touched here, before the lookup below, regardless of whether an
  // account actually exists for it. That's deliberate: if it were only
  // touched for real accounts, getting rate-limited would itself leak that
  // the address is registered - the one thing this whole flow is built to
  // never reveal (see the comment on the always-identical return below).
  const ipLimit = checkRateLimit("reset-request-ip:" + ip, 8, 60 * 60 * 1000);
  const emailLimit = checkRateLimit("reset-request-email:" + email, 3, 60 * 60 * 1000);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return { error: rateLimitMessage(Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds)) };
  }

  try {
    const user = await findUserByEmail(email);
    if (user) {
      const token = createPasswordResetToken(user);
      const base = process.env.APP_BASE_URL || "http://localhost:3000";
      const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;
      sendPasswordResetEmail(user.email, resetUrl);
    }
  } catch {
    // Swallowed on purpose - see below, the response must never differ
    // based on what happened here.
  }

  // Always the same response whether or not an account exists for this
  // email, and whether or not the send itself actually succeeded - this,
  // not the rate limiter above, is the real anti-enumeration protection.
  // Matches signup's own "vague on purpose" EMAIL_TAKEN handling elsewhere
  // in this file.
  return { success: true };
}

export async function resetPassword(
  _prevState: ResetPasswordState | undefined,
  formData: FormData
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  const payload = decodePasswordResetToken(token);
  if (!payload) {
    return { error: "קישור האיפוס אינו תקין או שפג תוקפו. בקש קישור חדש." };
  }

  if (newPassword.length < 6 || newPassword.length > MAX_PASSWORD_LEN) {
    return { error: "הסיסמה חייבת להכיל בין 6 ל-" + MAX_PASSWORD_LEN + " תווים." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "הסיסמה החדשה ואימות הסיסמה אינם תואמים." };
  }

  let result: Awaited<ReturnType<typeof resetPasswordWithToken>>;
  try {
    result = await resetPasswordWithToken(payload.userId, payload.iat, newPassword);
  } catch {
    return { error: "אירעה שגיאה. נסה שוב." };
  }
  if (result === "NOT_FOUND") return { error: "החשבון לא נמצא." };
  if (result === "TOKEN_ALREADY_USED") return { error: "קישור האיפוס כבר נוצל או שאינו תקף יותר. בקש קישור חדש." };

  // The token already proved control of the account's email - auto-login
  // rather than sending the user back to /login to type the password they
  // just chose.
  try {
    const user = await findUserById(payload.userId);
    if (user) await createSession(user);
  } catch {
    // The password WAS reset successfully at this point - a session-cookie
    // hiccup shouldn't be reported as a failed reset. The user can still
    // log in normally with the new password.
    return { resetButLoginFailed: true };
  }
  redirect("/");
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

  let result: Awaited<ReturnType<typeof updatePassword>>;
  try {
    result = await updatePassword(session.userId, currentPassword, newPassword);
  } catch {
    return { error: "אירעה שגיאה. נסה שוב." };
  }
  if (result === "WRONG_PASSWORD") return { error: "הסיסמה הנוכחית שגויה." };
  if (result === "NOT_FOUND") return { error: "אירעה שגיאה. נסה שוב." };

  // Changing the password should kill any other active session (e.g. one an
  // attacker who had the old password is holding). Bump the cutoff, then
  // immediately re-issue a fresh token for this device so the person who
  // just did this isn't logged out too.
  try {
    await invalidateAllSessions(session.userId);
    await refreshSession(session);
  } catch {
    return { error: "אירעה שגיאה. נסה שוב." };
  }

  return { success: true };
}

export async function logoutAllDevices(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");

  await invalidateAllSessions(session.userId);
  await deleteSession();
  redirect("/login");
}

export async function deleteAccount(
  _prevState: AuthFormState | undefined,
  formData: FormData
): Promise<AuthFormState> {
  const session = await getSession();
  if (!session) redirect("/login");

  const confirmText = String(formData.get("confirmText") || "").trim();
  if (confirmText.toUpperCase() !== "DELETE" && confirmText !== "מחק") {
    return { error: 'יש להקליד DELETE או "מחק" כדי לאשר את המחיקה.' };
  }

  // Portfolio + its backup snapshots first, then the user record itself -
  // if something fails partway, better to have leftover portfolio data for
  // a user that no longer exists (harmless, orphaned) than a deleted
  // portfolio still attached to a user who can log back in and be confused
  // by an empty account.
  try {
    await deletePortfolio(session.userId);
    await deleteUserPortfolioBackups(session.userId);
    await deleteUser(session.userId);
    await deleteSession();
  } catch {
    return { error: "אירעה שגיאה. נסה שוב." };
  }
  redirect("/login");
}
