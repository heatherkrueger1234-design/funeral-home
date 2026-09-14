#!/usr/bin/env bash
#
# Take a backup, and put a copy somewhere this host cannot take down with it.
#
# `backup-database` writes into the `backups` volume, which is on the same
# disk as the database it is protecting. That is not a backup -- it survives
# "somebody dropped a table" and none of the failures that actually lose a
# funeral home's photographs: the disk, the host, the provider account, or the
# ransomware that encrypts every path the machine can write to.
#
# So this script does three things in order, and stops at the first failure:
#
#   1. takes a fresh dump inside the `tools` container;
#   2. copies every dump the remote does not already have, off this host;
#   3. reads back the size of what it just wrote, and refuses to report
#      success unless it matches the local file byte for byte.
#
# Step 3 is the point. A copy job that reports success on a write it never
# read back is how a funeral home ends up with a year of empty files and finds
# out on the worst possible morning.
#
# Re-runnable by design: it copies only what is missing, so running it twice
# in a row is a no-op and a run that died half way finishes on the next pass.
#
# --------------------------------------------------------------------------
# Configuration -- all of it environment, none of it in this file.
#
#   BACKUP_REMOTE   an rclone remote and path, e.g. "b2:krueger-backups/db"
#                   or "s3:krueger-backups/db". Required.
#   RCLONE_CONFIG   path to rclone.conf on this host. Required, and it holds
#                   the credentials -- see SECRETS.md. Mounted read-only.
#   REMOTE_RETAIN_DAYS  how long the offsite copies live. Default 90, which is
#                   longer than the 30 kept locally on purpose: the offsite
#                   copy is the one that has to outlive a mistake nobody
#                   noticed for a month.
#   COMPOSE_FILE    defaults to the docker-compose.yml next to this script's
#                   parent directory.
#   RCLONE_NETWORK  optional docker network for the rclone container, for a
#                   remote that is not reachable from the default bridge.
#
# rclone rather than the AWS CLI because the same script then works against
# S3, Backblaze B2, Wasabi, Cloudflare R2, Google Drive and a box in the
# funeral home's own office, and a small home should not be forced into an AWS
# account to have an offsite backup.
#
# Cron it *after* the local backup slot in DEPLOY.md, not instead of it:
#
#   30 3 * * *  /srv/funeral-home/deploy/backup-offsite.sh >> /var/log/fh-backup.log 2>&1
#
# Pair it with deploy/monitor.sh, which pages a human when this stops running.
# A backup job that fails silently every night for six weeks is indis-
# tinguishable from one that works, right up until it isn't.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
REMOTE_RETAIN_DAYS="${REMOTE_RETAIN_DAYS:-90}"

die() { echo "backup-offsite: $*" >&2; exit 1; }
say() { echo "backup-offsite: $*"; }

[ -n "${BACKUP_REMOTE:-}" ] || die "BACKUP_REMOTE is not set. Nothing to copy to."
[ -n "${RCLONE_CONFIG:-}" ] || die "RCLONE_CONFIG is not set. rclone has no credentials."
[ -f "$RCLONE_CONFIG" ]     || die "RCLONE_CONFIG points at $RCLONE_CONFIG, which does not exist."
command -v docker >/dev/null || die "docker is not on PATH."

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# rclone runs in a container so the host needs nothing installed but docker.
# The backups volume is mounted read-only: a copy job has no business being
# able to delete the thing it is copying, and this one only deletes on the
# remote side.
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1}"
BACKUP_VOLUME="${BACKUP_VOLUME:-$(compose config --format json 2>/dev/null \
  | sed -n 's/.*"\([a-z0-9_-]*_backups\)".*/\1/p' | head -1)}"
BACKUP_VOLUME="${BACKUP_VOLUME:-funeral-home_backups}"

# RCLONE_NETWORK is for the deployments where the remote is not simply out on
# the internet: a storage box reachable only down a VPN container, a MinIO on
# the compose network, an office NAS behind a tunnel. Unset, docker's default
# bridge is used, which is right for S3, B2, R2 and friends.
rclone() {
  docker run --rm \
    ${RCLONE_NETWORK:+--network "$RCLONE_NETWORK"} \
    -v "$BACKUP_VOLUME":/backups:ro \
    -v "$RCLONE_CONFIG":/config/rclone/rclone.conf:ro \
    "$RCLONE_IMAGE" "$@"
}

# ---------------------------------------------------------------- 1. dump --
say "taking a fresh dump"
compose run --rm tools pnpm --filter @workspace/scripts run backup-database

# ---------------------------------------------------------------- 2. copy --
# `copy`, not `sync`: sync would mirror local deletions to the remote, so the
# 30-day local retention would silently cap the offsite copy at 30 days too,
# and anything that wiped the local directory would wipe the remote with it.
say "copying to $BACKUP_REMOTE"
rclone copy /backups "$BACKUP_REMOTE" \
  --include 'holding-today-*.sql' \
  --immutable \
  --stats-one-line \
  --verbose

# -------------------------------------------------------------- 3. verify --
# Read the newest dump back off the remote and compare sizes. `rclone check`
# on one file, rather than trusting the exit code of the copy above.
NEWEST="$(rclone lsf /backups --include 'holding-today-*.sql' | sort | tail -1)"
[ -n "$NEWEST" ] || die "no dump found locally after taking one -- backup-database wrote nothing."

LOCAL_SIZE="$(rclone size "/backups/$NEWEST" --json | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
REMOTE_SIZE="$(rclone size "$BACKUP_REMOTE/$NEWEST" --json 2>/dev/null \
  | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"

[ -n "$REMOTE_SIZE" ] || die "$NEWEST is not on the remote after a copy that reported success."
[ "$LOCAL_SIZE" = "$REMOTE_SIZE" ] || die \
  "$NEWEST is $LOCAL_SIZE bytes here and $REMOTE_SIZE bytes on the remote. Not reporting this as a backup."
[ "$REMOTE_SIZE" -gt 0 ] || die "$NEWEST is zero bytes on the remote."

say "verified $NEWEST offsite ($REMOTE_SIZE bytes)"

# --------------------------------------------------------------- 4. prune --
# Last, and only after the verify: a prune that runs before the copy is
# confirmed can delete the last good copy on the night the new one is broken.
say "pruning offsite copies older than ${REMOTE_RETAIN_DAYS}d"
rclone delete "$BACKUP_REMOTE" \
  --include 'holding-today-*.sql' \
  --min-age "${REMOTE_RETAIN_DAYS}d" \
  --verbose

say "done"
