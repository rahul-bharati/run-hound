#!/bin/sh
# Entrypoint for the Run Hound image.
#
# 1. Arguments that are Run Hound commands (serve, run, ai, accounts, help, --version) go to the CLI, so
#      docker run ... run-hound run http://localhost:5173/signup --approve all
#    works. Anything else (e.g. `bash`) is run as given.
# 2. Reports go to /repo/app/runs. When that folder is bind-mounted from your machine, the CLI runs as the
#    folder's owner, so the reports on your machine belong to you and you can delete them without sudo.
#    Without a mount it runs as the image's non-root user (pwuser). It never stays root on a rootful engine
#    except when it can't drop privileges at all. The AI settings and test accounts the compose files keep in
#    runs/.config belong to that same user, and nothing is written world-writable.
set -eu

RUNS=/repo/app/runs
CLI="/repo/node_modules/.bin/tsx src/cli.ts"

case "${1:-}" in
  serve | run | ai | accounts | help | version | --help | -h | --version | -v)
    if [ "$1" = serve ] && [ -n "${RUNHOUND_PUBLIC_URL:-}" ]; then
      echo "Run Hound UI: open ${RUNHOUND_PUBLIC_URL} in your browser. (The 0.0.0.0 address below is inside the container; on your machine the port is bound to 127.0.0.1 only.)" >&2
    fi
    # shellcheck disable=SC2086
    set -- $CLI "$@"
    ;;
esac

# Already started as a non-root user (docker run --user ...): nothing to switch.
if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

mkdir -p "$RUNS"
owner=$(stat -c %u "$RUNS")
group=$(stat -c %g "$RUNS")

# Rootless engines (Podman, rootless Docker) map container root to your own user; rootful Docker maps it
# to the real root. /proc/self/uid_map is "0 0 4294967295" only on a rootful engine.
rootful=no
if awk 'NR == 1 && $1 == 0 && $2 == 0 && $3 == 4294967295 { found = 1 } END { exit !found }' /proc/self/uid_map; then
  rootful=yes
fi

as_user() {
  uid=$1
  gid=$2
  shift 2
  home=/tmp
  [ "$uid" = "$(id -u pwuser)" ] && home=/home/pwuser
  exec setpriv --reuid="$uid" --regid="$gid" --clear-groups env HOME="$home" "$@"
}

# The settings folder (ai.json, accounts.json), when it lives in the runs folder (both compose files set
# RUNHOUND_CONFIG_DIR to runs/.config): give it to the user the CLI runs as, the runs folder's owner. An earlier
# start may have left it owned by another uid, and the files (0600 in a 0700 folder) would then be neither readable
# nor writable.
take_config() {
  config=${RUNHOUND_CONFIG_DIR:-$RUNS/.config}
  case "$config" in
    "$RUNS"/*) ;;
    *) return 0 ;;
  esac
  if [ -d "$config" ] && [ ! -L "$config" ]; then
    chown -R -P "$1:$2" "$config" 2>/dev/null || true
  fi
}

if [ "$owner" != 0 ]; then
  # The image's own folder (pwuser) or a folder from your machine owned by you: run as that owner.
  take_config "$owner" "$group"
  as_user "$owner" "$group" "$@"
fi

if [ "$rootful" = no ]; then
  # Rootless: root here is your own user on the host, so reports written as root belong to you.
  take_config 0 0
  exec "$@"
fi

# Rootful engine and a root-owned folder: usually Docker created ./runs itself because it didn't exist.
# Hand the folder to pwuser and write with the usual modes (never world-writable): the reports then belong to
# pwuser's uid on your machine too, and deleting them needs sudo.
pw_uid=$(id -u pwuser)
pw_gid=$(id -g pwuser)
echo "run-hound: the reports folder is owned by root (Docker created it), so it is given to the image's user (uid $pw_uid);" >&2
echo "run-hound: deleting the reports will need sudo. Next time create it yourself first (mkdir -p runs) so the files belong to you." >&2
if ! chown "$pw_uid:$pw_gid" "$RUNS" 2>/dev/null; then
  echo "run-hound: could not change the owner of the reports folder, so reports can't be written. Create it yourself (mkdir -p runs) and start again." >&2
fi
take_config "$pw_uid" "$pw_gid"
as_user "$pw_uid" "$pw_gid" "$@"
