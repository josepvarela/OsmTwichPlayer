#!/usr/bin/env bash
# Calcula la versión compartida por los releases de Android (APK) y Tizen (.wgt).
#
# La secuencia nueva se guarda en tags internos osmtwich-version-vX.Y.Z.
# Así se ignoran por completo los tags históricos vX.Y.Z (incluido el antiguo
# 2.11.x) y se mantiene la secuencia acordada:
# 2.7.1 -> ... -> 2.7.9 -> 2.8.0 -> ...
#
# Ambos workflows comparten el mismo tag interno para un mismo commit.
set -euo pipefail

START="${VERSION_START:-2.7.1}"
SEQUENCE_TAG_RE='^osmtwich-version-v[0-9]+\.[0-9]+\.[0-9]+$'
HEAD_SHA="$(git rev-parse HEAD)"

EXISTING="$(git tag --points-at "$HEAD_SHA" | grep -E "$SEQUENCE_TAG_RE" | sed 's/^osmtwich-version-v//' | sort -V | tail -n1 || true)"

if [ -n "$EXISTING" ]; then
  VERSION="$EXISTING"
  echo "Reutilizando la versión interna de este commit: $VERSION" >&2
else
  LAST="$(git tag --list 'osmtwich-version-v*' | grep -E "$SEQUENCE_TAG_RE" | sed 's/^osmtwich-version-v//' | sort -V | tail -n1 || true)"
  if [ -z "$LAST" ]; then
    VERSION="$START"
  else
    IFS=. read -r MA MI PA <<< "$LAST"
    if [ "$PA" -ge 9 ]; then
      MI=$((MI + 1))
      PA=0
    else
      PA=$((PA + 1))
    fi
    VERSION="$MA.$MI.$PA"
  fi
  echo "Última versión de la secuencia: ${LAST:-ninguna} -> nueva versión: $VERSION" >&2
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "APP_VERSION=$VERSION" >> "$GITHUB_ENV"
fi
echo "$VERSION"
