import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const USERS_FILE = path.join(process.cwd(), "data", "users.json");

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  verified: boolean;
  verificationCode: string | null;
  onboardingCompleted: boolean;
}

async function readUsers(): Promise<StoredUser[]> {
  try {
    const raw = await fs.readFile(USERS_FILE, "utf-8");
    return JSON.parse(raw) as StoredUser[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeUsers(users: StoredUser[]): Promise<void> {
  await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
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
  const users = await readUsers();
  return users.find((u) => u.email === normalized);
}

export async function findUserById(id: string): Promise<StoredUser | undefined> {
  const users = await readUsers();
  return users.find((u) => u.id === id);
}

export async function createUser(name: string, email: string, password: string): Promise<StoredUser> {
  const normalized = email.trim().toLowerCase();
  const users = await readUsers();
  if (users.some((u) => u.email === normalized)) throw new Error("EMAIL_TAKEN");

  const user: StoredUser = {
    id: randomUUID(),
    name,
    email: normalized,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    verified: false,
    verificationCode: generateVerificationCode(),
    onboardingCompleted: false,
  };
  users.push(user);
  await writeUsers(users);
  return user;
}

export async function verifyCredentials(email: string, password: string): Promise<StoredUser | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function markUserVerified(id: string): Promise<boolean> {
  const users = await readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return false;
  user.verified = true;
  user.verificationCode = null;
  await writeUsers(users);
  return true;
}

export async function markOnboardingCompleted(id: string): Promise<boolean> {
  const users = await readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return false;
  user.onboardingCompleted = true;
  await writeUsers(users);
  return true;
}
