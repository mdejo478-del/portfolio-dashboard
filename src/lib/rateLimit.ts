// Free, in-process rate limiter (no external service). Buckets live in memory
// for the life of the server process, so limits reset on redeploy/restart and
// are per-instance only - acceptable for a single-instance deployment, but not
// a substitute for a shared store (e.g. Redis) if this app is ever scaled to
// multiple instances.
import { headers } from "next/headers";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanup(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

export function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return "יותר מדי ניסיונות. נסה שוב בעוד כ-" + minutes + (minutes === 1 ? " דקה." : " דקות.");
}

// Login-specific lockout: unlike checkRateLimit (which counts every call,
// success or failure), this only counts FAILED login attempts and applies a
// fixed lockout once the threshold is hit, separate from the counting
// window. A successful login clears the bucket via resetLoginFailures.
interface LoginBucket {
  failCount: number;
  windowStart: number;
  lockedUntil: number;
}

const loginBuckets = new Map<string, LoginBucket>();
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;
let lastLoginCleanup = Date.now();

function cleanupLoginBuckets(now: number): void {
  if (now - lastLoginCleanup < CLEANUP_INTERVAL_MS) return;
  lastLoginCleanup = now;
  for (const [key, bucket] of loginBuckets) {
    if (bucket.lockedUntil <= now && bucket.windowStart + LOGIN_WINDOW_MS <= now) loginBuckets.delete(key);
  }
}

export function checkLoginLock(key: string): RateLimitResult {
  const now = Date.now();
  cleanupLoginBuckets(now);
  const bucket = loginBuckets.get(key);
  if (!bucket || bucket.lockedUntil <= now) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000) };
}

export function recordLoginFailure(key: string): RateLimitResult {
  const now = Date.now();
  let bucket = loginBuckets.get(key);
  if (!bucket || bucket.windowStart + LOGIN_WINDOW_MS <= now) {
    bucket = { failCount: 0, windowStart: now, lockedUntil: 0 };
    loginBuckets.set(key, bucket);
  }
  bucket.failCount += 1;
  if (bucket.failCount >= LOGIN_MAX_FAILURES) {
    bucket.lockedUntil = now + LOGIN_LOCKOUT_MS;
    return { allowed: false, retryAfterSeconds: Math.ceil(LOGIN_LOCKOUT_MS / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetLoginFailures(key: string): void {
  loginBuckets.delete(key);
}
