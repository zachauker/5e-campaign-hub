#!/bin/sh
set -e
chown -R nextjs:nodejs /data
exec su-exec nextjs node server.js
