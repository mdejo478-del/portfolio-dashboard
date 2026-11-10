import { promises as fs } from "fs";
import type { FileHandle } from "fs/promises";
import { randomUUID } from "crypto";

// Node-only (fs) - never import from client components.

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

async function renameWithRetry(from: string, to: string): Promise<void> {
  // On Windows a rename onto a file that another process (antivirus, indexer,
  // backup tool) has open for a moment fails with EPERM/EBUSY - retrying
  // briefly succeeds, and failing outright would drop a perfectly good save.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 4 || !code || !TRANSIENT_RENAME_CODES.has(code)) throw err;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

/** Replaces `finalPath` with `data` so that a crash or power loss at any
 * moment leaves either the complete old file or the complete new one - never
 * a zero-filled or half-written file.
 *
 * The plain "write a temp file, then rename it over the target" pattern is
 * atomic as far as the *name* goes, but the file's contents can still be only
 * in the OS write cache when the rename is journaled: after an unclean
 * shutdown NTFS then keeps the new file at its full size with the data blocks
 * never written (all zero bytes). That is exactly how two portfolio files were
 * lost once. Flushing the temp file to disk (fsync) *before* the rename closes
 * that window. */
export async function writeFileDurable(finalPath: string, data: string | Uint8Array): Promise<void> {
  const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(tmpPath, "w");
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(tmpPath, finalPath);
  } catch (err) {
    try { await handle?.close(); } catch { /* already closed / never opened */ }
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
}
