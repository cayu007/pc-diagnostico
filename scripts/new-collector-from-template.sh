#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Uso: $0 <nombre-script> <directorio-destino>"
  echo "Ejemplo: $0 inventory src-tauri/resources"
  exit 1
fi

script_name="$1"
dest_dir="$2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$repo_root/templates/collector-template.ps1"

if [[ ! -f "$template" ]]; then
  echo "❌ No existe la plantilla base: $template"
  exit 1
fi

mkdir -p "$dest_dir"

script_file="$dest_dir/${script_name}.ps1"
notes_file="$dest_dir/${script_name}.template-notes.md"

if [[ -e "$script_file" ]]; then
  echo "❌ Ya existe: $script_file"
  exit 1
fi

cp "$template" "$script_file"
sed -i "s/collector-template/${script_name}/g" "$script_file"

cat > "$notes_file" <<NOTES
# Notas de plantilla: ${script_name}

Este script fue creado desde templates/collector-template.ps1.

## Checklist para repos nuevos (importante por .gitignore)

Cuando uses esta estructura en otro repositorio, recuerda crear/configurar manualmente:

- node_modules/ (se genera con npm install, no viaja por git).
- dist/, src-tauri/target/ y otros artefactos de build (se regeneran en CI/local).
- Archivos .env / .env.* (no versionados, usar .env.example).
- Configuración local de IDE (.vscode/*, .idea/) según equipo.

## Siguiente paso recomendado

1. Editar ${script_file} y completar funciones de recolección para tu nueva tarea.
2. Adaptar el contrato JSON final para el frontend/backend del proyecto destino.
3. Si aplica, agregar tests o validadores para tu script.
NOTES

echo "✅ Script creado: $script_file"
echo "✅ Notas creadas: $notes_file"
