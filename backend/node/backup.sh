#!/usr/bin/env bash
# Respaldo de la base de Supabase al servidor propio.
# Programar con cron, por ejemplo cada 6 horas:
#   0 */6 * * * DATABASE_URL='postgres://...' /ruta/backend/node/backup.sh >> /var/log/xuacha-backup.log 2>&1
# Restaurar:  pg_restore --clean --if-exists --no-owner -d "$DESTINO" archivo.dump
set -euo pipefail

: "${DATABASE_URL:?definir DATABASE_URL}"
DIR="${BACKUP_DIR:-$HOME/xuacha-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "$DIR"
chmod 700 "$DIR"
FILE="$DIR/xuacha-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump "$DATABASE_URL" --schema=public --format=custom --no-owner --file="$FILE"
chmod 600 "$FILE"
find "$DIR" -name 'xuacha-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) respaldo creado: $FILE ($(du -h "$FILE" | cut -f1))"
