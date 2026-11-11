// Fee sign convention for trade-file imports (audit finding M3). Pure and
// framework-agnostic.
//
// Throughout the journal a fee is stored as a NEGATIVE number (a cost): cashEffect()
// adds the fee to the cash movement, so -2.5 lowers cash by 2.5. A broker file that
// lists a commission as a POSITIVE number (the usual way to write a cost in a column
// called "Commission") would, imported as is, INCREASE cash by the fee. The import
// therefore offers to convert positive fees to negative ones - on by default, and the
// user can switch it off. Only the rows being imported are ever touched; trades
// already in the journal are never changed.

/** How many of the rows carry a positive fee. */
export function countPositiveFees(rows: Array<{ fee: number }>): number {
  let n = 0;
  for (const r of rows) if (r.fee > 0) n++;
  return n;
}

/** The fee the import will actually store for this row: negative when conversion is
 * on and the file's fee is positive, otherwise exactly what the file said. */
export function effectiveFee(fee: number, convertPositive: boolean): number {
  return convertPositive && fee > 0 ? -fee : fee;
}

/** The same rows with the fee sign applied. Returns new row objects (the input is
 * not modified) and how many rows had a positive fee. */
export function applyFeeSign<T extends { fee: number }>(rows: T[], convertPositive: boolean): { rows: T[]; positives: number } {
  return {
    rows: rows.map((r) => (convertPositive && r.fee > 0 ? { ...r, fee: -r.fee } : r)),
    positives: countPositiveFees(rows),
  };
}
