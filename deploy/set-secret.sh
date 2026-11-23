#!/bin/sh
# Sets one variable in .env without showing its value.
#
#   ./set-secret.sh RAZORPAY_KEY_SECRET        asks for the value; nothing is echoed
#   ./set-secret.sh --unset RAZORPAY_KEY_SECRET
#
# The value is read from the terminal, so it never appears in the shell history or in the
# process list. The previous .env is kept next to it as .env.bak-<time>. Run ./restart.sh
# afterwards so the app picks the change up.
set -eu

usage() {
  echo "Usage: $0 [--unset] NAME" >&2
  exit 2
}

unset_only=0
if [ "${1:-}" = "--unset" ]; then
  unset_only=1
  shift
fi
[ $# -eq 1 ] || usage
name=$1
if ! printf '%s' "$name" | grep -Eq '^[A-Z][A-Z0-9_]*$'; then
  echo "NAME must be capital letters, digits and underscores, for example RAZORPAY_KEY_ID" >&2
  exit 2
fi

dir=$(cd "$(dirname "$0")" && pwd)
env_file=${ENV_FILE:-$dir/.env}
# .env may be a link to a file kept outside the release folder; write to the real file.
if [ -L "$env_file" ]; then
  env_file=$(readlink -f "$env_file")
fi
if [ ! -f "$env_file" ]; then
  echo "$env_file does not exist. Copy .env.example to .env first." >&2
  exit 1
fi

value=''
if [ "$unset_only" -eq 0 ]; then
  if [ -t 0 ]; then
    printf 'Value for %s (input is hidden): ' "$name" >&2
    stty -echo
    trap 'stty echo' EXIT INT TERM
    IFS= read -r value || true
    stty echo
    trap - EXIT INT TERM
    printf '\n' >&2
  else
    IFS= read -r value || true
  fi
  if [ -z "$value" ]; then
    echo "No value given; $name was not changed." >&2
    exit 1
  fi
fi

umask 077
tmp=$(mktemp "$env_file.tmp.XXXXXX")
trap 'rm -f "$tmp"' EXIT
grep -v -E "^[[:space:]]*(export[[:space:]]+)?$name=" "$env_file" > "$tmp" || true
if [ "$unset_only" -eq 0 ]; then
  # Single quotes keep every character as typed. A value that itself holds a single quote is
  # written in double quotes, with the characters Compose treats specially escaped.
  case $value in
    *"'"*)
      escaped=$(printf '%s' "$value" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\$/\\$/g')
      printf '%s="%s"\n' "$name" "$escaped" >> "$tmp"
      ;;
    *)
      printf "%s='%s'\n" "$name" "$value" >> "$tmp"
      ;;
  esac
fi

cp -p "$env_file" "$env_file.bak-$(date -u +%Y%m%dT%H%M%SZ)"
chmod 600 "$tmp"
mv "$tmp" "$env_file"
trap - EXIT
if [ "$unset_only" -eq 1 ]; then
  echo "$name removed"
else
  echo "$name set"
fi
