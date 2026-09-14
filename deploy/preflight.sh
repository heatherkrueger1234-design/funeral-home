#!/usr/bin/env bash
#
# Everything that must be true before `docker compose up` on a real host.
#
# Run it, fix what it says, run it again. It changes nothing and is safe to
# run as many times as you like.
#
# The reason this exists rather than a page of instructions: the two mistakes
# that cost the most are both invisible at `up` time. DNS that does not point
# here yet means Let's Encrypt fails the HTTP-01 challenge, and it allows five
# failures per hostname per hour -- so a typo locks you out for the rest of
# the hour at exactly the moment you are iterating. And an env file missing
# one value brings the stack up in a state that looks fine until a director
# tries to sign in.
#
#   ./deploy/preflight.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

FAIL=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=1; }

echo "Preflight for $ROOT"
echo

# ------------------------------------------------------------------ tools --
echo "Tools"
command -v docker >/dev/null && ok "docker" || bad "docker is not installed"
docker compose version >/dev/null 2>&1 && ok "docker compose" || bad "docker compose v2 is not available"
docker info >/dev/null 2>&1 && ok "the docker daemon is running" || bad "cannot talk to the docker daemon"
echo

# -------------------------------------------------------------------- env --
echo "Configuration"
if [ ! -f "$ENV_FILE" ]; then
  bad "$ENV_FILE does not exist — cp .env.example .env and fill it in"
else
  ok "$ENV_FILE exists"

  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
  case "$perms" in
    600|400) ok ".env is not world-readable ($perms)" ;;
    ?)       warn "could not read the permissions on .env" ;;
    *)       warn ".env is mode $perms — chmod 600 it; it holds every secret this host has" ;;
  esac

  # Sourced in a subshell: this script must never carry a secret in its own
  # environment, and nothing below prints a value.
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE" 2>/dev/null; set +a

  for name in POSTGRES_PASSWORD ENCRYPTION_KEY FAMILY_PORTAL_URL CONSOLE_URL; do
    if [ -z "${!name:-}" ]; then
      bad "$name is empty — the stack will refuse to start"
    else
      ok "$name is set"
    fi
  done

  # 32 bytes, base64, is 44 characters ending in '='. Checking the shape
  # catches a truncated paste, which otherwise fails at runtime as a
  # decryption error nobody connects to this.
  if [ -n "${ENCRYPTION_KEY:-}" ]; then
    if [ "${#ENCRYPTION_KEY}" -eq 44 ]; then
      ok "ENCRYPTION_KEY is the right length for 32 bytes of base64"
    else
      bad "ENCRYPTION_KEY is ${#ENCRYPTION_KEY} characters; 32 bytes of base64 is 44"
    fi
  fi

  for name in SMTP_HOST SMTP_USER SMTP_PASS; do
    [ -n "${!name:-}" ] || warn "$name is empty — password resets will be written to the log instead of sent"
  done

  if [ -z "${TASK_SECRET:-}" ]; then
    warn "TASK_SECRET is empty — the aftercare endpoint will refuse every caller, so grief check-ins never go out"
  else
    ok "TASK_SECRET is set"
  fi

  # The URLs go into links that are texted and emailed to families. A wrong
  # scheme here sends somebody to a page that does not load.
  for name in FAMILY_PORTAL_URL CONSOLE_URL; do
    v="${!name:-}"
    case "$v" in
      https://*) case "$v" in */) warn "$name has a trailing slash; links will contain //" ;; *) ok "$name looks right" ;; esac ;;
      http://*)  bad "$name is http:// — the session cookie is Secure in production and will not come back" ;;
      "")        : ;;
      *)         bad "$name has no scheme" ;;
    esac
  done
fi
echo

# -------------------------------------------------------------------- TLS --
echo "TLS"
if [ -z "${FAMILY_DOMAIN:-}" ] || [ -z "${CONSOLE_DOMAIN:-}" ]; then
  warn "FAMILY_DOMAIN/CONSOLE_DOMAIN are not set — you are not using docker-compose.tls.yml,"
  warn "which means plain HTTP, which means sign-in will silently fail in production"
else
  [ -n "${ACME_EMAIL:-}" ] && ok "ACME_EMAIL is set" \
    || bad "ACME_EMAIL is empty — Let's Encrypt sends expiry warnings there"

  # What the world thinks this host is. Falls back quietly if there is no
  # egress; the DNS comparison is skipped rather than reported as a failure.
  PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$PUBLIC_IP" ] && ok "this host looks like $PUBLIC_IP from outside" \
    || warn "could not determine this host's public address; skipping the DNS check"

  for d in "$FAMILY_DOMAIN" "$CONSOLE_DOMAIN"; do
    resolved="$(getent ahostsv4 "$d" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
    if [ -z "${resolved// /}" ]; then
      bad "$d does not resolve — Let's Encrypt will fail, and it only allows five failures an hour"
    elif [ -z "$PUBLIC_IP" ]; then
      ok "$d resolves to ${resolved% }"
    elif printf '%s' "$resolved" | grep -qw "$PUBLIC_IP"; then
      ok "$d points at this host"
    else
      bad "$d resolves to ${resolved% }, which is not this host ($PUBLIC_IP)"
    fi
  done

  # Port 80 must be free for the HTTP-01 challenge and port 443 for everything
  # after it. Say so when there is no way to look rather than reporting the
  # ports clear -- a check that cannot run is not a check that passed, and
  # this one silently claimed :80 was free on a host where it was not.
  if command -v ss >/dev/null; then LISTENERS="$(ss -ltnH 2>/dev/null)"
  elif command -v netstat >/dev/null; then LISTENERS="$(netstat -ltn 2>/dev/null)"
  else LISTENERS=""; fi

  if [ -z "$LISTENERS" ]; then
    warn "neither ss nor netstat is available, so :80 and :443 were not checked — if something else is already bound there, Caddy will fail to start"
  else
    for port in 80 443; do
      if printf '%s\n' "$LISTENERS" | awk '{print $4}' | grep -qE "[:.]${port}\$"; then
        # Our own Caddy holding them is the normal case on a re-run.
        if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q "caddy.*:${port}->"; then
          ok ":$port is held by this deployment's own Caddy"
        else
          bad "something else is already listening on :$port — Caddy will not be able to bind it"
        fi
      else
        ok ":$port is free"
      fi
    done
  fi

  # Free is not the same question as reachable, and only the second one is
  # what Let's Encrypt asks. A cloud firewall or security group that never
  # allowed :80 inbound is invisible from inside the host -- the port is
  # genuinely free, nothing is misconfigured locally, and the HTTP-01
  # challenge still fails. That is the 2am one, because the machine looks
  # perfect from the machine.
  #
  # So: bind a listener on :80 for a moment and try to fetch a random token
  # back through this host's own public address. A success is proof. A
  # failure is *not* proof of the opposite -- plenty of providers do not
  # route a host's own traffic back to itself (hairpin NAT) -- so that case
  # is reported as inconclusive rather than as a pass or a fail. A check
  # that cannot run is not a check that passed.
  if [ -n "$PUBLIC_IP" ] && command -v python3 >/dev/null; then
    if printf '%s\n' "${LISTENERS:-}" | awk '{print $4}' | grep -qE '[:.]80$'; then
      warn "something is already bound to :80, so its reachability from the internet was not tested"
    else
      TOKEN="preflight-$$-$(date +%s)"
      python3 - "$TOKEN" <<'PY' &
import http.server, socketserver, sys
token = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers()
        self.wfile.write(token.encode())
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
# serve_forever, not handle_request: two requests are made against this --
# one through loopback to prove the listener is up, then one through the
# public address. Serving only the first would leave the second hitting a
# closed socket, and the check would report "unreachable from outside" on
# every host in the world.
with socketserver.TCPServer(("", 80), H) as s:
    s.serve_forever()
PY
      PROBE_PID=$!
      sleep 1

      # Through loopback first. If our own listener cannot even be reached on
      # this host then the probe proved nothing about the firewall, and
      # saying "check your firewall" would send somebody to the wrong place
      # for an hour. Almost always it means something already holds :80 that
      # neither ss nor netstat was here to show us.
      LOCAL_SEEN="$(curl -fsS --max-time 5 "http://127.0.0.1/$TOKEN" 2>/dev/null || true)"
      if [ "$LOCAL_SEEN" = "$TOKEN" ]; then
        SEEN="$(curl -fsS --max-time 8 "http://$PUBLIC_IP/$TOKEN" 2>/dev/null || true)"
      else
        SEEN=""
      fi

      kill "$PROBE_PID" 2>/dev/null
      wait "$PROBE_PID" 2>/dev/null

      if [ "$LOCAL_SEEN" != "$TOKEN" ]; then
        bad "could not bind and reach a test listener on :80 on this host itself. Something"
        bad "else is holding the port — find it with 'lsof -i :80' or 'fuser 80/tcp' and stop"
        bad "it, or Caddy will fail to start and no certificate will ever issue."
      elif [ "$SEEN" = "$TOKEN" ]; then
        ok ":80 is reachable from outside this host — the HTTP-01 challenge can complete"
      else
        warn "this host answers on :80 locally but not via $PUBLIC_IP. Often that is only the"
        warn "provider declining to route a host's traffic back to itself, and nothing is"
        warn "wrong. But if the first staging certificate fails, open :80 inbound in the"
        warn "provider's firewall before retrying — it is the usual cause and it is"
        warn "invisible from this side."
      fi
    fi
  fi

  [ -n "${ACME_CA:-}" ] \
    && warn "ACME_CA is set, so certificates will come from Let's Encrypt's staging CA and browsers will not trust them. Right for a first run; unset it once one issues cleanly." \
    || ok "ACME_CA is unset, so certificates will be real"
fi
echo

# ------------------------------------------------------------------ clock --
# A wrong clock breaks things that never say "your clock is wrong".
#
# A certificate issued while this host is running fast is `notBefore` the
# future as far as this host is concerned, so Caddy serves it and every
# browser rejects it. Session and password-reset expiry are computed here, so
# a host running slow hands out links that were dead before they were sent.
# And every age in deploy/monitor.sh -- backup freshness, whether aftercare
# ran -- is this clock minus a stored timestamp, so a skewed clock makes the
# monitor confidently wrong in whichever direction hurts more.
#
# Compared against Let's Encrypt's own server, because that is the clock that
# has to agree with this one.
echo "Clock"
REMOTE_DATE="$(curl -fsSI --max-time 15 https://acme-v02.api.letsencrypt.org/directory 2>/dev/null \
  | tr -d '\r' | awk 'tolower($1) == "date:" { sub(/^[Dd]ate: */, ""); print; exit }')"
if [ -z "$REMOTE_DATE" ]; then
  warn "could not reach an external clock to compare against; skew was not checked"
else
  SKEW=$(( $(date +%s) - $(date -d "$REMOTE_DATE" +%s) ))
  SKEW_ABS=${SKEW#-}
  if [ "$SKEW_ABS" -ge 300 ]; then
    bad "this host's clock is ${SKEW_ABS}s out. Install and start chrony or systemd-timesyncd,"
    bad "wait for it to settle, and run this again — certificates issued now may not validate."
  elif [ "$SKEW_ABS" -ge 30 ]; then
    warn "this host's clock is ${SKEW_ABS}s out. Tolerable, but no time daemon appears to be"
    warn "running — install chrony before it drifts far enough to matter."
  else
    ok "clock is within ${SKEW_ABS}s of real time"
  fi
fi
echo

# ------------------------------------------------------------------- disk --
# Enough room to take a dump, which is a different question from enough room
# to run. The night the disk is too full to back up is precisely the night
# before you need the backup, and `pg_dump` failing half way leaves a
# truncated file that looks like a backup in every listing.
#
# The multiplier is not padding. `pg_dump`'s plain format writes `bytea` as
# hex -- two characters per byte -- and this database's bulk is encrypted
# photographs, which are incompressible, so the dump of a photo-heavy home is
# roughly twice the size of the database it came from. Asking for 2x free is
# the floor, not the comfortable answer.
echo "Disk"
DISK_PATH="${DISK_PATH:-/var/lib/docker}"
[ -d "$DISK_PATH" ] || DISK_PATH=/
FREE_BYTES="$(df -PB1 "$DISK_PATH" 2>/dev/null | awk 'NR==2 {print $4}')"

if [ -z "$FREE_BYTES" ]; then
  bad "could not read free space on $DISK_PATH"
else
  human() { awk -v b="$1" 'BEGIN { split("B KiB MiB GiB TiB", u, " "); i = 1;
    while (b >= 1024 && i < 5) { b /= 1024; i++ }; printf "%.1f%s", b, u[i] }'; }

  # Ask the database how big it is, if it is up. On a first deployment it is
  # not, and there is nothing to dump yet -- so a floor is applied instead of
  # guessing, rather than reporting a pass nobody has earned.
  DB_BYTES="$(docker compose -f "$ROOT/docker-compose.yml" exec -T db \
    psql -U "${POSTGRES_USER:-funeral}" -d "${POSTGRES_DB:-funeral_home}" -tAc \
    "select pg_database_size(current_database())" 2>/dev/null | tr -dc '0-9')"

  if [ -z "$DB_BYTES" ]; then
    # 2 GiB is enough for the schema, the 33,791 postal centroids and a
    # pilot's first weeks. It is a floor to start on, not a capacity plan.
    NEED=$(( 2 * 1024 * 1024 * 1024 ))
    if [ "$FREE_BYTES" -lt "$NEED" ]; then
      bad "$(human "$FREE_BYTES") free on $DISK_PATH. Start with at least 2GiB free."
    else
      ok "$(human "$FREE_BYTES") free on $DISK_PATH (database not running, so nothing to size against yet)"
    fi
  else
    NEED=$(( DB_BYTES * 2 ))
    if [ "$FREE_BYTES" -lt "$NEED" ]; then
      bad "$(human "$FREE_BYTES") free on $DISK_PATH but a dump of this database needs about"
      bad "$(human "$NEED"). Prune old dumps in the backups volume, or grow the disk, before"
      bad "tonight's backup runs — a dump that runs out of room still leaves a file behind."
    elif [ "$FREE_BYTES" -lt $(( DB_BYTES * 3 )) ]; then
      warn "$(human "$FREE_BYTES") free on $DISK_PATH. Enough for one dump of $(human "$DB_BYTES"),"
      warn "with little left over. Grow the disk before the photographs do."
    else
      ok "$(human "$FREE_BYTES") free on $DISK_PATH, against a $(human "$DB_BYTES") database"
    fi
  fi
fi
echo

# ------------------------------------------------------- backups and alerts --
echo "Backups and alerting"
[ -n "${BACKUP_REMOTE:-}" ] && ok "BACKUP_REMOTE is set" \
  || warn "BACKUP_REMOTE is not set — backups will sit on the same disk as the database they protect"
if [ -n "${RCLONE_CONFIG:-}" ]; then
  [ -f "$RCLONE_CONFIG" ] && ok "rclone config found" || bad "RCLONE_CONFIG points at a file that does not exist"
fi
[ -n "${ALERT_WEBHOOK:-}" ] && ok "ALERT_WEBHOOK is set" \
  || warn "ALERT_WEBHOOK is not set — deploy/monitor.sh will refuse to run, and nothing will page anybody"
[ -n "${HEARTBEAT_URL:-}" ] && ok "HEARTBEAT_URL is set" \
  || warn "HEARTBEAT_URL is not set — nothing will notice if this host stops checking itself"
echo

if [ "$FAIL" -ne 0 ]; then
  echo "Not ready. Fix the FAILs above and run this again."
  exit 1
fi
echo "Ready. Bring it up with:"
echo "  docker compose run --rm tools pnpm --filter @workspace/db run push"
echo "  docker compose run --rm tools pnpm --filter @workspace/scripts run load-postal-codes"
echo "  docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d"
