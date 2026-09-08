import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { memoriesTable } from "./memories";
import { uploadsTable } from "./uploads";

/**
 * A named, ordered selection of photographs from the memory wall.
 *
 * Deliberately many-to-many rather than a folder. A photograph of Christmas
 * belongs in "Christmases" and in "His last year" and in the book being
 * printed for his grandmother, and a model that forces a choice between those
 * would make someone move their child's picture from one place to another
 * instead of just adding it. Nothing is ever moved out of the memory wall;
 * an album is a view onto it.
 *
 * Order is explicit and stored, because these are watched and printed. The
 * order a person puts their child's life in is part of what they are making.
 */
export const albumsTable = pgTable(
  "albums",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /**
     * Their song, played under the slideshow. A reference to an upload rather
     * than a copy, and nullable because most albums will never have one.
     *
     * `set null` on delete, not cascade: deleting the audio file must not
     * delete the album of photographs it happened to be attached to.
     */
    musicUploadId: integer("music_upload_id").references(() => uploadsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("albums_user_id_idx").on(table.userId)],
);

/**
 * `userId` is carried here as well as on the album. It is redundant — the
 * album already says whose it is — and it is worth the redundancy: every
 * other query in this codebase filters on a `userId` column directly, and a
 * join table that can only be scoped through a parent is the one shape where
 * somebody eventually writes the query that forgets.
 */
export const albumItemsTable = pgTable(
  "album_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    albumId: integer("album_id")
      .notNull()
      .references(() => albumsTable.id, { onDelete: "cascade" }),
    memoryId: integer("memory_id")
      .notNull()
      .references(() => memoriesTable.id, { onDelete: "cascade" }),
    /** Sparse on purpose, so reordering rewrites few rows. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("album_items_album_id_idx").on(table.albumId, table.position),
    index("album_items_user_id_idx").on(table.userId),
    // The same photograph twice in one album is always a mistake, never a
    // choice, so the database refuses it rather than the UI apologising.
    unique("album_items_album_memory_unique").on(table.albumId, table.memoryId),
  ],
);

export const insertAlbumSchema = createInsertSchema(albumsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAlbum = z.infer<typeof insertAlbumSchema>;
export type Album = typeof albumsTable.$inferSelect;
export type AlbumItem = typeof albumItemsTable.$inferSelect;
