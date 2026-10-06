#!/usr/bin/env bash
# Renders the Quarto project (index.qmd and tests/pages/*.qmd) into docs/.
# Usage: ./render.sh [file.qmd ...]   (default: everything in _quarto.yml)
# Paths are relative to the repo root, e.g. tests/pages/d-panzoom-selective.qmd.
set -euo pipefail
cd "$(dirname "$0")/.."
quarto render "$@"
