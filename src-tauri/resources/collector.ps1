$ErrorActionPreference = "SilentlyContinue"

function SafeRun([scriptblock]$sb) {
  try { & $sb } catch { $null }
}

function Get-PerfValue($className, $propName, $filter = $null) {
  SafeRun {
    if ($filter) {
      $x = Get-CimInstance $className -Filter $filter | Select-Object -First 1
    } else {
      $x = Get-CimInstance $className | Select-Object -First 1
    }
    if ($x -and ($x.PSObject.Properties.Name -contains $propName)) { return $x.$propName }
    return $null
  }
}

function TopProcsCpu($top=10) {
  $procs = Get-Process |
    Where-Object { $_.Id -ne 0 } |
    Select-Object Name, Id, CPU, WorkingSet64, Path |
    Sort-Object CPU -Descending |
    Select-Object -First $top

  $out = @()
  foreach($p in $procs){
    $path = $p.Path
    if (-not $path) {
      $path = SafeRun { (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.Id) | Select-Object -First 1 -ExpandProperty ExecutablePath) }
    }
    $out += [pscustomobject]@{
      Name = $p.Name
      Id = $p.Id
      CPU = $p.CPU
      WorkingSet64 = $p.WorkingSet64
      Path = $path
    }
  }
  return $out
}

function TopProcsRam($top=10) {
  $procs = Get-Process |
    Where-Object { $_.Id -ne 0 } |
    Select-Object Name, Id, CPU, WorkingSet64, Path |
    Sort-Object WorkingSet64 -Descending |
    Select-Object -First $top

  $out = @()
  foreach($p in $procs){
    $path = $p.Path
    if (-not $path) {
      $path = SafeRun { (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.Id) | Select-Object -First 1 -ExpandProperty ExecutablePath) }
    }
    $out += [pscustomobject]@{
      Name = $p.Name
      Id = $p.Id
      CPU = $p.CPU
      WorkingSet64 = $p.WorkingSet64
      Path = $path
    }
  }
  return $out
}

function ToIso($dt) {
  if ($dt -is [datetime]) { return $dt.ToString("o") }
  $parsed = SafeRun { [datetime]$dt }
  if ($parsed) { return $parsed.ToString("o") }
  return $null
}

# ------------------------------
# FAST SPACE SCAN (smart)
# ------------------------------
function Get-FolderBytesRobo([string]$path) {
  if (-not (Test-Path $path)) { return $null }

  # robocopy /L enumerates quickly (no copy). Output is localized but usually contains "Bytes".
  $dest = Join-Path $env:TEMP "_rcnull"
  $out = SafeRun {
    robocopy $path $dest /L /S /BYTES /NFL /NDL /NJH /NJS /NC /NS /NP
  }

  if ($out) {
    # Try to find a line containing "Bytes" and extract a number (can include dots/commas/spaces)
    $line = $out | Where-Object { $_ -match "Bytes" } | Select-Object -Last 1
    if ($line) {
      $m = [regex]::Match($line, ":\s*([0-9\.,\s]+)\s+Bytes")
      if ($m.Success) {
        $num = ($m.Groups[1].Value -replace "[\s\.,]", "")
        if ($num -match "^\d+$") { return [int64]$num }
      }
      # Fallback: last big number in the line
      $m2 = [regex]::Match($line, "([0-9]{1,3}([ \.,][0-9]{3})+)")
      if ($m2.Success) {
        $num2 = ($m2.Groups[1].Value -replace "[\s\.,]", "")
        if ($num2 -match "^\d+$") { return [int64]$num2 }
      }
    }
  }

  # Fallback slower (still limited to target folders only)
  $sum = SafeRun {
    (Get-ChildItem -LiteralPath $path -File -Recurse -Force -ErrorAction SilentlyContinue |
      Measure-Object -Property Length -Sum).Sum
  }
  return $sum
}

function BytesToGB([int64]$b) {
  if ($b -eq $null) { return $null }
  return [math]::Round(($b / 1GB), 2)
}

# --- Base system info ---
$os  = Get-CimInstance Win32_OperatingSystem
$cs  = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1

# --- CPU / RAM without Get-Counter ---
$cpuPct = Get-PerfValue "Win32_PerfFormattedData_PerfOS_Processor" "PercentProcessorTime" "Name='_Total'"
if ($cpuPct -eq $null -and $cpu.LoadPercentage -ne $null) { $cpuPct = [double]$cpu.LoadPercentage }

$ramAvailMB = Get-PerfValue "Win32_PerfFormattedData_PerfOS_Memory" "AvailableMBytes"
if ($ramAvailMB -eq $null -and $os.FreePhysicalMemory -ne $null) { $ramAvailMB = [math]::Round(([double]$os.FreePhysicalMemory / 1024), 0) }

$totalRamGB = [math]::Round($cs.TotalPhysicalMemory/1GB,2)
$uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours,2)

# --- Volumes ---
$volumes = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
  Select-Object DeviceID, VolumeName,
    @{n="SizeGB";e={[math]::Round($_.Size/1GB,2)}},
    @{n="FreeGB";e={[math]::Round($_.FreeSpace/1GB,2)}},
    @{n="FreePct";e={ if($_.Size -gt 0){ [math]::Round(($_.FreeSpace/$_.Size)*100,2) } else { $null } }}

# --- Physical disks (best effort) ---
$physicalDisks = @()
$pd = SafeRun { Get-PhysicalDisk }
if ($pd) {
  $physicalDisks = $pd | Select-Object FriendlyName, SerialNumber, MediaType, BusType, HealthStatus, OperationalStatus, Size
} else {
  $physicalDisks = Get-CimInstance Win32_DiskDrive |
    Select-Object Model, SerialNumber, InterfaceType, @{n="Size";e={$_.Size}}
}

# --- Disk perf (best effort via perf class) ---
$diskPerf = @{
  avgSecRead  = $null
  avgSecWrite = $null
  avgQueue    = $null
}
$dp = SafeRun { Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" | Select-Object -First 1 }
if ($dp) {
  if ($dp.PSObject.Properties.Name -contains "AvgDisksecPerRead")  { $diskPerf.avgSecRead  = [math]::Round([double]$dp.AvgDisksecPerRead, 4) }
  if ($dp.PSObject.Properties.Name -contains "AvgDisksecPerWrite") { $diskPerf.avgSecWrite = [math]::Round([double]$dp.AvgDisksecPerWrite, 4) }
  if ($dp.PSObject.Properties.Name -contains "AvgDiskQueueLength") { $diskPerf.avgQueue    = [math]::Round([double]$dp.AvgDiskQueueLength, 4) }
}

# --- Network basic ---
$adapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
  Select-Object Name, InterfaceDescription, Status, LinkSpeed, MacAddress

$pingMs = $null
$ping = SafeRun { Test-Connection -ComputerName 1.1.1.1 -Count 1 -ErrorAction Stop }
if ($ping) { $pingMs = [math]::Round([double]$ping.ResponseTime, 0) }

# --- Startup sources ---
$startupRun = @()
$runKeys = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
)
foreach($k in $runKeys){
  if(Test-Path $k){
    $p = Get-ItemProperty $k
    $p.PSObject.Properties |
      Where-Object { $_.Name -notmatch "^PS" } |
      ForEach-Object {
        $startupRun += [pscustomobject]@{ Source="RunKey"; Location=$k; Name=$_.Name; Command=$_.Value; Enabled=$true }
      }
  }
}


# --- Disabled Run keys (managed by this app): <Run>Disabled ---
$startupRunDisabled = @()
foreach($k in $runKeys){
  $kd = "${k}Disabled"
  if(Test-Path $kd){
    $p = Get-ItemProperty $kd
    $p.PSObject.Properties |
      Where-Object { $_.Name -notmatch "^PS" } |
      ForEach-Object {
        # IMPORTANT: Location points to the *Run* key, backend will derive RunDisabled by appending 'Disabled'
        $startupRunDisabled += [pscustomobject]@{ Source="RunKey"; Location=$k; Name=$_.Name; Command=$_.Value; Enabled=$false }
      }
  }
}

$startupFolder = @()
$startupPaths = @(
  [Environment]::GetFolderPath("Startup"),
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
)
foreach($p in $startupPaths){
  if(Test-Path $p){
    Get-ChildItem -Path $p -File -ErrorAction SilentlyContinue | ForEach-Object {
      $startupFolder += [pscustomobject]@{
        Source="StartupFolder"
        Location=$p
        Name=$_.Name
        Command=$_.FullName
        Enabled=$true
      }
    }
  }
}


# --- Disabled StartupFolder items (moved by this app) ---
$startupFolderDisabled = @()
foreach($p in $startupPaths){
  $disabledDir = Join-Path $p "PCDiagnostico_Disabled"
  if(Test-Path $disabledDir){
    Get-ChildItem -Path $disabledDir -File -ErrorAction SilentlyContinue | ForEach-Object {
      # IMPORTANT: Location points to the *Startup folder base*, backend will derive disabled dir by appending PCDiagnostico_Disabled
      $startupFolderDisabled += [pscustomobject]@{
        Source="StartupFolder"
        Location=$p
        Name=$_.Name
        Command=$_.FullName
        Enabled=$false
      }
    }
  }
}

$startupTasks = @()
$tasks = SafeRun { Get-ScheduledTask }
if ($tasks) {
  foreach($t in $tasks) {
    $triggers = SafeRun { $t.Triggers }
    if ($triggers) {
      foreach($tr in $triggers) {
        if ($tr -and $tr.TriggerType -eq "Logon") {
          $state = SafeRun { (Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath).State }
          $startupTasks += [pscustomobject]@{
            Source="ScheduledTask"
            Name=$t.TaskName
            Path=$t.TaskPath
            State=$state
            Enabled=($state -ne $null -and $state -ne "Disabled")
          }
          break
        }
      }
    }
  }
  $startupTasks = $startupTasks | Select-Object -First 50
}

# --- Services: auto-start but not running ---
$autoStoppedServices = Get-CimInstance Win32_Service |
  Where-Object { $_.StartMode -eq "Auto" -and $_.State -ne "Running" } |
  Select-Object Name, DisplayName, State, StartMode |
  Select-Object -First 30

# --- Windows Update errors (last 48h) ---
$since = (Get-Date).AddHours(-48)

$wuErrors = Get-WinEvent -FilterHashtable @{
  LogName="System"
  ProviderName="Microsoft-Windows-WindowsUpdateClient"
  StartTime=$since
} -MaxEvents 50 |
Select-Object @{ n="TimeCreated"; e={ $_.TimeCreated.ToString("o") } }, Id, LevelDisplayName, Message

$wuErrorCount = ($wuErrors | Where-Object { $_.LevelDisplayName -in @("Error","Critical") }).Count

# --- Event logs: System + Application (crashes) ---
$sysCrit = Get-WinEvent -FilterHashtable @{LogName="System"; Level=1,2; StartTime=$since} -MaxEvents 30 |
  Select-Object @{ n="TimeCreated"; e={ $_.TimeCreated.ToString("o") } }, Id, ProviderName, LevelDisplayName, Message

$appErrors = Get-WinEvent -FilterHashtable @{LogName="Application"; Level=1,2; StartTime=$since} -MaxEvents 30 |
  Select-Object @{ n="TimeCreated"; e={ $_.TimeCreated.ToString("o") } }, Id, ProviderName, LevelDisplayName, Message

# ------------------------------
# SPACE ANALYSIS (targets)
# ------------------------------
$user = $env:USERPROFILE
$targets = @(
  @{ key="Downloads"; path=(Join-Path $user "Downloads") },
  @{ key="TempUser";  path=$env:TEMP },
  @{ key="TempWin";   path="C:\Windows\Temp" },
  @{ key="Packages";  path=(Join-Path $user "AppData\Local\Packages") },
  @{ key="Docker";    path=(Join-Path $user "AppData\Local\Docker") },
  @{ key="WSL";       path=(Join-Path $user ".wsl") }
)

$folderSizes = @()
foreach($t in $targets){
  $b = Get-FolderBytesRobo $t.path
  if ($b -ne $null) {
    $folderSizes += [pscustomobject]@{
      key = $t.key
      path = $t.path
      bytes = [int64]$b
      sizeGB = (BytesToGB $b)
    }
  } else {
    $folderSizes += [pscustomobject]@{
      key = $t.key
      path = $t.path
      bytes = $null
      sizeGB = $null
    }
  }
}

$topFolders = $folderSizes |
  Where-Object { $_.bytes -ne $null } |
  Sort-Object bytes -Descending |
  Select-Object -First 10

# --- Findings + score ---
$findings = @()
$score = 100

$c = $volumes | Where-Object { $_.DeviceID -eq "C:" } | Select-Object -First 1
if($c -and $c.FreePct -ne $null){
  if($c.FreePct -lt 10){
    $findings += [pscustomobject]@{
      severity="high"; title="C: muy lleno"
      detail=("Libre {0} GB ({1}%)." -f $c.FreeGB,$c.FreePct)
      recommendation="Libera espacio (temporales, descargas, apps grandes). Ideal: >15% libre."
    }
    $score -= 25
  } elseif($c.FreePct -lt 15){
    $findings += [pscustomobject]@{
      severity="med"; title="C: con poco espacio"
      detail=("Libre {0} GB ({1}%)." -f $c.FreeGB,$c.FreePct)
      recommendation="Mantén >15% libre para rendimiento y actualizaciones."
    }
    $score -= 15
  }
}

# Space findings from top folders
foreach($f in $topFolders){
  if ($f.sizeGB -ge 10) {
    $findings += [pscustomobject]@{
      severity="high"
      title=("Carpeta grande: {0}" -f $f.key)
      detail=("{0} ocupa ~{1} GB" -f $f.path, $f.sizeGB)
      recommendation="Revisa y borra/mueve archivos grandes. Usa Almacenamiento o Limpieza de disco."
    }
    $score -= 8
  } elseif ($f.sizeGB -ge 5) {
    $findings += [pscustomobject]@{
      severity="med"
      title=("Carpeta pesada: {0}" -f $f.key)
      detail=("{0} ocupa ~{1} GB" -f $f.path, $f.sizeGB)
      recommendation="Si no lo necesitas, limpia esa carpeta o mueve datos a otra unidad."
    }
    $score -= 4
  }
}

if($ramAvailMB -ne $null -and $ramAvailMB -lt 800){
  $findings += [pscustomobject]@{
    severity="high"; title="RAM muy baja"
    detail=("Disponible: {0} MB." -f $ramAvailMB)
    recommendation="Cierra apps pesadas o revisa procesos en segundo plano; considera ampliar RAM."
  }
  $score -= 20
} elseif($ramAvailMB -ne $null -and $ramAvailMB -lt 1500){
  $findings += [pscustomobject]@{
    severity="med"; title="RAM algo justa"
    detail=("Disponible: {0} MB." -f $ramAvailMB)
    recommendation="Si hay tirones, revisa consumo de memoria y apps de inicio."
  }
  $score -= 10
}

if($uptimeHours -gt 168){
  $findings += [pscustomobject]@{
    severity="med"; title="Uptime alto"
    detail=("Lleva {0} horas sin reiniciar." -f $uptimeHours)
    recommendation="Reiniciar puede resolver fugas de memoria y actualizar componentes."
  }
  $score -= 5
}

$startupCount = ($startupRun.Count + $startupFolder.Count + $startupTasks.Count)
if($startupCount -ge 20){
  $findings += [pscustomobject]@{
    severity="med"; title="Muchos elementos de inicio"
    detail=("Elementos detectados: {0} (Run/Startup/Tasks)." -f $startupCount)
    recommendation="Reduce apps de inicio para mejorar arranque y consumo en segundo plano."
  }
  $score -= 10
}

if($wuErrorCount -ge 3){
  $findings += [pscustomobject]@{
    severity="med"; title="Errores de Windows Update"
    detail=("Errores en 48h: {0}." -f $wuErrorCount)
    recommendation="Abre Windows Update, reintenta, revisa almacenamiento y apps bloqueando instalaciones."
  }
  $score -= 10
}

if(($autoStoppedServices | Measure-Object).Count -gt 0){
  $findings += [pscustomobject]@{
    severity="low"; title="Servicios automáticos no activos"
    detail=("Detectados {0} (muestra hasta 30)." -f ($autoStoppedServices | Measure-Object).Count)
    recommendation="Si notas fallos de funciones, revisa servicios automáticos detenidos."
  }
  $score -= 5
}

if($diskPerf.avgSecRead -ne $null -and $diskPerf.avgSecRead -gt 0.05){
  $findings += [pscustomobject]@{
    severity="high"; title="Lectura de disco lenta"
    detail=("Avg sec/read: {0}s" -f $diskPerf.avgSecRead)
    recommendation="Puede haber saturación, antivirus o disco degradado; revisa IO y espacio libre."
  }
  $score -= 15
} elseif($diskPerf.avgSecRead -ne $null -and $diskPerf.avgSecRead -gt 0.02){
  $findings += [pscustomobject]@{
    severity="med"; title="Lectura de disco algo lenta"
    detail=("Avg sec/read: {0}s" -f $diskPerf.avgSecRead)
    recommendation="Si hay lentitud, revisa procesos con IO alto y espacio libre."
  }
  $score -= 8
}

if(($appErrors | Measure-Object).Count -ge 5){
  $findings += [pscustomobject]@{
    severity="med"; title="Errores de aplicaciones frecuentes"
    detail=("Eventos Application (Error/Critical) en 48h: {0}." -f ($appErrors | Measure-Object).Count)
    recommendation="Revisa apps que fallan y drivers; puede correlacionar con lentitud o cierres."
  }
  $score -= 10
}

if($score -lt 0){ $score = 0 }

# --- Report object ---
$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  health = @{
    score = $score
    findings = $findings
  }
  system = @{
    hostname = $env:COMPUTERNAME
    user = $env:USERNAME
    os = @{
      caption = $os.Caption
      version = $os.Version
      build = $os.BuildNumber
      lastBootIso = (ToIso $os.LastBootUpTime)
      uptimeHours = $uptimeHours
    }
    cpu = @{
      name = $cpu.Name
      cores = $cpu.NumberOfCores
      logical = $cpu.NumberOfLogicalProcessors
      loadPct = [math]::Round([double]$cpuPct,2)
    }
    memory = @{
      totalGB = $totalRamGB
      availableMB = $ramAvailMB
    }
    volumes = $volumes
    physicalDisks = $physicalDisks
  }
  spaceAnalysis = @{
    targets = $folderSizes
    topFolders = $topFolders
  }
  performance = @{
    disk = @{
      avgQueueLength = $diskPerf.avgQueue
      avgSecRead = $diskPerf.avgSecRead
      avgSecWrite = $diskPerf.avgSecWrite
    }
    topProcessesByCPU = TopProcsCpu 10
    topProcessesByRAM = TopProcsRam 10
  }
  startup = @{
    items = @($startupRun + $startupFolder + $startupRunDisabled + $startupFolderDisabled)
    logonTasks = $startupTasks
    counts = @{
      runKeys = $startupRun.Count
      startupFolder = $startupFolder.Count
      logonTasks = $startupTasks.Count
      total = $startupCount
    }
  }
  services = @{
    autoStopped = $autoStoppedServices
  }
  network = @{
    adapters = $adapters
    pingMs_1_1_1_1 = $pingMs
  }
  updates = @{
    windowsUpdateSystemEvents48h = $wuErrors
    windowsUpdateErrorCount48h = $wuErrorCount
  }
  events = @{
    systemCritical48h = $sysCrit
    applicationCritical48h = $appErrors
  }
}

# Save report WITHOUT BOM
$json = $report | ConvertTo-Json -Depth 14
[System.IO.File]::WriteAllText(".\report.json", $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "OK"