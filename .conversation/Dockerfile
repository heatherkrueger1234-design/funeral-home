# The API server, and the toolbox that goes with it.
#
# Three stages:
#   build   — pnpm, the whole workspace, every devDependency
#   tools   — that same workspace, kept, because migrations, backups and the
#             aftercare sender run from TypeScript sources through tsx
#   runtime — the esbuild bundle and nothing else (the default target)
#
# Base is bookworm-slim rather than alpine on purpose. sharp ships prebuilt
# binaries against glibc; on musl it either falls back to a source build that
# needs a toolchain in the image, or it installs and then dies the first time a
# family uploads a photograph. Not a failure worth saving 40MB for.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Manifests first, so editing source code does not invalidate the dependency
# layer. The lockfile comes with them and is installed frozen, so the image is
# built from exactly the versions CI tested.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/director-console/package.json ./artifacts/director-console/
COPY artifacts/family-portal/package.json ./artifacts/family-portal/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/mailer/package.json ./lib/mailer/
COPY scripts/package.json ./scripts/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @workspace/api-server run build

# Resolve the server's runtime dependency tree on its own, so the runtime image
# does not carry esbuild, vitest and the React toolchain.
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /runtime

# ---------------------------------------------------------------------------
# Tools — migrations, backups, restores, the aftercare sender
# ---------------------------------------------------------------------------
# Deliberately the full workspace. drizzle-kit reads the schema as TypeScript,
# and every script in scripts/ runs through tsx; there is no compiled form of
# either to copy into a slim image. Build it with `--target tools`.
FROM build AS tools

# The Postgres client comes from PGDG, NOT from Debian's `postgresql-client`.
#
# Bookworm's default is client 15, and `pg_dump` flatly refuses to dump a
# server newer than itself: against the postgres:16 in docker-compose.yml it
# exits 1 with "server version: 16.15; pg_dump version: 15.19" and writes
# nothing. Every backup would have failed, quietly, in exactly the deployment
# the backup drill exists to protect — and the drill itself runs on the host,
# where the client happens to match, so it would never have caught this.
#
# It must MATCH the server's major version — not exceed it. Newer is not
# safer here, and the obvious reasoning is wrong in both directions:
#
#   client 15 against a 16 server: pg_dump refuses outright, exits 1, writes
#   nothing. No backup is taken.
#
#   client 17 against a 16 server: pg_dump succeeds and produces a dump that
#   will not restore — it writes `SET transaction_timeout`, a parameter that
#   only exists from 17, and psql on the 16 server aborts on it. That is the
#   worse failure of the two, because it looks like a working backup right up
#   until the morning somebody needs it.
#
# Both were observed here, in this order. Keep this in step with the postgres
# image in docker-compose.yml.
ARG PG_MAJOR=16
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}" \
  && apt-get purge -y --auto-remove gnupg \
  && rm -rf /var/lib/apt/lists/*

# Fail the build rather than ship an image whose backups cannot run.
#
# This only proves apt installed the version that was asked for; it cannot
# know the server's version, which is not reachable at build time. The check
# that actually matters happens in `backup-database`, which can see both.
RUN pg_dump --version \
  && pg_dump --version | grep -qE "PostgreSQL\) ${PG_MAJOR}\." \
  && psql --version | grep -qE "PostgreSQL\) ${PG_MAJOR}\."

ENV NODE_ENV=production

# Nothing here is a server. It is run one command at a time, by a scheduler or
# by a person at 3am, so the default is the shell that will be typed into.
CMD ["bash"]

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

# tini, because node as PID 1 does not reap children or forward SIGTERM, and
# the pino transport is a worker child.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=4311

WORKDIR /app

COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /app/artifacts/api-server/dist ./dist

# A fixed high uid rather than the stock `node` user: the numeric id is what a
# Kubernetes runAsUser or a bind-mounted volume actually checks.
RUN groupadd --gid 10001 app \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
  && chown -R 10001:10001 /app
USER 10001:10001

EXPOSE 4311

# Checks the database too — see routes/health.ts. A process that is listening
# but cannot reach Postgres serves an error on every screen, and calling that
# healthy keeps it in the load balancer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4311)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
