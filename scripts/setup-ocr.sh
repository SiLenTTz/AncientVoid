#!/usr/bin/env bash
# T7.10: German (and English) OCR data for tesseract, without root.
#   scripts/setup-ocr.sh [dir]   → prints the hub.config.json snippet
set -euo pipefail
dir="${1:-$HOME/.local/share/ancientvoid/tessdata}"
mkdir -p "$dir"
for lang in deu eng osd; do
  [ -s "$dir/$lang.traineddata" ] || curl -fsSL -o "$dir/$lang.traineddata" "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$lang.traineddata"
done
tesseract --list-langs --tessdata-dir "$dir" 2>&1 | tail -3
echo "hub.config.json: \"ocr\": { \"tessdataDir\": \"$dir\" }"
