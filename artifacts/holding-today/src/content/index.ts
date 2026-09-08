import type { Chapter, ChapterGroup } from "./types";
import { firstDaysGroups } from "./first-days";
import { healingGroups } from "./healing";
import { moneyGroups } from "./money-and-paperwork";
import { publicOrCriminalGroups } from "./public-or-criminal";
import { familyFriendsGroups } from "./for-family-and-friends";

/**
 * Every chapter on the site, flattened, with the page each one lives on.
 *
 * Search returns chapter ids; this is what turns an id back into a title and a
 * link. Built from the same modules the pages render, so a chapter cannot go
 * missing from search by being added in one place and not another.
 */

export type IndexedChapter = Chapter & { page: string };

function flatten(page: string, groups: ChapterGroup[]): IndexedChapter[] {
  return groups.flatMap((group) =>
    group.chapters.map((chapter) => ({ ...chapter, page })),
  );
}

export const ALL_CHAPTERS: IndexedChapter[] = [
  ...flatten("/first-days", firstDaysGroups),
  ...flatten("/healing", healingGroups),
  ...flatten("/money", moneyGroups),
  ...flatten("/public-or-criminal", publicOrCriminalGroups),
  ...flatten("/for-family-and-friends", familyFriendsGroups),
];
