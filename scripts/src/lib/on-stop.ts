/**
 * What to tidy away before a signal ends the process.
 *
 * Every backup is encrypted whole on disk, but each of the scripts that
 * make, check and restore one holds the dump in plain SQL for a while:
 * backup-database until it has encrypted it, verify-backup and
 * restore-database once they have decrypted it. Each removes that file in a
 * finally block when anything fails. A signal is not a failure. It ends the
 * process without running a finally block, and a deploy, `docker compose
 * stop`, a Ctrl-C and a dropped SSH session each send one -- leaving names,
 * addresses, vital statistics and message bodies in a file on the backups
 * volume, outside the encryption, for good.
 *
 * So the three signals that ask a process to stop are caught here: whatever
 * is registered is stopped (pg_dump) and removed, and the process exits as
 * the signal would have ended it, with 128 and the signal's number.
 *
 * SIGKILL cannot be caught. What it leaves of a backup, the next backup
 * sweeps before it starts. What it leaves of a verify or a restore -- a
 * `.verify-<pid>.tmp` or `.restore-<pid>.tmp` beside the backup -- is not
 * swept, because one may be another run's, in use; DEPLOY.md says to delete
 * it.
 */
import { rmSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";

type Registration = { files: string[]; also?: () => void };

const registered = new Set<Registration>();
let installed = false;
let stopping = false;

function stop(signal: NodeJS.Signals): void {
  // A second signal while the first is being handled changes nothing.
  if (stopping) return;
  stopping = true;

  const removed: string[] = [];
  for (const { files, also } of registered) {
    try {
      also?.();
    } catch {
      // Stopping regardless.
    }
    for (const file of files) {
      try {
        rmSync(file);
        removed.push(path.basename(file));
      } catch {
        // Not written yet, or already gone.
      }
    }
  }

  const script = path.basename(process.argv[1] ?? "", ".ts");
  console.error(
    `${script}: stopped by ${signal}` +
      (removed.length > 0 ? `; removed ${removed.join(" and ")} before exiting.` : "."),
  );
  process.exit(128 + constants.signals[signal]);
}

/**
 * Remove `files`, after running `also`, if a signal stops the process before
 * the function this returns is called.
 */
export function onStop(files: string[], also?: () => void): () => void {
  if (!installed) {
    installed = true;
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      // `on`, not `once`: with the listener gone, a second signal would take
      // the default action and end the process part-way through tidying up.
      process.on(signal, () => stop(signal));
    }
  }
  const registration: Registration = { files, also };
  registered.add(registration);
  return () => {
    registered.delete(registration);
  };
}
