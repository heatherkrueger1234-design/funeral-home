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

  [ -n "${ACME_CA:-}" ] \
    && warn "ACME_CA is set, so certificates will come from Let's Encrypt's staging CA and browsers will not trust them. Right for a first run; unset it once one issues cleanly." \
    || ok "ACME_CA is unset, so certificates will be real"
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
