import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";
import { getSupabaseClient } from "@/lib/supabaseClient";

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  verified: boolean;
  verificationCode: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
  verified: boolean;
  verification_code: string | null;
}

function rowToUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    verified: row.verified,
    verificationCode: row.verification_code,
  };
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, 64);
  if (candidate.length !== hashBuf.length) return false;
  return timingSafeEqual(candidate, hashBuf);
}

function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await getSupabaseClient()
    .from("users")
    .select("*")
    .eq("email", normalized)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToUser(data as UserRow) : undefined;
}

export async function findUserById(id: string): Promise<StoredUser | undefined> {
  const { data, error } = await getSupabaseClient()
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToUser(data as UserRow) : undefined;
}

export async function createUser(name: string, email: string, password: string): Promise<StoredUser> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await getSupabaseClient()
    .from("users")
    .insert({
      name,
      email: normalized,
      password_hash: hashPassword(password),
      verified: false,
      verification_code: generateVerificationCode(),
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("EMAIL_TAKEN");
    throw error;
  }
  return rowToUser(data as UserRow);
}

export async function verifyCredentials(email: string, password: string): Promise<StoredUser | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function markUserVerified(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("users")
    .update({ verified: true, verification_code: null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
