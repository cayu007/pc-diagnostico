# PC Diagnóstico

Aplicación de escritorio para diagnóstico rápido de estado del sistema en Windows, con foco en rendimiento, limpieza y elementos de inicio.

## Propósito

PC Diagnóstico centraliza información del equipo para ayudar a:

- Detectar cuellos de botella (RAM/CPU/almacenamiento).
- Revisar estado general del sistema y eventos relevantes.
- Identificar programas en inicio y procesos pesados.
- Ejecutar acciones de mantenimiento comunes desde una sola interfaz.

## Stack tecnológico

- **Frontend:** React + Vite
- **Desktop shell:** Tauri (Rust)
- **Recolección de datos del sistema:** PowerShell (`collector.ps1`)

Resumen: **React + Vite + Tauri + PowerShell**.

## Flujo de datos

El flujo principal de la app es:

1. El frontend invoca el comando Tauri `run_collector`.
2. El backend (Rust) ejecuta `src-tauri/resources/collector.ps1`.
3. El script PowerShell genera `report.json` en el directorio de datos de la app.
4. El backend lee `report.json` y retorna el JSON al frontend.
5. React renderiza paneles, tablas y acciones con esos datos.

Representación corta:

`collector.ps1` → `report.json` → frontend

## Comandos de desarrollo y build

### Requisitos

- Node.js + npm
- Rust toolchain (cargo/rustc)
- Dependencias de Tauri para Windows
- PowerShell 5.1+ (o PowerShell 7+ compatible)

### Desarrollo web (solo frontend)

```bash
npm install
npm run dev
```

### Desarrollo app de escritorio (Tauri)

```bash
npm install
npm run tauri dev
```

### Build de frontend

```bash
npm run build
```

### Build instalable/escritorio con Tauri

```bash
npm run tauri build
```

### Checks útiles

```bash
npm run lint
npm run validate:root-files
```

## Acciones de mantenimiento soportadas

Además de visualizar diagnóstico, la app expone acciones operativas desde Tauri:

- **Startup:** abrir configuración de apps de inicio de Windows.
- **Kill process:** finalizar procesos por PID (según permisos del usuario).
- **Abrir rutas/carpetas:** abrir ubicaciones detectadas por el diagnóstico.
- **Toggle de startup items:** habilitar/deshabilitar entradas de inicio compatibles:
  - Run keys (registro).
  - Elementos en carpeta Startup (moviéndolos entre carpeta activa y carpeta de deshabilitados de la app).

## Estructura de carpetas clave

```text
src/                    # Frontend React (UI, tablas, acciones)
src-tauri/src/          # Backend Rust (comandos Tauri, ejecución de PowerShell)
src-tauri/resources/    # Recursos empaquetados; incluye collector.ps1
```

## Limitaciones y permisos en Windows

- Varias lecturas de sistema (registro, eventos, tareas, procesos) dependen del contexto del usuario.
- Algunas acciones pueden requerir **ejecución como administrador** para completarse.
- El acceso a claves bajo **HKLM** puede fallar sin privilegios elevados.
- `taskkill` puede no finalizar procesos protegidos o pertenecientes a otros usuarios/sesiones.
- La disponibilidad de eventos (`Get-WinEvent`) depende de permisos y del estado de los logs del sistema.

## Troubleshooting

### 1) PowerShell Execution Policy bloquea scripts

Síntoma típico: error al ejecutar `collector.ps1` con mensajes de política de ejecución.

Posibles soluciones (PowerShell como administrador):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

o para sesión actual solamente:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

> Recomendado: usar el menor alcance posible y respetar políticas corporativas.

### 2) Errores de permisos en HKLM

Síntoma: acceso denegado al leer/modificar claves del registro en `HKLM`.

Acciones sugeridas:

- Ejecutar la app como administrador.
- Verificar GPO/políticas corporativas que bloqueen lectura/escritura.
- Validar que la cuenta tenga permisos locales suficientes.

### 3) Fallos en `Get-WinEvent`

Síntomas frecuentes:

- canal inexistente,
- acceso denegado,
- timeout por volumen alto de eventos.

Acciones sugeridas:

- Ejecutar con mayores privilegios.
- Reducir ventana de consulta o cantidad de eventos.
- Verificar que los logs/canales estén habilitados en el sistema objetivo.

### 4) `report.json` no se genera o no se encuentra

Checklist rápido:

- Confirmar que `collector.ps1` existe en `src-tauri/resources/`.
- Revisar logs/errores de Tauri al ejecutar `run_collector`.
- Verificar permisos de escritura en el directorio de datos de la app.

---

Si estás desarrollando nuevas vistas o acciones, revisa primero el contrato de datos que produce `collector.ps1` para mantener consistencia entre backend y frontend.
