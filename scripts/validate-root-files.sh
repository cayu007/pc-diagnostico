#!/usr/bin/env bash
set -euo pipefail

suspicious_files=""

while IFS= read -r path; do
  name="${path#./}"
  if [[ "$name" =~ [\(\)\{\}] ]]; then
    suspicious_files+="$name"$'\n'
  fi
done < <(find . -maxdepth 1 -mindepth 1 -type f)

if [[ -n "$suspicious_files" ]]; then
  echo "❌ Se detectaron archivos sospechosos en la raíz (paréntesis/llaves en el nombre):"
  printf '%s' "$suspicious_files"
  exit 1
fi

echo "✅ Validación de archivos raíz completada sin hallazgos."
