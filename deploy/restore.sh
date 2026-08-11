#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: CONFIRM_RESTORE=yes restore.sh /absolute/backup/directory YYYYMMDDTHHMMSSZ" >&2
  exit 2
fi
if [ "${CONFIRM_RESTORE:-}" != yes ]; then
  echo "Restore replaces the database. Re-run with CONFIRM_RESTORE=yes after verifying the target server." >&2
  exit 2
fi

backup_dir=$1
timestamp=$2
case "$backup_dir" in /*) ;; *) echo "Backup directory must be absolute." >&2; exit 2;; esac
case "$timestamp" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) echo "Invalid backup timestamp." >&2; exit 2;; esac

dump_file="$backup_dir/sitechronicle-$timestamp.dump"
artifact_file="$backup_dir/sitechronicle-artifacts-$timestamp.tar.gz"
checksum_file="$backup_dir/sitechronicle-$timestamp.sha256"
for file in "$dump_file" "$artifact_file" "$checksum_file"; do
  [ -f "$file" ] && [ ! -L "$file" ] || { echo "Missing or unsafe backup file: $file" >&2; exit 2; }
done
dump_name="sitechronicle-$timestamp.dump"
artifact_name="sitechronicle-artifacts-$timestamp.tar.gz"
if ! awk -v dump="$dump_name" -v artifacts="$artifact_name" '
  NF != 2 || length($1) != 64 || $1 !~ /^[0-9a-f]+$/ { exit 1 }
  $2 == dump { dump_seen++ ; next }
  $2 == artifacts { artifacts_seen++ ; next }
  { exit 1 }
  END { if (NR != 2 || dump_seen != 1 || artifacts_seen != 1) exit 1 }
' "$checksum_file"; then
  echo "Checksum manifest contains unexpected entries." >&2
  exit 2
fi
(cd "$backup_dir" && sha256sum -c "sitechronicle-$timestamp.sha256")
if tar -tzf "$artifact_file" | awk '!/^artifacts(\/|$)/ || /^\// || /(^|\/)\.\.($|\/)/ { bad=1 } END { exit bad ? 0 : 1 }'; then
  echo "Artifact archive contains an unsafe path." >&2
  exit 2
fi
if tar -tvzf "$artifact_file" | awk 'substr($1,1,1) == "l" || substr($1,1,1) == "h" { bad=1 } END { exit bad ? 0 : 1 }'; then
  echo "Artifact archive contains links and cannot be restored safely." >&2
  exit 2
fi

docker compose stop api worker
docker compose exec -T postgres pg_restore -U sitechronicle -d sitechronicle --clean --if-exists --no-owner < "$dump_file"
docker compose run --rm --no-deps -v "$backup_dir:/backup:ro" api sh -c "tar -C /data -xzf /backup/sitechronicle-artifacts-$timestamp.tar.gz"
docker compose start api worker
echo "Restore completed from $timestamp. Verify /api/readiness and a sample artifact hash."
