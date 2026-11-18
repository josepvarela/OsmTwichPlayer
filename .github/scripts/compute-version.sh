#!/usr/bin/env bash
# Calcula la versión compartida por los releases de Android (APK) y Tizen (.wgt).
#
# Esquema: 2.7.1 -> 2.7.2 -> ... -> 2.7.9 -> 2.8.0 -> 2.8.1 -> ... -> 2.8.9 -> 2.9.0 ...
#   * La primera versión de este esquema es START (2.7.1).
#   * Cada build nuevo sube el patch (0..9); tras el .9 sube el minor y el patch vuelve a 0.
#
# La fuente de verdad son los tags vX.Y.Z del repo (cada release crea el suyo):
#   * Si el commit actual ya tiene un tag de versión (lo creó el otro workflow,
#     Android o Tizen, en este mismo push), se reutiliza: ambos publican la
#     MISMA versión en el MISMO release.
#   * Si no, se toma el tag más alto y se calcula el siguiente.
#   * Si no hay tags, o el más alto es menor que START, se arranca en START.
#
# Requiere checkout con fetch-depth: 0 (para ver todos los tags).
# Escribe APP_VERSION en $GITHUB_ENV (si existe) y lo imprime por stdout.
set -euo pipefail

START="${VERSION_START:-2.7.1}"
VERSION_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'

HEAD_SHA="$(git rev-parse HEAD)"

EXISTING="$(git tag --points-at "$HEAD_SHA" | grep -E "$VERSION_RE" | sed 's/^v//' | sort -V | tail -n1 || true)"

if [ -n "$EXISTING" ]; then
  VERSION="$EXISTING"
  echo "Reutilizando la versión del tag existente en este commit: v$VERSION" >&2
else
  LAST="$(git tag --list | grep -E "$VERSION_RE" | sed 's/^v//' | sort -V | tail -n1 || true)"
  if [ -z "$LAST" ]; then
    VERSION="$START"
  elif [ "$LAST" != "$START" ] && [ "$(printf '%s\n%s\n' "$LAST" "$START" | sort -V | head -n1)" = "$LAST" ]; then
    # El último tag es anterior a START (p. ej. 2.7.0): se salta a START.
    VERSION="$START"
  else
    IFS=. read -r MA MI PA <<< "$LAST"
    if [ "$PA" -ge 9 ]; then
      MI=$((MI + 1)); PA=0
    else
      PA=$((PA + 1))
    fi
    VERSION="$MA.$MI.$PA"
  fi
  echo "Último tag: ${LAST:-ninguno} -> nueva versión: $VERSION" >&2
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "APP_VERSION=$VERSION" >> "$GITHUB_ENV"
fi
echo "$VERSION"
