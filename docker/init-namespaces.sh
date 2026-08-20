#!/bin/sh
set -eu

ADDR="${TEMPORAL_ADDRESS:-temporal:7233}"
echo "Esperando Temporal en ${ADDR}..."

i=0
until temporal operator cluster health --address "${ADDR}" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "Temporal no respondió a tiempo."
    exit 1
  fi
  sleep 2
done

echo "Creando namespaces (Apache 2.0, sin licencia comercial)..."
temporal operator namespace create --namespace synckre-public --address "${ADDR}" 2>/dev/null || \
  temporal operator namespace create synckre-public --address "${ADDR}" 2>/dev/null || \
  echo "namespace synckre-public ya existe o se creó."

temporal operator namespace create --namespace synckre-internal --address "${ADDR}" 2>/dev/null || \
  temporal operator namespace create synckre-internal --address "${ADDR}" 2>/dev/null || \
  echo "namespace synckre-internal ya existe o se creó."

echo "Namespaces listos: synckre-public, synckre-internal"
echo "Task queues: synckre-public, synckre-internal (las crea el primer worker)"
