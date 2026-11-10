// Duplicate detection for trade-file imports. Pure and framework-agnostic.
//
// Re-importing the same file used to double every trade, the cash balance and
// the ledger. A row is a duplicate of a journal trade when date + symbol +
// action + quantity + price all match.
//
// Matching is by COUNT, not by set membership: two genuinely separate fills with
// identical date/symbol/action/qty/price (common with partial fills) must both
// be importable. A row is skipped only while the journal still has an unmatched
// trade with that fingerprint, so re-importing a file whose two identical rows
// are already both in the journal skips both, while importing it into a journal
// that has only one of them skips one and adds the other.

export interface FingerprintInput {
  date: string;
  symbol: string;
  action: string;
  qty: number;
  price: number;
}

// Rounded so float noise from value = qty * price round-trips can't hide a match.
const round = (n: number): string => (Math.round(n * 1e6) / 1e6).toString();

export function tradeFingerprint(t: FingerprintInput): string {
  return [t.date, t.symbol.trim().toUpperCase(), t.action, round(t.qty), round(t.price)].join("|");
}

export interface DuplicateSplit<T> {
  /** Rows not yet in the journal, in their original order. */
  fresh: T[];
  /** Rows that match a journal trade (or an earlier identical file row's slot). */
  duplicates: T[];
}

/** Splits file rows into new ones and ones already present in `existing`. */
export function splitDuplicates<T extends FingerprintInput>(existing: FingerprintInput[], rows: T[]): DuplicateSplit<T> {
  const remaining = new Map<string, number>();
  for (const t of existing) {
    const fp = tradeFingerprint(t);
    remaining.set(fp, (remaining.get(fp) || 0) + 1);
  }
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const row of rows) {
    const fp = tradeFingerprint(row);
    const left = remaining.get(fp) || 0;
    if (left > 0) {
      remaining.set(fp, left - 1);
      duplicates.push(row);
    } else {
      fresh.push(row);
    }
  }
  return { fresh, duplicates };
}
