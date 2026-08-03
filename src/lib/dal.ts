import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "@/lib/session";

export const verifySession = cache(async (): Promise<SessionPayload> => {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
});

// For actions invoked imperatively from client-side background code (autosave,
// periodic polling) rather than a form submission - redirect() thrown from a
// server action only reliably navigates the client when the call is wrapped
// in a form/transition; a plain `await action()` inside the caller's own
// try/catch (as autosave needs, to report failures) swallows that redirect as
// a generic thrown error instead. Throwing a plain, recognizable error here
// lets the caller detect "not authenticated" explicitly and navigate itself.
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new Error("SESSION_EXPIRED");
  return session;
}
