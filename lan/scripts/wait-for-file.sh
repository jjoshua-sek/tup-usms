#!/bin/sh
# Waits up to two minutes for a file to appear (Caddy writes its local root
# certificate on first start), so Node never starts without trusting it.
file="$1"
[ -z "$file" ] && exit 0
i=0
while [ ! -s "$file" ]; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then
    echo "Timed out waiting for $file" >&2
    exit 1
  fi
  sleep 1
done
