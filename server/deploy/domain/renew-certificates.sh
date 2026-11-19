#!/bin/sh
set -eu
exec 9> /run/calendar-cert-renew.lock
flock -n 9 || exit 0
docker run --rm \
  -v /opt/my-life/calendar/domain/letsencrypt:/etc/letsencrypt \
  -v /opt/my-life/calendar/domain/acme:/var/www/acme \
  certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20 \
  renew --quiet "$@"
docker exec calendar-edge nginx -t
docker exec calendar-edge nginx -s reload
