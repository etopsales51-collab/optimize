#!/bin/sh
# Self-host container entrypoint. vite build inlines the envPrefix'd client
# envs (see vite.config.ts) into the bundle, so the build must run at container
# start — but the output stays valid until those envs or the image change.
# Fingerprint them and skip the build when the last start's output matches; an
# image update lands a fresh container with no build output, so new code always
# rebuilds.
set -e

echo 'OpenSEO sends an anonymous usage heartbeat (counts only). Disable: OPENSEO_TELEMETRY_DISABLED=1. Details: docs/SELF_HOSTING_DOCKER.md#telemetry'

# With CLOUDFLARE_INCLUDE_PROCESS_ENV, wrangler copies EVERY variable in this
# shell into dist/.dev.vars for vite preview, quoting each one. It refuses a
# value that holds a single quote AND a backtick AND a double quote, backslash
# or newline, and the whole build fails. No secret looks like that; a git
# commit message does, and Railway injects the latest one as
# RAILWAY_GIT_COMMIT_MESSAGE. That took the site down once. Free-text
# variables nothing at runtime reads are dropped outright, and anything else
# the preview could not serialize is dropped by name so the log says why.
unset RAILWAY_GIT_COMMIT_MESSAGE RAILWAY_GIT_AUTHOR
NL='
'
for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | sort -u); do
  eval "value=\${$name-}"
  case "$value" in *"'"*) ;; *) continue ;; esac
  case "$value" in *'`'*) ;; *) continue ;; esac
  case "$value" in
    *'"'*|*'\'*|*"$NL"*)
      unset "$name"
      echo "[warn] Dropped $name: its value mixes quote characters the preview env cannot serialize."
      ;;
  esac
done

# The preflight validates env BEFORE the slow steps, so misconfiguration fails
# in seconds with the exact fix instead of after a multi-minute build.
pnpm exec tsx scripts/selfhost-preflight.ts

pnpm run db:migrate:local

# POSTHOG_SOURCEMAPS (CI sourcemap uploads) moves vite's outDir; keep the
# fingerprint marker beside the output it describes.
if [ "${POSTHOG_SOURCEMAPS:-}" = "true" ]; then OUT_DIR=dist-sourcemaps; else OUT_DIR=dist; fi
FP_FILE="$OUT_DIR/.openseo-build-env"

# Everything that changes build output: the envPrefix prefixes from
# vite.config.ts (keep in sync) plus POSTHOG_SOURCEMAPS.
FINGERPRINT="$(env | grep -E '^(VITE_|AUTH_MODE|BYPASS_EMAIL_VERIFICATION|POSTHOG_PUBLIC_KEY|POSTHOG_HOST|TURNSTILE_SITE_KEY|POSTHOG_SOURCEMAPS)' | sort | sha256sum | cut -d' ' -f1)"
# A missing sha256sum would yield an empty, always-matching fingerprint and
# silently disable rebuilds — fail loudly instead.
test -n "$FINGERPRINT"

if [ -f "$FP_FILE" ] && [ "$(cat "$FP_FILE")" = "$FINGERPRINT" ]; then
  echo "Reusing existing build (build-relevant env unchanged)."
else
  echo "Building client + server (first start, changed build env, or new image)..."
  rm -f "$FP_FILE"
  pnpm run build
  printf '%s' "$FINGERPRINT" > "$FP_FILE"
fi

exec pnpm exec vite preview --host 0.0.0.0 --port "${PORT:-3001}"
