#!/bin/sh
# Container entrypoint: make the cache volume writable, then run the server as
# the unprivileged `node` user. Home Assistant's Supervisor mounts /data owned
# by root, so the ownership fix has to happen at start, not at build time.
set -e
if [ "$(id -u)" = 0 ]; then
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups node server.mjs
fi
exec node server.mjs
