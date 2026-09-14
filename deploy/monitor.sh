#!/usr/bin/env bash
#
# The checks that have to wake somebody up.
#
# Read the design constraint first, because it decides the whole shape of
# this file: **a monitor running on the host it monitors cannot report that
# host being down.** If the disk fills, the box reboots, or the provider
# pulls the plug, this script dies with everything else and the silence looks
# exactly like health. That is how a funeral home discovers on Tuesday that
# the portal has been down since Saturday.
#
# So there are two halves, and neither is optional:
#
#   1. This script, on the host, checking the things only something inside
#      can see -- disk, containers, whether the nightly jobs actually ran.
#      It pages directly when it finds one.
#
#   2. A dead-man's switch OFF the host. This script pings HEARTBEAT_URL on
#      every clean run. The external service pages when the ping *stops*,
#      which is the failure this script can never report itself. Use
#      healthchecks.io, Better Stack, Cronitor -- any of them, the free tier
#      is enough for one deployment. Set the grace period to about twice the
#      cron interval.
#
# .github/workflows/uptime.yml is the third leg: it asks, from outside, does
# the site answer and is the certificate still good.
#
# --------------------------------------------------------------------------
# Configuration
#
#   ALERT_WEBHOOK   where a failure goes. Any URL that accepts a JSON POST:
#                   a Slack incoming webhook, PagerDuty Events v2, ntfy, a
#                   Discord webhook. Required, and it must reach a *person* --
#                   a channel nobody has muted, or better, something that
#                   makes a telephone ring at 3am. A dashboard is not this.
#   HEARTBEAT_URL   the dead-man's switch to ping on success. Strongly
#                   recommended; the script warns loudly without one.
#   MAX_DISK_PCT    page above this much disk used. Default 85. Postgres and
#                   the photographs share a disk here, and a full disk is
#                   both an outage and a failed backup at the same time.
#   MAX_BACKUP_AGE_H   page if the newest dump is older than this. Default 30,
#                   which is a nightly backup plus six hours of slack.
#   MAX_AFTERCARE_AGE_H  page if no aftercare run has been recorded in this
#                   long. Default 30. This is the check that catches the
#                   failure with no symptoms: everything green, nobody paged,
#                   and the grief check-ins the home is paying for quietly
#                   stopped going out weeks ago.
#   COMPOSE_FILE    defaults to the docker-compose.yml above this script.
#
#   30 * * * *  /srv/funeral-home/deploy/monitor.sh >> /var/log/fh-monitor.log 2>&1

set -uo pipefail   # not -e: every check must run even after one fails.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
MAX_DISK_PCT="${MAX_DISK_PCT:-85}"
MAX_BACKUP_AGE_H="${MAX_BACKUP_AGE_H:-30}"
MAX_AFTERCARE_AGE_H="${MAX_AFTERCARE_AGE_H:-30}"

PROBLEMS=()
note() { echo "monitor: $*"; }
problem() { echo "monitor: PROBLEM: $*" >&2; PROBLEMS+=("$*"); }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

[ -n "${ALERT_WEBHOOK:-}" ] || {
  echo "monitor: ALERT_WEBHOOK is not set. There is nobody to tell. Refusing to" >&2
  echo "monitor: pretend this is monitoring." >&2
  exit 2
}

# ------------------------------------------------------- containers are up --
# `docker compose ps` rather than asking the app: a container in a restart
# loop can still answer one request in three, which reads as healthy to a
# naive probe and is not.
UNHEALTHY="$(compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null \
  | awk '$2 != "running" || ($3 != "" && $3 != "healthy") {print $1"("$2"/"$3")"}' | tr '\n' ' ')"
if [ -n "${UNHEALTHY// /}" ]; then
  problem "containers not healthy: $UNHEALTHY"
else
  note "containers healthy"
fi

# ------------------------------------------------------------- the API is up --
# Through the API's own health route, which fails when Postgres is
# unreachable. A process that is listening but cannot reach the database
# serves an error on every screen, and calling that up is worse than useless.
# node rather than curl or wget: the runtime image ships neither, which is
# correct for it and is why its own HEALTHCHECK uses node too.
API_STATUS="$(compose exec -T api node -e "
  fetch('http://127.0.0.1:'+(process.env.PORT||4311)+'/api/healthz')
    .then(r => r.text()).then(t => console.log(t))
    .catch(e => { console.error(e.message); process.exit(1); })
" 2>/dev/null | tr -d '\r')"
case "$API_STATUS" in
  *'"database":true'*) note "api and database answering" ;;
  "")                  problem "the API did not answer its own health check at all" ;;
  *)                   problem "the API is up but reports unhealthy: $API_STATUS" ;;
esac

# ------------------------------------------------------------------- disk --
# The filesystem the docker volumes are on, not /. On most hosts they are the
# same; where they are not, / has plenty of room while the database is out.
DISK_PATH="${DISK_PATH:-/var/lib/docker}"
DISK_PCT="$(df --output=pcent "$DISK_PATH" 2>/dev/null | tail -1 | tr -dc '0-9')"
if [ -z "$DISK_PCT" ]; then
  problem "could not read disk usage for $DISK_PATH"
elif [ "$DISK_PCT" -ge "$MAX_DISK_PCT" ]; then
  problem "disk ${DISK_PCT}% full on $DISK_PATH (limit ${MAX_DISK_PCT}%) — Postgres and every photograph share this"
else
  note "disk ${DISK_PCT}% used"
fi

# ---------------------------------------------------------------- backups --
# Age of the newest dump, read from inside the volume. "The backup job is
# configured" and "a backup happened last night" are different claims and
# only the second one matters.
BACKUP_AGE_MIN="$(compose run --rm --no-deps -T tools \
  sh -c 'ls -t /backups/holding-today-*.sql 2>/dev/null | head -1 | xargs -r stat -c %Y' 2>/dev/null \
  | tr -dc '0-9')"
if [ -z "$BACKUP_AGE_MIN" ]; then
  problem "there is no backup in the volume at all"
else
  AGE_H=$(( ( $(date +%s) - BACKUP_AGE_MIN ) / 3600 ))
  if [ "$AGE_H" -ge "$MAX_BACKUP_AGE_H" ]; then
    problem "newest backup is ${AGE_H}h old (limit ${MAX_BACKUP_AGE_H}h)"
  else
    note "newest backup ${AGE_H}h old"
  fi
fi

# --------------------------------------------------------------- aftercare --
# The quiet one. Nothing breaks when aftercare stops running: no error, no
# 500, no unhappy director. The check-ins simply stop, and the thing the home
# is paying for is not happening. Read from the deliveries table, which is
# the only durable evidence a run occurred.
AFTERCARE_AGE_H="$(compose exec -T db psql -U "${POSTGRES_USER:-funeral}" \
  -d "${POSTGRES_DB:-funeral_home}" -tAc \
  "select coalesce(floor(extract(epoch from (now() - max(coalesce(sent_at, failed_at)))) / 3600)::text, 'never')
     from aftercare_deliveries" 2>/dev/null | tr -d '[:space:]')"
case "$AFTERCARE_AGE_H" in
  "")      problem "could not reach the database to check whether aftercare is running" ;;
  never)   note "aftercare has never sent anything — normal on a new deployment, not normal on an old one" ;;
  *[!0-9]*) problem "unexpected answer checking aftercare: $AFTERCARE_AGE_H" ;;
  *)
    if [ "$AFTERCARE_AGE_H" -ge "$MAX_AFTERCARE_AGE_H" ]; then
      problem "no aftercare check-in has gone out in ${AFTERCARE_AGE_H}h (limit ${MAX_AFTERCARE_AGE_H}h) — the schedule has probably stopped"
    else
      note "aftercare last sent ${AFTERCARE_AGE_H}h ago"
    fi
    ;;
esac

# ------------------------------------------------------------------ page --
if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  TEXT="Holding Today on $(hostname): ${#PROBLEMS[@]} problem(s)"
  for p in "${PROBLEMS[@]}"; do TEXT="$TEXT"$'\n'"• $p"; done

  # `text` suits Slack, ntfy and Discord; `summary` is what PagerDuty Events
  # v2 reads. Sending both means one payload works with all of them.
  BODY="$(printf '%s' "$TEXT" | python3 -c '
import json,sys
t = sys.stdin.read()
print(json.dumps({"text": t, "summary": t, "source": "holding-today-monitor", "severity": "critical"}))')"

  curl --silent --show-error --fail-with-body --max-time 30 \
    -X POST "$ALERT_WEBHOOK" -H 'Content-Type: application/json' -d "$BODY" \
    || echo "monitor: COULD NOT REACH THE ALERT WEBHOOK. Nobody has been told." >&2

  # No heartbeat on a failed run: that is the whole point of the dead-man's
  # switch. If the webhook itself is broken, the missing ping still pages.
  exit 1
fi

if [ -n "${HEARTBEAT_URL:-}" ]; then
  curl --silent --show-error --max-time 20 -o /dev/null "$HEARTBEAT_URL" \
    || echo "monitor: everything is fine but the heartbeat ping failed." >&2
else
  echo "monitor: HEARTBEAT_URL is not set, so nothing will notice if this host" >&2
  echo "monitor: stops running these checks entirely. Set one." >&2
fi

note "all checks passed"
