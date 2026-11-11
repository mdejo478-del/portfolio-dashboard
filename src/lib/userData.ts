// Everything account deletion has to remove of a user's PORTFOLIO data, in one place so a
// new kind of copy can't be forgotten again (the pre-migration copies made by 0.10 were).
// Server-only (file I/O). The user record itself (users.json) is removed separately.
import { deletePortfolio, deleteUserMigrationBackups } from "@/lib/portfolio";
import { deleteUserPortfolioBackups, deleteUserQuarantinedCopies } from "@/lib/backup";

/** Deletes the user's live portfolio file and every copy of it kept elsewhere:
 *   - the rotating backup snapshots (data/backups/<time>/portfolios/<userId>.json),
 *   - the copies made before a schema migration (data/pre-migration/),
 *   - damaged files quarantined by a self-heal (data/corrupted/).
 * Each step only touches files that belong to this user, and none fails if there is
 * nothing to delete. */
export async function deleteUserData(userId: string): Promise<void> {
  await deletePortfolio(userId);
  await deleteUserPortfolioBackups(userId);
  await deleteUserMigrationBackups(userId);
  await deleteUserQuarantinedCopies(userId);
}
