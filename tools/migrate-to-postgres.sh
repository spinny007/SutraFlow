#!/bin/sh
# Moves SutraFlow from SQLite to PostgreSQL on Linux and macOS: stops it, copies the data, points
# sutraflow.env at PostgreSQL, starts it again and checks it (back to SQLite if anything fails).
# The PostgreSQL connection is the one saved on the Admin Console's Database page, or give
# --url postgres://user:password@host:5432/sutraflow. Add --replace to overwrite SutraFlow tables
# already in that database. Node.js: SUTRA_NODE, else from sutraflow.env, else node on the PATH.
here=$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0" 2>/dev/null || echo "$0")")" && pwd)
envfile=${SUTRAFLOW_ENV:-$here/../sutraflow.env}
if [ -z "$SUTRA_NODE" ] && [ -f "$envfile" ]; then
  SUTRA_NODE=$(sed -n 's/^[[:space:]]*SUTRA_NODE[[:space:]]*=[[:space:]]*//p' "$envfile" | tail -n 1 | tr -d '\r')
fi
exec "${SUTRA_NODE:-node}" "$here/migrate-to-postgres.mjs" --env "$envfile" "$@"
