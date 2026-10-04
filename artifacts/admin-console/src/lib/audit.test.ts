import { describe, expect, it } from "vitest";
import type { AuditEntry } from "./api";
import {
  AUDIT_PAGE_SIZE,
  auditFilterHref,
  auditFilters,
  auditQuery,
  homesInLog,
  olderThan,
  platformSubject,
} from "./audit";

/**
 * The access log is the page shown to a funeral home's insurer, so the
 * things pinned here are the ones that would make it say less than the truth:
 * a page of history it never offers, a filter that will not clear, a line
 * that claims more was read than was.
 */

const line = (id: number, about: Partial<AuditEntry> = {}): AuditEntry => ({
  id,
  actorEmail: "heather@continuum.example",
  action: "home.open",
  subjectHomeId: null,
  subjectHomeName: null,
  detail: null,
  createdAt: "2026-09-28T17:00:00.000Z",
  ...about,
});

/** A page of the log as the API sends it: newest first. */
const page = (newest: number, length: number) =>
  Array.from({ length }, (_, index) => line(newest - index));

describe("paging back through the log", () => {
  it("carries on from the oldest line of a full page", () => {
    const first = page(5000, AUDIT_PAGE_SIZE);
    expect(olderThan(first)).toBe(5000 - AUDIT_PAGE_SIZE + 1);
  });

  it("stops at a short page, rather than offering a button that finds nothing", () => {
    expect(olderThan(page(99, AUDIT_PAGE_SIZE - 1))).toBeNull();
    expect(olderThan([])).toBeNull();
  });

  it("asks for every page with the same filters, older than the last line seen", () => {
    const filters = { homeId: 12, action: "home.open" };
    const asked = (before: number | null) =>
      Object.fromEntries(new URLSearchParams(auditQuery(filters, before)));

    expect(asked(null)).toEqual({
      limit: String(AUDIT_PAGE_SIZE),
      homeId: "12",
      action: "home.open",
    });
    expect(asked(4901)).toEqual({
      limit: String(AUDIT_PAGE_SIZE),
      homeId: "12",
      action: "home.open",
      before: "4901",
    });
    expect(auditQuery({ homeId: null, action: "" }, null)).toBe(
      `limit=${AUDIT_PAGE_SIZE}`,
    );
  });
});

describe("the log's filters, kept in the address", () => {
  it("reads a home from either spelling of the link", () => {
    expect(auditFilters("homeId=12")).toEqual({ homeId: 12, action: "" });
    expect(auditFilters("home=12&action=home.suspend")).toEqual({
      homeId: 12,
      action: "home.suspend",
    });
    expect(auditFilters("")).toEqual({ homeId: null, action: "" });
  });

  it("clears a home that arrived as ?home=, so every home really means every home", () => {
    expect(auditFilterHref("home=12&action=home.open", "homeId", "")).toBe(
      "/audit?action=home.open",
    );
    expect(auditFilterHref("home=12", "homeId", "7")).toBe("/audit?homeId=7");
  });

  it("changes one filter and keeps the other, down to the bare log", () => {
    expect(auditFilterHref("homeId=12", "action", "home.suspend")).toBe(
      "/audit?homeId=12&action=home.suspend",
    );
    expect(auditFilterHref("action=home.suspend", "action", "")).toBe("/audit");
  });
});

describe("what the log names", () => {
  it("offers the homes the log mentions, once each, by name, and the one being looked at", () => {
    const entries = [
      line(4, { subjectHomeId: 4, subjectHomeName: "Willow Creek" }),
      line(3, { subjectHomeId: 9, subjectHomeName: null }),
      line(2, { subjectHomeId: 4, subjectHomeName: "Willow Creek" }),
      line(1, { action: "homes.list" }),
    ];
    // Home 12 is filtered on but has nothing in this page of the log; it
    // still has to be in the list, or the select would show the wrong home.
    expect(homesInLog(entries, 12)).toEqual([
      [12, "Home #12"],
      [9, "Home #9"],
      [4, "Willow Creek"],
    ]);
  });

  it("says what a line with no home was about, and never that it was every home", () => {
    expect(platformSubject("group.checkout")).toBe("A group");
    expect(platformSubject("platform.admin.grant")).toBe("The access list");
    expect(platformSubject("platform.admins.list")).toBe("The access list");
    expect(platformSubject("homes.list")).toBe("Platform");
    expect(platformSubject("platform.overview")).toBe("Platform");
  });
});
