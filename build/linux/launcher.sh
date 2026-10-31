#!/bin/bash
# Skrypt startowy Kadr Studio (Linux). Prawdziwy plik wykonywalny Electrona to <nazwa>.bin obok tego skryptu.
#
# Dlaczego: Chromium sprawdza piaskownicę ZANIM wykona się kod aplikacji, więc flagi --no-sandbox nie da się
# ustawić z JavaScriptu. Na systemach z zablokowanymi user namespaces (np. Ubuntu 23.10+ / 24.04 z AppArmor)
# start bez tej flagi kończy się błędem "The SUID sandbox helper binary was found, but is not configured correctly".
#
# Zasada: piaskownica zostaje WŁĄCZONA zawsze, gdy system na to pozwala (user namespaces albo chrome-sandbox z SUID root).
# Flaga --no-sandbox jest dodawana tylko wtedy, gdy inaczej aplikacja by się nie uruchomiła.
# Wymuszenie wyłączenia: KADR_NO_SANDBOX=1

SELF="$(readlink -f "$0")"
HERE="$(dirname "$SELF")"
BIN="$SELF.bin"

userns_blocked() {
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] && return 0
  command -v unshare >/dev/null 2>&1 && ! unshare --user true >/dev/null 2>&1 && return 0
  return 1
}

suid_sandbox_ok() {
  [ -u "$HERE/chrome-sandbox" ] && [ "$(stat -c %u "$HERE/chrome-sandbox" 2>/dev/null)" = "0" ]
}

extra=()
if [ "${KADR_NO_SANDBOX:-}" = "1" ] || [ "$(id -u)" = "0" ]; then
  extra+=(--no-sandbox)                       # root: Chromium i tak odmawia startu z piaskownicą
elif userns_blocked && ! suid_sandbox_ok; then
  extra+=(--no-sandbox)
fi

exec "$BIN" "${extra[@]}" "$@"
