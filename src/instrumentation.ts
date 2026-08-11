// Runs once when the Next.js server process starts (see the instrumentation
// docs in node_modules/next/dist/docs). Railway runs this app as a single
// long-lived `next start` process, not a serverless function, so a plain
// setInterval here is safe and persists for the process's whole lifetime.
//
// Checks hourly rather than trying to schedule a single 24h timer directly:
// both maybeRunBackup() and maybeRunDailySnapshot() are cheap no-ops unless a
// day has actually passed (each tracked in its own meta file, which survives
// restarts on the Railway volume), so an hourly check is both low-overhead
// and resilient to the process being restarted or briefly down across the
// exact due time.
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { maybeRunBackup } = await import("@/lib/backup");
  const { maybeRunDailySnapshot } = await import("@/lib/dailySnapshot");
  const check = () => {
    maybeRunBackup().catch((err) => console.error("[backup] periodic check failed:", err));
    maybeRunDailySnapshot().catch((err) => console.error("[dailySnapshot] periodic check failed:", err));
  };

  check(); // in case the process was down past the last due time
  setInterval(check, BACKUP_CHECK_INTERVAL_MS);
}
