import { formatAtHome, homeDayNumber } from "@/lib/utils";

/*
 * How the console says when something is, shared by the master page and the
 * case page so the two never describe the same moment in different words.
 */

const asDate = (value: string | Date) =>
  value instanceof Date ? value : new Date(value);

/**
 * Dates in a funeral home are always read alongside the day of the week, and
 * on the home's clock (`formatAtHome`): the service is at eleven where the
 * chapel is, whatever zone the director reading this has flown to.
 */
export function whenLabel(value: string | Date, zone: string | undefined): string {
  return `${formatAtHome(value, zone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}, ${formatAtHome(value, zone, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * "3 days ago", "in 2 days". Plain words, because that is how it is said.
 *
 * The sign is never dropped. An earlier version answered "within the hour"
 * for anything inside sixty minutes either way, which put "within the hour"
 * against rows in a list headed **Past due** — a director reading that has
 * been told the opposite of the truth about something that has already
 * slipped, on the one screen whose whole job is to be believed.
 *
 * "Today", "tomorrow" and "yesterday" are counted in calendar days rather
 * than in multiples of 86,400,000 milliseconds, which is the same class of
 * mistake one layer down. Rounding the elapsed time meant that a director
 * looking at the console at nine in the morning was told a service at eleven
 * *tonight* was "tomorrow", and that a step which slipped at ten o'clock last
 * night was "yesterday" when they had walked past it on their way in. Both
 * are off by a day in the direction that costs something: a funeral is this
 * evening or it is not, and a diary does not round.
 *
 * The calendar is the home's: "today" is today in the home's town, so a
 * director in London at midnight is not told that tonight's Denver service
 * was yesterday.
 */
export function relative(value: string | Date, zone: string | undefined): string {
  const date = asDate(value);
  const ms = date.getTime() - Date.now();
  const past = ms < 0;

  if (Math.abs(ms) < 60_000) return "now";
  if (Math.abs(ms) < 3_600_000) {
    const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
    const unit = `${minutes} min`;
    return past ? `${unit} ago` : `in ${unit}`;
  }

  const days = homeDayNumber(date, zone) - homeDayNumber(new Date(), zone);

  if (days === 0) return past ? "earlier today" : "later today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";

  return past ? `${-days} days ago` : `in ${days} days`;
}
