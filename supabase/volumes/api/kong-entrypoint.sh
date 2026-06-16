#!/bin/sh
set -eu

mkdir -p /usr/local/kong

sed \
  -e "s|\${SUPABASE_ANON_KEY}|${SUPABASE_ANON_KEY}|g" \
  -e "s|\${SUPABASE_SERVICE_KEY}|${SUPABASE_SERVICE_KEY}|g" \
  /home/kong/temp.yml > /usr/local/kong/kong.yml

exec /entrypoint.sh kong docker-start "$@"
