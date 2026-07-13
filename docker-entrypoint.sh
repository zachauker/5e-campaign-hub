#!/bin/sh
set -e
chown -R nextjs:nodejs /data
exec gosu nextjs node server.js
