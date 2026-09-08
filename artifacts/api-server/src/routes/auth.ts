import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  toPublicUser,
  affirmationsTable,
  creativeTable,
  documentsTable,
  journalTable,
  lettersTable,
  memoriesTable,
  milestonesTable,
  profileTable,
  quotesTable,
  storiesTable,
  todosTable,
  tributeTable,
  uploadsTable,
  signsTable,
  belongingsTable,
  giftsTable,
  contactsTable,
  obituariesTable,
  memorialChoicesTable,
  sharesTable,
} from "@workspace/db";
import {
  RegisterBody,
  LoginBody,
  ChangePasswordBody,
  DeleteAccountBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";
import { DecryptionError, decryptBuffer, decryptNullable } from "@workspace/db/crypto";
import { ZipWriter } from "../lib/zip";
import { HttpError, badRequest, parseBody } from "../lib/http";
import { requireAuth, currentUser } from "../middleware/require-auth";
import { authRateLimit } from "../middleware/rate-limit";
import { isMailConfigured, sendPasswordResetEmail } from "../lib/mailer";
import { isGoogleConfigured } from "../lib/google";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_TTL_MS,
  SESSION_COOKIE,
  consumePasswordReset,
  createPasswordReset,
  revokePasswordResets,
  clearSessionCookie,
  createSession,
  destroyAllSessions,
  destroySession,
  fakeVerify,
  hashPassword,
  normaliseEmail,
  setSessionCookie,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();

const invalidCredentials = () =>
  new HttpError(401, "Email or password is incorrect");

function assertPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

/**
 * Lets the sign-in page render only the options that actually work. Offering
 * a Google button that 404s, or a "forgot password" link that silently sends
 * nothing, is worse than not offering it.
 */
router.get("/auth/methods", (_req, res) => {
  res.json({
    google: isGoogleConfigured(),
    passwordReset: isMailConfigured(),
  });
});

router.post("/auth/register", authRateLimit, async (req, res) => {
  const { email, password, displayName } = parseBody(RegisterBody, req.body);
  assertPasswordStrength(password);

  const normalised = normaliseEmail(email);

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalised))
    .limit(1);

  if (existing) {
    throw new HttpError(409, "An account already exists for that email");
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      email: normalised,
      passwordHash: await hashPassword(password),
      displayName: displayName ?? null,
    })
    .returning();

  setSessionCookie(res, await createSession(user.id));
  res.status(201).json(toPublicUser(user));
});

router.post("/auth/login", authRateLimit, async (req, res) => {
  const { email, password } = parseBody(LoginBody, req.body);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normaliseEmail(email)))
    .limit(1);

  // Hash regardless, so a missing account and a wrong password take the same
  // time and the response cannot be used to enumerate registered addresses.
  //
  // An account that only signs in with Google has no password, and is treated
  // here exactly like an account that does not exist. Saying "this one uses
  // Google" would be friendlier but would confirm the address is registered —
  // which, for this application, means confirming someone has lost a child.
  // The sign-in page carries a standing hint instead.
  if (!user || user.passwordHash === null) {
    await fakeVerify(password);
    throw invalidCredentials();
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw invalidCredentials();
  }

  setSessionCookie(res, await createSession(user.id));
  res.json(toPublicUser(user));
});

router.post("/auth/logout", async (req, res) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];

  if (typeof token === "string" && token !== "") {
    await destroySession(token);
  }

  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.json(toPublicUser(currentUser(req)));
});

router.put("/auth/password", requireAuth, authRateLimit, async (req, res) => {
  const user = currentUser(req);
  const { currentPassword, newPassword } = parseBody(
    ChangePasswordBody,
    req.body,
  );
  assertPasswordStrength(newPassword);

  // An account created through Google has no password to prove. Being signed
  // in is the proof, and this is how such an account gains a second way in —
  // which matters, because losing access to a Google account should not mean
  // losing everything written about a child.
  if (user.passwordHash !== null) {
    if (!currentPassword) {
      throw badRequest("Please enter your current password");
    }

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new HttpError(403, "Current password is incorrect");
    }
  }

  await db
    .update(usersTable)
    .set({
      passwordHash: await hashPassword(newPassword),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  // Changing a password is also how someone locks out a device they no longer
  // control, so every session goes — including this one.
  await destroyAllSessions(user.id);
  clearSessionCookie(res);
  res.status(204).end();
});

/**
 * Always answers 204, whatever happened.
 *
 * A different answer for "no such account" would turn this endpoint into a
 * way to test whether an address is registered here. On a site for bereaved
 * parents that is not an abstract privacy concern: it would let anyone check
 * whether a particular person has lost a child.
 */
router.post("/auth/forgot-password", authRateLimit, async (req, res) => {
  const { email } = parseBody(ForgotPasswordBody, req.body);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normaliseEmail(email)))
    .limit(1);

  // Nothing is sent to an account that has no password — there would be
  // nothing to reset, and a Google user receiving this would only be confused.
  if (user && user.passwordHash !== null) {
    const token = await createPasswordReset(user.id);
    const base = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");

    await sendPasswordResetEmail({
      to: user.email,
      resetUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
      expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60000),
    });
  }

  res.status(204).end();
});

router.post("/auth/reset-password", authRateLimit, async (req, res) => {
  const { token, newPassword } = parseBody(ResetPasswordBody, req.body);
  assertPasswordStrength(newPassword);

  const user = await consumePasswordReset(token);

  if (!user) {
    throw new HttpError(
      400,
      "That link has expired or has already been used. Please request a new one.",
    );
  }

  await db
    .update(usersTable)
    .set({
      passwordHash: await hashPassword(newPassword),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  // Whoever asked for this may be locked out precisely because someone else
  // has their password, so every existing session and every other outstanding
  // link is revoked.
  await destroyAllSessions(user.id);
  await revokePasswordResets(user.id);
  clearSessionCookie(res);

  res.status(204).end();
});

/**
 * Everything this account has written, in one JSON file. This is deliberately
 * plain and complete: what someone wrote about their child is theirs to take
 * with them, and they should never need to ask for it.
 */
/**
 * Every table an account owns.
 *
 * Kept as one list so that adding a feature and forgetting to include it in
 * the export is a single omission in an obvious place, rather than a silent
 * gap somebody discovers on the day they are trying to leave.
 *
 * `shares` is not here: it holds token digests and nothing a person wrote.
 * `sessions` and `password_resets` likewise.
 */
const EXPORTABLE = {
  profile: profileTable,
  memories: memoriesTable,
  journal: journalTable,
  letters: lettersTable,
  creative: creativeTable,
  documents: documentsTable,
  quotes: quotesTable,
  tribute: tributeTable,
  todos: todosTable,
  affirmations: affirmationsTable,
  milestones: milestonesTable,
  stories: storiesTable,
  signs: signsTable,
  belongings: belongingsTable,
  gifts: giftsTable,
  contacts: contactsTable,
  obituaries: obituariesTable,
  memorialChoices: memorialChoicesTable,
} as const;

/** The written record, with documents decrypted back into readable text. */
async function collectExport(userId: number): Promise<Record<string, unknown[]>> {
  const data: Record<string, unknown[]> = {};

  for (const [name, table] of Object.entries(EXPORTABLE)) {
    data[name] = await db.select().from(table).where(eq(table.userId, userId));
  }

  // Documents are stored encrypted. An export of ciphertext would technically
  // be "all your data" and practically be useless to the person taking it.
  // An unreadable row must not fail the whole export: someone taking their
  // data out is often doing it precisely because something has gone wrong.
  data.documents = (data.documents as (typeof documentsTable.$inferSelect)[]).map(
    (row) => {
      try {
        return {
          ...row,
          content: decryptNullable(row.content),
          notes: decryptNullable(row.notes),
        };
      } catch (error) {
        if (!(error instanceof DecryptionError)) throw error;
        return { ...row, content: null, notes: null, contentUnreadable: true };
      }
    },
  );

  return data;
}

const EXPORT_STEM = "holding-today-export";

router.get("/auth/export", requireAuth, async (req, res) => {
  const user = currentUser(req);
  const data = await collectExport(user.id);

  // Photographs are listed rather than inlined here: base64 of a few hundred
  // images would turn a readable document into a several-hundred-megabyte
  // blob most tools refuse to open. The archive endpoint below is the one
  // that actually carries the bytes.
  const files = await db
    .select({
      id: uploadsTable.id,
      filename: uploadsTable.filename,
      mimeType: uploadsTable.mimeType,
      sizeBytes: uploadsTable.sizeBytes,
      createdAt: uploadsTable.createdAt,
    })
    .from(uploadsTable)
    .where(eq(uploadsTable.userId, user.id));

  res.setHeader(
    "content-disposition",
    `attachment; filename="${EXPORT_STEM}.json"`,
  );
  res.json({
    exportedAt: new Date().toISOString(),
    account: toPublicUser(user),
    data,
    files: files.map((file) => ({ ...file, url: `/api/uploads/${file.id}` })),
    note: "Photographs are listed here but not included. Use /api/auth/export/archive for a zip containing the files themselves.",
  });
});

/**
 * Everything, photographs included, as a zip.
 *
 * The JSON export lists images as URLs that only resolve while signed in,
 * which makes it useless in the situation people actually take an export: the
 * account is being deleted, or they no longer trust this site to exist. What
 * they wanted was the pictures.
 *
 * Streamed entry by entry rather than assembled in memory, so an account near
 * the 2 GB ceiling does not have to fit in the heap.
 */
router.get("/auth/export/archive", requireAuth, async (req, res) => {
  const user = currentUser(req);
  const data = await collectExport(user.id);

  const uploads = await db
    .select()
    .from(uploadsTable)
    .where(eq(uploadsTable.userId, user.id));

  res.setHeader("content-type", "application/zip");
  res.setHeader(
    "content-disposition",
    `attachment; filename="${EXPORT_STEM}.zip"`,
  );
  res.setHeader("cache-control", "no-store");

  const zip = new ZipWriter(res);
  const unreadable: string[] = [];

  await zip.addFile(
    "export.json",
    Buffer.from(
      JSON.stringify(
        { exportedAt: new Date().toISOString(), account: toPublicUser(user), data },
        null,
        2,
      ),
      "utf8",
    ),
  );

  for (const upload of uploads) {
    try {
      await zip.addFile(
        // Prefixed with the id so two photographs called IMG_0431.jpg do not
        // collide and silently become one file in the archive.
        `files/${upload.id}-${upload.filename}`,
        decryptBuffer(upload.data),
        upload.createdAt,
      );
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error;
      // One file stored under a lost key must not cost someone the other
      // nine hundred. It is named in the manifest instead.
      unreadable.push(`${upload.id}-${upload.filename}`);
    }
  }

  if (unreadable.length > 0) {
    await zip.addFile(
      "files/UNREADABLE.txt",
      Buffer.from(
        "These files could not be decrypted, and are not in this archive.\n" +
          "That usually means they were stored under a different ENCRYPTION_KEY.\n\n" +
          unreadable.join("\n") +
          "\n",
        "utf8",
      ),
    );
  }

  await zip.finish();
  res.end();
});

router.delete("/auth/account", requireAuth, authRateLimit, async (req, res) => {
  const user = currentUser(req);
  const { password, confirmEmail } = parseBody(DeleteAccountBody, req.body);

  if (user.passwordHash !== null) {
    if (!password || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(403, "Password is incorrect");
    }
  } else {
    // No password to ask for, so deletion is confirmed by typing the address
    // out. This is irreversible and must never be one click away.
    if (normaliseEmail(confirmEmail ?? "") !== user.email) {
      throw new HttpError(
        403,
        "Please type your email address exactly to confirm",
      );
    }
  }

  // Every table's `user_id` is ON DELETE CASCADE, so this removes all of it.
  await db.delete(usersTable).where(eq(usersTable.id, user.id));

  clearSessionCookie(res);
  res.status(204).end();
});

export default router;
