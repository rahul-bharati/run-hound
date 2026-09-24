#!/bin/sh
# Entrypoint for the Run Hound image.
#
# 1. Arguments that are Run Hound commands (serve, run, help, --version) go to the CLI, so
#      docker run ... run-hound run http://localhost:5173/signup --approve all
#    works. Anything else (e.g. `bash`) is run as given.
# 2. Reports go to /repo/app/runs. When that folder is bind-mounted from your machine, the CLI runs as the
#    folder's owner, so the reports on your machine belong to you and you can delete them without sudo.
#    Without a mount it runs as the image's non-root user (pwuser). It never stays root on a rootful engine
#    except when it can't drop privileges at all.
set -eu

RUNS=/repo/app/runs
CLI="/repo/node_modules/.bin/tsx src/cli.ts"

case "${1:-}" in
  serve | run | help | version | --help | -h | --version | -v)
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

if [ "$owner" != 0 ]; then
  # The image's own folder (pwuser) or a folder from your machine owned by you: run as that owner.
  as_user "$owner" "$group" "$@"
fi

if [ "$rootful" = no ]; then
  # Rootless: root here is your own user on the host, so reports written as root belong to you.
  exec "$@"
fi

# Rootful engine and a root-owned folder: usually Docker created ./runs itself because it didn't exist.
# Make it writable for pwuser and write everything group/world-writable, so you can still delete it without sudo.
echo "run-hound: the reports folder is owned by root (Docker created it). Reports will still be written;" >&2
echo "run-hound: next time create it yourself first (mkdir -p runs) so the files belong to you." >&2
chmod 0777 "$RUNS" 2>/dev/null || true
umask 0000
as_user "$(id -u pwuser)" "$(id -g pwuser)" "$@"
