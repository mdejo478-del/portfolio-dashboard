// Schema version and migrations for the portfolio file (audit finding M2, task 0.10).
// Pure: no Node APIs, no I/O - the file handling (backup before the change, writing,
// locking) lives in portfolio.ts and calls into this.
//
// A portfolio file carries `schemaVersion`. A file without the field is version 0 (every
// file written before this existed). MIGRATIONS is an ordered list of pure functions:
// MIGRATIONS[n] turns a version-n file into a version-(n+1) file, and the current
// version is simply how many there are. To change the file's structure in future: add a
// function at the END of the list - never edit or reorder an existing one.
//
// A migration receives the parsed file and returns the migrated one WITHOUT modifying its
// input; it does not set schemaVersion itself (the runner stamps it after each step).

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** v0 -> v1. Empty on purpose: it only marks the version, which exercises the whole
 * mechanism (backup, migrate, save) without changing any data. */
export const migrateV0toV1: Migration = (data) => data;

export const MIGRATIONS: ReadonlyArray<Migration> = [migrateV0toV1];

/** The version this code writes and understands. */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.length;

/** The file cannot be used as is: it comes from a newer version of the system than the
 * code that is running ("too-new") or carries a version number that makes no sense
 * ("invalid"). In both cases the file must be left exactly as it is. */
export class PortfolioSchemaError extends Error {
  readonly code: "too-new" | "invalid";
  readonly fileVersion: unknown;
  constructor(code: "too-new" | "invalid", message: string, fileVersion: unknown) {
    super(message);
    this.name = "PortfolioSchemaError";
    this.code = code;
    this.fileVersion = fileVersion;
  }
}

export function tooNewMessage(fileVersion: number, supported: number): string {
  return "קובץ התיק נשמר בגרסה חדשה יותר של המערכת (גרסת מבנה " + fileVersion + ") מזו שרצה כרגע (גרסה " + supported
    + "). כדי לא לפגוע בנתונים המערכת לא פותחת את הקובץ ולא משנה אותו. יש לעדכן את המערכת לגרסה העדכנית.";
}

export function invalidVersionMessage(value: unknown): string {
  return "גרסת המבנה שנרשמה בקובץ התיק (" + JSON.stringify(value) + ") אינה תקינה. הקובץ לא שונה - פנה לבעל המערכת.";
}

/** The file's schema version: 0 when the field is absent, otherwise a non-negative
 * integer. Anything else is refused rather than guessed. */
export function schemaVersionOf(data: Record<string, unknown>): number {
  const v = data.schemaVersion;
  if (v === undefined) return 0;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  throw new PortfolioSchemaError("invalid", invalidVersionMessage(v), v);
}

export interface MigrationResult {
  /** The migrated file (the very same object when nothing had to change). */
  data: Record<string, unknown>;
  from: number;
  to: number;
  migrated: boolean;
}

/** Runs every migration from the file's version up to the latest, in order. Never
 * modifies its input. A file already at the latest version is returned as is; a file from
 * a NEWER version than the code throws PortfolioSchemaError("too-new") - it is never
 * "migrated" backwards or overwritten. */
export function migrateToCurrent(data: Record<string, unknown>, migrations: ReadonlyArray<Migration> = MIGRATIONS): MigrationResult {
  const from = schemaVersionOf(data);
  const target = migrations.length;
  if (from > target) throw new PortfolioSchemaError("too-new", tooNewMessage(from, target), from);
  if (from === target) return { data, from, to: target, migrated: false };
  let current: Record<string, unknown> = data;
  for (let version = from; version < target; version++) {
    // A shallow copy is handed over so a careless migration can't alter the caller's object.
    current = { ...migrations[version]({ ...current }), schemaVersion: version + 1 };
  }
  return { data: current, from, to: target, migrated: true };
}
