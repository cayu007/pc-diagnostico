#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::path::BaseDirectory;
use tauri::Manager;

#[tauri::command]
fn run_collector(app: tauri::AppHandle) -> Result<String, String> {
    // Carpeta de datos de la app (Tauri v2)
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener app_data_dir: {e}"))?;

    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // DEV: usar ruta absoluta basada en CARGO_MANIFEST_DIR (carpeta src-tauri)
    // BUILD: resolver desde Resources (bundle.resources)
    let script_path: PathBuf = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("collector.ps1")
    } else {
        app.path()
            .resolve("collector.ps1", BaseDirectory::Resource)
            .map_err(|e| format!("No se pudo resolver collector.ps1 desde Resources: {e}"))?
    };

    if !script_path.exists() {
        return Err(format!("No se encontró collector.ps1 en {:?}", script_path));
    }

    // Ejecuta PowerShell con working directory = data_dir (ahí se crea report.json)
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script_path)
        .current_dir(&data_dir)
        .output()
        .map_err(|e| format!("Error ejecutando PowerShell: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Collector falló.\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}"
        ));
    }

    // Lee el JSON generado
    let report_path = data_dir.join("report.json");
    let json = fs::read_to_string(&report_path)
        .map_err(|e| format!("No se pudo leer report.json en {:?}: {e}", report_path))?;

    Ok(json)
}

#[tauri::command]
fn open_action(action: String) -> Result<(), String> {
    // Acciones rápidas (sin admin)
    // Usamos cmd /C start para URIs tipo ms-settings:
    let mut target: Option<String> = None;

    match action.as_str() {
        "storage" => target = Some("ms-settings:storagesense".to_string()),
        "startup" => target = Some("ms-settings:startupapps".to_string()),
        "windowsupdate" => target = Some("ms-settings:windowsupdate".to_string()),
        "apps" => target = Some("ms-settings:appsfeatures".to_string()),
        "temp" => {
            // Abrir temp de usuario en explorer
            let p = std::env::temp_dir();
            return Command::new("explorer")
                .arg(p)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("No se pudo abrir TEMP: {e}"));
        }
        "cleanmgr" => {
            // Limpieza de disco clásica
            return Command::new("cleanmgr.exe")
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("No se pudo abrir cleanmgr: {e}"));
        }
        _ => {}
    }

    let Some(uri) = target else {
        return Err("Acción no soportada".to_string());
    };

    Command::new("cmd")
        .args(["/C", "start", "", &uri])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("No se pudo abrir acción: {e}"))
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    // Abre una carpeta (o selecciona un fichero) en el Explorador
    let p = PathBuf::from(path.clone());

    if !p.exists() {
        return Err(format!("La ruta no existe: {path}"));
    }

    // Si es directorio: explorer <path>
    // Si es fichero: explorer /select,<path>
    let mut cmd = Command::new("explorer");

    if p.is_dir() {
        cmd.arg(&p);
    } else {
        cmd.arg("/select,").arg(&p);
    }

    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("No se pudo abrir Explorer: {e}"))
}

#[tauri::command]
fn kill_process(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("PID inválido".to_string());
    }

    // taskkill funciona sin admin para procesos del usuario (si hay permisos)
    let out = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .output()
        .map_err(|e| format!("No se pudo ejecutar taskkill: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        return Err(format!(
            "No se pudo terminar el proceso.\n{stdout}\n{stderr}"
        ));
    }

    Ok(())
}

#[tauri::command]
fn toggle_startup_item(
    source: String,
    location: String,
    name: String,
    command: String,
    enabled: bool,
) -> Result<(), String> {
    // Contrato:
    // - enabled=true  => habilitar
    // - enabled=false => deshabilitar
    //
    // Soportamos:
    // - RunKey: mover valores entre ...\Run <-> ...\RunDisabled
    // - StartupFolder: mover accesos/archivos entre carpeta Startup <-> subcarpeta "PCDiagnostico_Disabled"
    //
    // Nota: HKLM puede requerir admin; si falla devolvemos error.

    match source.as_str() {
        "RunKey" => toggle_runkey(&location, &name, &command, enabled),
        "StartupFolder" => toggle_startup_folder(&location, &name, enabled),
        _ => Err("Este elemento de inicio no soporta activar/desactivar desde la app".to_string()),
    }
}

fn toggle_runkey(location: &str, name: &str, command: &str, enabled: bool) -> Result<(), String> {
    let validated_location = validate_runkey_location(location)?;
    let disabled_key = format!("{validated_location}Disabled");

    let ps = r#"
$ErrorActionPreference='Stop'

$location = $args[0]
$disabledKey = $args[1]
$name = $args[2]
$enable = [System.Convert]::ToBoolean($args[3])

if($enable){
    $src = $disabledKey
    $dst = $location
    $missingMessage = 'No existe RunDisabled'
    $valueMissingMessage = 'No existe el valor en RunDisabled'
} else {
    $src = $location
    $dst = $disabledKey
    $missingMessage = 'No existe Run'
    $valueMissingMessage = 'No existe el valor en Run'
}

if(-not (Test-Path -Path $src)){ throw $missingMessage }

$p = Get-ItemProperty -Path $src -ErrorAction Stop
$val = $p.PSObject.Properties | Where-Object { $_.Name -eq $name } | Select-Object -First 1
if(-not $val){ throw $valueMissingMessage }

New-Item -Path $dst -Force | Out-Null
Set-ItemProperty -Path $dst -Name $name -Value $val.Value -Force
Remove-ItemProperty -Path $src -Name $name -ErrorAction Stop
"#;

    // Si command viene vacío, igual intentamos mover por name.
    // (command se mantiene por compatibilidad futura)
    let _ = command;

    run_powershell(
        ps,
        &[
            validated_location,
            &disabled_key,
            name,
            &enabled.to_string(),
        ],
    )
}

fn toggle_startup_folder(location: &str, name: &str, enabled: bool) -> Result<(), String> {
    let base = Path::new(location);
    if !base.exists() {
        return Err(format!("No existe la carpeta de inicio: {location}"));
    }

    let disabled_dir = base.join("PCDiagnostico_Disabled");
    let src = if enabled {
        disabled_dir.join(name)
    } else {
        base.join(name)
    };
    let dst = if enabled {
        base.join(name)
    } else {
        disabled_dir.join(name)
    };

    if !src.exists() {
        return Err(format!("No existe el elemento: {}", src.display()));
    }
    if !disabled_dir.exists() {
        fs::create_dir_all(&disabled_dir)
            .map_err(|e| format!("No se pudo crear carpeta Disabled: {e}"))?;
    }

    fs::rename(&src, &dst).map_err(|e| format!("No se pudo mover el elemento: {e}"))?;
    Ok(())
}

fn validate_runkey_location(location: &str) -> Result<&'static str, String> {
    let normalized = location.trim().replace('/', "\\").to_ascii_uppercase();
    match normalized.as_str() {
        "HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\RUN" => {
            Ok(r"HKCU:\Software\Microsoft\Windows\CurrentVersion\Run")
        }
        "HKLM:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\RUN" => {
            Ok(r"HKLM:\Software\Microsoft\Windows\CurrentVersion\Run")
        }
        _ => Err(structured_error(
            "invalid_runkey_location",
            "La ubicación de registro no está permitida",
            Some(json!({ "location": location })),
        )),
    }
}

fn structured_error(code: &str, message: &str, details: Option<Value>) -> String {
    json!({
        "code": code,
        "message": message,
        "details": details,
    })
    .to_string()
}

fn run_powershell(script: &str, script_args: &[&str]) -> Result<(), String> {
    let out = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .args(script_args)
        .output()
        .map_err(|e| {
            structured_error(
                "powershell_exec_error",
                "Error ejecutando PowerShell",
                Some(json!({ "reason": e.to_string() })),
            )
        })?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr_summary = stderr.lines().find(|line| !line.trim().is_empty());
        let stdout_summary = stdout.lines().find(|line| !line.trim().is_empty());

        return Err(structured_error(
            "powershell_failed",
            "No se pudo completar la operación sobre el registro de inicio",
            Some(json!({
                "exit_code": out.status.code(),
                "stderr_summary": stderr_summary,
                "stdout_summary": stdout_summary,
            })),
        ));
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            run_collector,
            open_action,
            open_path,
            kill_process,
            toggle_startup_item
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar la app");
}
