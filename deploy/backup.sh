#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: backup.sh /absolute/backup/directory" >&2
  exit 2
fi

backup_dir=$1
case "$backup_dir" in
  /*) ;;
  *) echo "Backup directory must be absolute." >&2; exit 2 ;;
esac

mkdir -p "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
for target in "$backup_dir/sitechronicle-$timestamp.dump" "$backup_dir/sitechronicle-artifacts-$timestamp.tar.gz" "$backup_dir/sitechronicle-$timestamp.sha256"; do
  [ ! -e "$target" ] || { echo "Refusing to overwrite backup file: $target" >&2; exit 2; }
done
docker compose exec -T postgres pg_dump -U sitechronicle -d sitechronicle -Fc > "$backup_dir/sitechronicle-$timestamp.dump"
docker compose run --rm --no-deps -v "$backup_dir:/backup" api sh -c "tar -C /data -czf /backup/sitechronicle-artifacts-$timestamp.tar.gz artifacts"
(cd "$backup_dir" && sha256sum "sitechronicle-$timestamp.dump" "sitechronicle-artifacts-$timestamp.tar.gz" > "sitechronicle-$timestamp.sha256")
echo "Backup created at $backup_dir ($timestamp)."
