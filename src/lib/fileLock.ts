// In-process mutex per file key, so concurrent requests that read-modify-write
// the same JSON file (users.json, or one user's portfolio file) are serialized
// instead of racing - two concurrent writers reading the same "before" state
// and then each writing their own version would otherwise silently drop
// whichever write lands second. Per-instance only, same caveat as
// rateLimit.ts: fine for a single server process, not a substitute for a
// real datastore's transactions if this ever runs multiple instances.
const chains = new Map<string, Promise<unknown>>();

export function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Swallow the result/error for chaining purposes only - callers still get
  // the real outcome via the returned promise below. Without this catch, an
  // earlier rejection would permanently poison the chain for every
  // subsequent call sharing this key.
  chains.set(key, next.catch(() => undefined));
  return next;
}
