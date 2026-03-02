$ErrorActionPreference = "SilentlyContinue"

<#
.SYNOPSIS
  Plantilla base para scripts de recolección de diagnóstico.

.DESCRIPTION
  Esta plantilla replica el patrón usado en `collector.ps1` del repositorio:
  - Helper de ejecución segura (`SafeRun`).
  - Helpers de normalización (`ToIso`).
  - Secciones claras por dominio (sistema, procesos, red, etc.).
  - Salida final en JSON para consumo desde Tauri/Node.

.REQUIRED VARIABLES (inyectables desde caller)
  - $OutputPath: ruta absoluta o relativa donde guardar el JSON.
#>

param(
  [string]$OutputPath = "./report.json"
)

function SafeRun([scriptblock]$sb, $fallback = $null) {
  try {
    $result = & $sb
    if ($null -eq $result) { return $fallback }
    return $result
  }
  catch {
    return $fallback
  }
}

function ToIso($value) {
  if ($value -is [datetime]) { return $value.ToString("o") }
  $parsed = SafeRun { [datetime]$value }
  if ($parsed) { return $parsed.ToString("o") }
  return $null
}

function Get-SystemSummary {
  $os = SafeRun { Get-CimInstance Win32_OperatingSystem }
  $cs = SafeRun { Get-CimInstance Win32_ComputerSystem }

  [pscustomobject]@{
    computerName  = $env:COMPUTERNAME
    osCaption     = $os.Caption
    osVersion     = $os.Version
    totalRamGB    = if ($cs.TotalPhysicalMemory) { [math]::Round($cs.TotalPhysicalMemory / 1GB, 2) } else { $null }
    collectedAt   = (Get-Date).ToString("o")
    lastBootAt    = ToIso $os.LastBootUpTime
  }
}

function Get-TopProcesses([int]$top = 10) {
  $procs = SafeRun {
    Get-Process |
      Where-Object { $_.Id -gt 0 } |
      Sort-Object WorkingSet64 -Descending |
      Select-Object -First $top Name, Id, CPU, WorkingSet64, Path
  } @()

  return @($procs)
}

function Build-Report {
  $summary = Get-SystemSummary
  $topProcs = Get-TopProcesses -top 10

  # TODO: agrega aquí nuevas secciones para tu tarea
  # Ejemplos:
  # - inventario de software
  # - estado de servicios
  # - chequeos de red
  # - logs/eventos

  [pscustomobject]@{
    meta = [pscustomobject]@{
      scriptName = "collector-template"
      scriptVersion = "1.0.0"
      generatedAt = (Get-Date).ToString("o")
    }
    summary = $summary
    processes = $topProcs
  }
}

$report = Build-Report

# Asegura carpeta destino
$targetDir = Split-Path -Path $OutputPath -Parent
if ($targetDir -and -not (Test-Path $targetDir)) {
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$report | ConvertTo-Json -Depth 8 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Output $OutputPath
