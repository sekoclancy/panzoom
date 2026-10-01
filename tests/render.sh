#!/usr/bin/env bash
# Renders the Quarto project (index.qmd and tests/pages/*.qmd) into docs/.
# Usage: ./render.sh [file.qmd ...]   (default: everything in _quarto.yml)
# Paths are relative to the repo root, e.g. tests/pages/d-panzoom-selective.qmd.
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep a personal ~/.Rprofile (e.g. one that activates renv) out of renders.
R_PROFILE_USER=/dev/null quarto render "$@"
