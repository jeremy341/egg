state="$HOME/.fake-systemd"; mkdir -p "$state"
cmd="$1"; unit="${2:-}"
unitfile="$HOME/units/$unit"
pidfile="$state/$unit.pid"
alive() { [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; }
case "$cmd" in
  daemon-reload) exit 0 ;;
  # A timer is "armed" while its enabled marker exists, which is what enable --now and disable --now toggle.
  enable) case "$unit" in *.timer) touch "$state/$unit.enabled";; esac; exit 0 ;;
  disable) rm -f "$state/$unit.enabled"; exit 0 ;;
  show)
    echo "LoadState=$([ -f "$unitfile" ] && echo loaded || echo not-found)"
    case "$unit" in
      *.timer) echo "ActiveState=$([ -f "$state/$unit.enabled" ] && echo active || echo inactive)"; echo "SubState=waiting"; exit 0 ;;
    esac
    # A oneshot job: what the last run left behind in the result file ("<exit code> <epoch seconds>").
    if [ -f "$unitfile" ] && grep -q '^Type=oneshot' "$unitfile"; then
      if [ -f "$state/$unit.result" ]; then
        read -r code stamp < "$state/$unit.result"
        if [ "$code" = 0 ]; then echo "ActiveState=inactive"; echo "Result=success"; else echo "ActiveState=failed"; echo "Result=exit-code"; fi
        echo "SubState=dead"; echo "ExecMainStatus=$code"
        echo "ExecMainExitTimestamp=$(date -u -d "@$stamp" '+%a %Y-%m-%d %H:%M:%S UTC')"
      else
        echo "ActiveState=inactive"; echo "SubState=dead"; echo "Result=success"; echo "ExecMainStatus=0"; echo "ExecMainExitTimestamp="
      fi
      exit 0
    fi
    if alive; then
      pid=$(cat "$pidfile")
      echo "ActiveState=active"; echo "SubState=running"; echo "MainPID=$pid"; echo "NRestarts=0"
      echo "MemoryCurrent=$(awk '/VmRSS/{print $2*1024}' /proc/$pid/status 2>/dev/null || echo 0)"
      echo "ActiveEnterTimestampMonotonic=$(awk '{print $22*10000}' /proc/$pid/stat 2>/dev/null || echo 0)"
    else
      echo "ActiveState=$([ -f "$unitfile" ] && echo failed || echo inactive)"; echo "SubState=dead"; echo "MainPID=0"
      echo "MemoryCurrent=18446744073709551615"
    fi
    exit 0 ;;
  is-system-running) echo running; exit 0 ;;
  # Only the scopes that are running, one line each, the way `systemctl list-units --plain` prints them.
  # A file named list-units-fails in the state folder makes it fail, like a systemctl that cannot answer.
  list-units)
    [ -f "$state/list-units-fails" ] && { echo "Failed to list units" >&2; exit 1; }
    for f in "$state"/egg-build-*.scope.pid; do
      [ -f "$f" ] || continue
      kill -0 "$(cat "$f")" 2>/dev/null || continue
      n=$(basename "$f" .pid)
      echo "$n loaded active running Egg build scope"
    done
    exit 0 ;;
  is-active) if alive; then echo active; else echo failed; fi; exit 0 ;;
  stop) case "$unit" in *.scope) [ -f "$pidfile" ] || exit 5;; esac  # a scope that is not running cannot be stopped, as on a real container
        alive && kill "$(cat "$pidfile")" 2>/dev/null; rm -f "$pidfile"; exit 0 ;;
  restart|start)
    [ -f "$unitfile" ] || { echo "Unit $unit not found" >&2; exit 5; }
    # A oneshot job runs to the end here (a real container would run it in the background) and keeps its result.
    if grep -q '^Type=oneshot' "$unitfile"; then
      wd=$(grep '^WorkingDirectory=' "$unitfile" | cut -d= -f2-)
      envfile=$(grep '^EnvironmentFile=' "$unitfile" | cut -d= -f2- | sed 's/^-//')
      start=$(grep '^ExecStart=' "$unitfile" | sed -E 's/^ExecStart=\/bin\/bash -lc "(.*)"$/\1/')
      ( cd "$(cd "$wd" && pwd -P)" && set -a && { [ -f "$envfile" ] && . "$envfile"; true; } && set +a && bash -c "$start" ) >"$state/$unit.log" 2>&1
      echo "$? $(date +%s)" > "$state/$unit.result"
      exit 0
    fi
    alive && kill "$(cat "$pidfile")" 2>/dev/null
    wd=$(grep '^WorkingDirectory=' "$unitfile" | cut -d= -f2-)
    envfile=$(grep '^EnvironmentFile=' "$unitfile" | cut -d= -f2-)
    port=$(grep '^Environment=PORT=' "$unitfile" | sed 's/^Environment=PORT=//')
    start=$(grep '^ExecStart=' "$unitfile" | sed -E 's/^ExecStart=\/bin\/bash -lc "(.*)"$/\1/')
    # resolve the symlink so the process does not pin the link itself (Windows)
    cd "$(cd "$wd" && pwd -P)" || exit 1
    ( set -a; [ -f "$envfile" ] && . "$envfile"; set +a; export PORT="$port"; setsid nohup bash -c "$start" >"$state/$unit.log" 2>&1 < /dev/null & echo $! > "$pidfile" )
    sleep 0.4
    exit 0 ;;
  *) echo "fake systemctl: unsupported $cmd" >&2; exit 1 ;;
esac
