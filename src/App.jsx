import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

function cls(...a) {
  return a.filter(Boolean).join(" ");
}

function formatBytes(bytes) {
  if (bytes == null) return "N/D";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = Number(bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
}

function parsePsDate(v) {
  if (!v || typeof v !== "string") return null;

  const m = v.match(/\/Date\((\d+)\)\//);
  if (m) {
    const ms = Number(m[1]);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }

  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d;

  return null;
}

function severityStyle(sev, dark) {
  if (sev === "high")
    return dark
      ? "bg-red-950/40 border-red-900 text-red-200"
      : "bg-red-50 border-red-200 text-red-800";
  if (sev === "med")
    return dark
      ? "bg-yellow-950/40 border-yellow-900 text-yellow-200"
      : "bg-yellow-50 border-yellow-200 text-yellow-800";
  if (sev === "low")
    return dark
      ? "bg-green-950/40 border-green-900 text-green-200"
      : "bg-green-50 border-green-200 text-green-800";
  return dark
    ? "bg-zinc-900 border-zinc-800 text-zinc-200"
    : "bg-gray-50 border-gray-200 text-gray-700";
}

function scoreTone(score) {
  if (score == null) return { ring: "text-zinc-400", label: "N/D", badge: "bg-zinc-200 text-zinc-800" };
  if (score >= 85) return { ring: "text-green-600", label: "Bien", badge: "bg-green-100 text-green-800" };
  if (score >= 70) return { ring: "text-yellow-600", label: "Atención", badge: "bg-yellow-100 text-yellow-800" };
  return { ring: "text-red-600", label: "Crítico", badge: "bg-red-100 text-red-800" };
}

function Gauge({ score, dark }) {
  const size = 120;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, Number(score)));
  const offset = c - (pct / 100) * c;
  const tone = scoreTone(score);

  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="block">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            className={dark ? "text-zinc-800" : "text-gray-200"}
            stroke="currentColor"
            fill="transparent"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            className={tone.ring}
            stroke="currentColor"
            fill="transparent"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className={cls("text-3xl font-semibold leading-none", dark ? "text-white" : "text-black")}>
              {score ?? "—"}
            </div>
            <div className={cls("text-xs mt-1", dark ? "text-zinc-400" : "text-gray-500")}>Health</div>
          </div>
        </div>
      </div>

      <div>
        <div
          className={cls(
            "inline-flex items-center px-2 py-1 rounded-lg text-sm",
            tone.badge,
            dark && "bg-zinc-800 text-zinc-200"
          )}
        >
          {tone.label}
        </div>
        <div className={cls("text-sm mt-2", dark ? "text-zinc-400" : "text-gray-500")}>
          Puntuación basada en reglas (espacio, RAM, disco, etc.).
        </div>
      </div>
    </div>
  );
}

function Card({ title, value, sub, right, dark }) {
  return (
    <div
      className={cls(
        "rounded-2xl border shadow-sm p-4",
        dark ? "bg-zinc-950 border-zinc-800" : "bg-white border-gray-200"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cls("text-sm", dark ? "text-zinc-400" : "text-gray-500")}>{title}</div>
        {right}
      </div>
      <div className={cls("mt-2 text-2xl font-semibold", dark ? "text-white" : "text-black")}>{value}</div>
      {sub ? <div className={cls("text-xs mt-1", dark ? "text-zinc-400" : "text-gray-500")}>{sub}</div> : null}
    </div>
  );
}

function ProgressBar({ pct, labelLeft, labelRight, dark }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, Number(pct)));
  return (
    <div>
      <div className={cls("flex items-center justify-between text-xs", dark ? "text-zinc-400" : "text-gray-500")}>
        <span>{labelLeft}</span>
        <span>{labelRight}</span>
      </div>
      <div className={cls("h-2 rounded-full overflow-hidden mt-2", dark ? "bg-zinc-800" : "bg-gray-200")}>
        <div className="h-2 bg-white/90 rounded-full" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function renderCellValue(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function safeStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function Table({ cols, rows, dark }) {
  return (
    <div
      className={cls(
        "overflow-auto rounded-2xl border shadow-sm",
        dark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-white"
      )}
    >
      <table className="min-w-full text-sm">
        <thead className={dark ? "bg-zinc-900" : "bg-gray-50"}>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className={cls("text-left p-3 font-medium whitespace-nowrap", dark ? "text-zinc-300" : "text-gray-600")}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((r, i) => (
            <tr key={i} className={cls("border-t", dark ? "border-zinc-800" : "border-gray-200")}>
              {cols.map((c) => (
                <td key={c.key} className={cls("p-3 align-top", dark ? "text-zinc-200" : "text-gray-800")}>
                  {c.render ? c.render(r) : renderCellValue(r?.[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, actions, children, dark }) {
  return (
    <div
      className={cls(
        "rounded-2xl border shadow-sm overflow-hidden",
        dark ? "bg-zinc-950 border-zinc-800" : "bg-white border-gray-200"
      )}
    >
      <div
        className={cls(
          "p-4 border-b flex items-center justify-between gap-3",
          dark ? "border-zinc-800" : "border-gray-200"
        )}
      >
        <div className={cls("font-semibold", dark ? "text-white" : "text-black")}>{title}</div>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, dark }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cls(
        "w-full rounded-xl px-3 py-2 text-sm border outline-none",
        dark
          ? "bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus:ring-2 focus:ring-white/10"
          : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-black/10"
      )}
    />
  );
}

function QuickButton({ label, onClick, dark }) {
  return (
    <button
      className={cls(
        "rounded-xl px-3 py-2 text-sm border transition",
        dark ? "bg-zinc-900 border-zinc-800 text-zinc-100 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function Modal({ open: isOpen, title, children, onClose, dark }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} role="button" tabIndex={0} aria-label="Cerrar" />
      <div
        className={cls(
          "relative w-full max-w-3xl rounded-2xl border shadow-xl",
          dark ? "bg-zinc-950 border-zinc-800 text-white" : "bg-white border-gray-200 text-black"
        )}
      >
        <div
          className={cls(
            "p-4 border-b flex items-center justify-between gap-3",
            dark ? "border-zinc-800" : "border-gray-200"
          )}
        >
          <div className="font-semibold">{title}</div>
          <button
            className={cls(
              "text-xs px-2 py-1 rounded-lg border",
              dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
            )}
            onClick={onClose}
            type="button"
          >
            Cerrar
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto">{children}</div>
      </div>
    </div>
  );
}

function toNum(n) {
  if (n == null) return null;
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const [prevData, setPrevData] = useState(null);
  const [toast, setToast] = useState("");

  const [tab, setTab] = useState("resumen");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [dark, setDark] = useState(false);

  const [qProc, setQProc] = useState("");
  const [qStartup, setQStartup] = useState("");
  const [qEvents, setQEvents] = useState("");
  const [qSpace, setQSpace] = useState("");

  const [eventsWindow, setEventsWindow] = useState("48h"); // 24h | 48h | 7d
  const [eventDetail, setEventDetail] = useState(null);

  async function runAnalysis() {
    setLoading(true);
    setError("");
    try {
      const result = await invoke("run_collector");
      const cleaned = String(result).replace(/^\uFEFF/, "");
      const parsed = JSON.parse(cleaned);

      setPrevData(data);
      setData(parsed);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function doAction(action) {
    try {
      await invoke("open_action", { action });
    } catch (e) {
      setError(String(e));
    }
  }

  async function openFolder(path) {
    try {
      if (typeof path !== "string" || !path.trim()) return;
      await invoke("open_path", { path });
    } catch (e) {
      setError(String(e));
    }
  }

  async function killProcess(pid) {
    try {
      await invoke("kill_process", { pid: Number(pid) });
      setToast("Proceso terminado ✅");
      setTimeout(() => setToast(""), 2000);
      runAnalysis();
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleStartupItem(item, nextEnabled) {
    try {
      await invoke("toggle_startup_item", {
        source: item?.Source,
        location: item?.Location,
        name: item?.Name,
        command: item?.Command ?? "",
        enabled: Boolean(nextEnabled),
      });
      setToast(nextEnabled ? "Elemento habilitado ✅" : "Elemento deshabilitado ✅");
      setTimeout(() => setToast(""), 2000);
      runAnalysis();
    } catch (e) {
      setError(String(e));
    }
  }

  async function openUrl(url) {
    try {
      await shellOpen(url);
    } catch (e) {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        setError(String(e));
      }
    }
  }

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => runAnalysis(), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const view = useMemo(() => {
    if (!data) return null;

    const score = data?.health?.score ?? null;
    const findings = data?.health?.findings ?? [];

    const cpuPct = data?.system?.cpu?.loadPct ?? null;
    const ramAvailMB = data?.system?.memory?.availableMB ?? null;
    const ramTotalGB = data?.system?.memory?.totalGB ?? null;

    const volumesRaw = data?.system?.volumes;
    const volumes = Array.isArray(volumesRaw) ? volumesRaw : volumesRaw ? [volumesRaw] : [];
    const c = volumes.find((v) => v?.DeviceID === "C:") || null;

    const cFreePct = c?.FreePct ?? null;
    const cFreeGB = c?.FreeGB ?? null;
    const cSizeGB = c?.SizeGB ?? null;
    const cUsedPct = cFreePct == null ? null : Math.max(0, Math.min(100, 100 - Number(cFreePct)));

    const boot = parsePsDate(data?.system?.os?.lastBootIso ?? data?.system?.os?.lastBoot);
    const uptime = data?.system?.os?.uptimeHours ?? null;

    const topCPU = data?.performance?.topProcessesByCPU ?? [];
    const topRAM = data?.performance?.topProcessesByRAM ?? [];

    const startup = data?.startup?.items ?? data?.startup?.runKeys ?? [];
    const events = data?.events?.systemCritical48h ?? [];

    const generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;

    const topFolders = data?.spaceAnalysis?.topFolders ?? [];
    const spaceTargets = data?.spaceAnalysis?.targets ?? [];

    return {
      score,
      findings,
      cpuPct,
      ramAvailMB,
      ramTotalGB,
      volumes,
      c,
      cFreePct,
      cFreeGB,
      cSizeGB,
      cUsedPct,
      uptime,
      boot,
      topCPU,
      topRAM,
      startup,
      events,
      generatedAt,
      topFolders,
      spaceTargets,
      host: data?.system?.hostname,
      user: data?.system?.user,
      osCaption: data?.system?.os?.caption ?? data?.system?.os,
      prev: prevData,
    };
  }, [data, prevData]);

  const navItem = (key, label) => (
    <button
      onClick={() => setTab(key)}
      className={cls(
        "w-full text-left px-3 py-2 rounded-xl text-sm",
        tab === key ? "bg-white text-black" : cls(dark ? "hover:bg-zinc-900 text-zinc-200" : "hover:bg-gray-100 text-gray-700")
      )}
    >
      {label}
    </button>
  );

  const filteredTopCPU = useMemo(() => {
    const q = qProc.trim().toLowerCase();
    const rows = view?.topCPU ?? [];
    if (!q) return rows;
    return rows.filter((r) => (safeStr(r?.Name) + " " + safeStr(r?.Path)).toLowerCase().includes(q));
  }, [view, qProc]);

  const filteredTopRAM = useMemo(() => {
    const q = qProc.trim().toLowerCase();
    const rows = view?.topRAM ?? [];
    if (!q) return rows;
    return rows.filter((r) => (safeStr(r?.Name) + " " + safeStr(r?.Path)).toLowerCase().includes(q));
  }, [view, qProc]);

  const filteredStartup = useMemo(() => {
    const q = qStartup.trim().toLowerCase();
    const rows = view?.startup ?? [];
    if (!q) return rows;
    return rows.filter(
      (r) => safeStr(r?.Name).toLowerCase().includes(q) || safeStr(r?.Command).toLowerCase().includes(q)
    );
  }, [view, qStartup]);

  const startupGroups = useMemo(() => {
    const rows = filteredStartup ?? [];
    const map = new Map();
    for (const r of rows) {
      const source = safeStr(r?.Source || "N/D");
      const name = safeStr(r?.Name || "N/D");
      const key = `${source}#${name}`;
      map.set(key, { source, name, count: (map.get(key)?.count || 0) + 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [filteredStartup]);

  const windowMs = useMemo(() => {
    if (eventsWindow === "24h") return 24 * 60 * 60 * 1000;
    if (eventsWindow === "7d") return 7 * 24 * 60 * 60 * 1000;
    return 48 * 60 * 60 * 1000;
  }, [eventsWindow]);

  const filteredEvents = useMemo(() => {
    const q = qEvents.trim().toLowerCase();
    const rows = view?.events ?? [];
    const now = Date.now();

    const byWindow = rows.filter((r) => {
      const d = parsePsDate(r?.TimeCreated);
      if (!d) return true;
      return now - d.getTime() <= windowMs;
    });

    if (!q) return byWindow;

    return byWindow.filter(
      (r) =>
        safeStr(r?.ProviderName).toLowerCase().includes(q) ||
        safeStr(r?.Message).toLowerCase().includes(q) ||
        safeStr(r?.Id).toLowerCase().includes(q)
    );
  }, [view, qEvents, windowMs]);

  const eventGroups = useMemo(() => {
    const rows = filteredEvents ?? [];
    const map = new Map();
    for (const r of rows) {
      const prov = safeStr(r?.ProviderName || "N/D");
      const id = safeStr(r?.Id || "N/D");
      const key = `${prov}#${id}`;
      map.set(key, { provider: prov, id, count: (map.get(key)?.count || 0) + 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [filteredEvents]);

  const filteredSpaceTargets = useMemo(() => {
    const q = qSpace.trim().toLowerCase();
    const rows = view?.spaceTargets ?? [];
    if (!q) return rows;
    return rows.filter(
      (r) => safeStr(r?.key).toLowerCase().includes(q) || safeStr(r?.path).toLowerCase().includes(q)
    );
  }, [view, qSpace]);

  return (
    <div className={cls("min-h-screen", dark ? "bg-black text-white" : "bg-gray-100 text-black")}>
      <Modal
        open={!!eventDetail}
        title={eventDetail ? `Evento ${safeStr(eventDetail?.Id)} · ${safeStr(eventDetail?.ProviderName)}` : ""}
        dark={dark}
        onClose={() => setEventDetail(null)}
      >
        {eventDetail ? (
          <div className="space-y-3">
            <div className={cls("text-xs", dark ? "text-zinc-400" : "text-gray-500")}>
              Fecha:{" "}
              {(() => {
                const d = parsePsDate(eventDetail?.TimeCreated);
                return d ? d.toLocaleString() : safeStr(eventDetail?.TimeCreated ?? "N/D");
              })()}
            </div>

            <div className={cls("text-sm font-semibold", dark ? "text-zinc-100" : "text-gray-900")}>Mensaje</div>

            <pre
              className={cls(
                "text-xs p-3 rounded-xl border whitespace-pre-wrap",
                dark ? "border-zinc-800 bg-zinc-900/40" : "border-gray-200 bg-gray-50"
              )}
            >
              {safeStr(eventDetail?.Message ?? "N/D")}
            </pre>

            <div className="flex flex-wrap gap-2">
              <button
                className={cls(
                  "text-xs px-2 py-1 rounded-lg border",
                  dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                )}
                onClick={async () => {
                  const ok = await copyText(JSON.stringify(eventDetail, null, 2));
                  setToast(ok ? "Evento copiado ✅" : "No se pudo copiar ❌");
                  setTimeout(() => setToast(""), 2000);
                }}
                type="button"
              >
                Copiar JSON del evento
              </button>

              <button
                className={cls(
                  "text-xs px-2 py-1 rounded-lg border",
                  dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                )}
                onClick={() => {
                  const q = encodeURIComponent(`${safeStr(eventDetail?.ProviderName)} event ${safeStr(eventDetail?.Id)}`);
                  openUrl(`https://www.google.com/search?q=${q}`);
                }}
                type="button"
              >
                Buscar EventID
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <aside
            className={cls(
              "rounded-2xl border shadow-sm p-3 h-fit lg:sticky lg:top-4",
              dark ? "bg-zinc-950 border-zinc-800" : "bg-white border-gray-200"
            )}
          >
            <div className="px-2 py-2">
              <div className="text-lg font-semibold">PC Diagnóstico</div>
              <div className={cls("text-xs mt-1", dark ? "text-zinc-400" : "text-gray-500")}>
                {view?.host ? `${view.host} · ${view.user || ""}` : "Listo para analizar"}
              </div>
            </div>

            <div className="mt-3 space-y-1">
              {navItem("resumen", "Resumen")}
              {navItem("espacio", "Espacio")}
              {navItem("procesos", "Procesos")}
              {navItem("arranque", "Arranque")}
              {navItem("eventos", "Eventos")}
            </div>

            <div className="mt-4 px-2 space-y-3">
              <button
                className={cls(
                  "w-full rounded-xl px-3 py-2 text-sm disabled:opacity-50",
                  dark ? "bg-white text-black" : "bg-black text-white"
                )}
                onClick={runAnalysis}
                disabled={loading}
              >
                {loading ? "Analizando..." : "Ejecutar análisis"}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className={cls(
                    "w-full rounded-xl px-3 py-2 text-xs border disabled:opacity-50",
                    dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                  )}
                  onClick={async () => {
                    if (!data) return;
                    const ok = await copyText(JSON.stringify(data, null, 2));
                    setToast(ok ? "Informe copiado ✅" : "No se pudo copiar ❌");
                    setTimeout(() => setToast(""), 2000);
                  }}
                  type="button"
                  disabled={!data}
                >
                  Copiar JSON
                </button>

                <button
                  className={cls(
                    "w-full rounded-xl px-3 py-2 text-xs border disabled:opacity-50",
                    dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                  )}
                  onClick={() => {
                    if (!data) return;
                    const ts = new Date().toISOString().replace(/[:.]/g, "-");
                    downloadJson(`pc-diagnostico-${ts}.json`, data);
                    setToast("Descarga iniciada ✅");
                    setTimeout(() => setToast(""), 2000);
                  }}
                  type="button"
                  disabled={!data}
                >
                  Descargar
                </button>
              </div>

              {toast ? <div className={cls("text-xs", dark ? "text-zinc-400" : "text-gray-500")}>{toast}</div> : null}

              <label className={cls("flex items-center gap-2 text-xs select-none", dark ? "text-zinc-300" : "text-gray-600")}>
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                Auto-refresh (30s)
              </label>

              <label className={cls("flex items-center gap-2 text-xs select-none", dark ? "text-zinc-300" : "text-gray-600")}>
                <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
                Modo oscuro
              </label>

              {view?.generatedAt ? (
                <div className={cls("text-xs", dark ? "text-zinc-400" : "text-gray-500")}>
                  Último análisis: {view.generatedAt.toLocaleString()}
                </div>
              ) : null}
            </div>
          </aside>

          <main className="space-y-4">
            {error ? (
              <div
                className={cls(
                  "p-4 rounded-2xl border whitespace-pre-wrap",
                  dark ? "bg-red-950/40 border-red-900 text-red-200" : "bg-red-50 border-red-200 text-red-800"
                )}
              >
                {error}
              </div>
            ) : null}

            {!view ? (
              <div
                className={cls(
                  "rounded-2xl border shadow-sm p-6",
                  dark ? "bg-zinc-950 border-zinc-800 text-zinc-300" : "bg-white border-gray-200 text-gray-600"
                )}
              >
                Pulsa <span className="font-medium">Ejecutar análisis</span> para generar el informe.
              </div>
            ) : null}

            {/* RESUMEN */}
            {view && tab === "resumen" ? (
              <>
                <Section
                  title="Estado general"
                  actions={
                    <span
                      className={cls(
                        "text-xs px-2 py-1 rounded-lg",
                        dark ? "bg-zinc-900 text-zinc-200 border border-zinc-800" : scoreTone(view.score).badge
                      )}
                    >
                      {scoreTone(view.score).label}
                    </span>
                  }
                  dark={dark}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Gauge score={view.score} dark={dark} />

                    <div className="space-y-3">
                      <Card
                        title="Sistema"
                        value={view.osCaption || "Windows"}
                        sub={`Uptime: ${view.uptime ?? "N/D"} h${view.boot ? ` · Boot: ${view.boot.toLocaleString()}` : ""}`}
                        dark={dark}
                      />
                      <ProgressBar
                        pct={view.cUsedPct}
                        labelLeft="Disco C: usado"
                        labelRight={view.c ? `${view.cFreeGB} GB libres (${view.cFreePct}%)` : "N/D"}
                        dark={dark}
                      />
                    </div>
                  </div>
                </Section>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card title="CPU" value={`${view.cpuPct ?? "N/D"}%`} sub={safeStr(data?.system?.cpu?.name || "")} dark={dark} />
                  <Card
                    title="RAM disponible"
                    value={view.ramAvailMB != null ? `${view.ramAvailMB} MB` : "N/D"}
                    sub={view.ramTotalGB != null ? `Total: ${view.ramTotalGB} GB` : ""}
                    dark={dark}
                  />
                  <Card
                    title="Disco C:"
                    value={view.c ? `${view.cFreeGB} GB libres` : "N/D"}
                    sub={view.c ? `Tamaño: ${view.cSizeGB} GB · Libre: ${view.cFreePct}%` : ""}
                    dark={dark}
                    right={
                      view.cFreePct != null ? (
                        <span
                          className={cls(
                            "text-xs px-2 py-1 rounded-lg border",
                            severityStyle(view.cFreePct < 10 ? "high" : view.cFreePct < 15 ? "med" : "low", dark)
                          )}
                        >
                          {view.cFreePct < 10 ? "Crítico" : view.cFreePct < 15 ? "Atención" : "OK"}
                        </span>
                      ) : null
                    }
                  />
                </div>

                {view.prev ? (
                  <Section title="Comparativa (antes vs ahora)" dark={dark}>
                    {(() => {
                      const pv = view.prev;

                      const prevVolumesRaw = pv?.system?.volumes;
                      const prevVolumes = Array.isArray(prevVolumesRaw) ? prevVolumesRaw : prevVolumesRaw ? [prevVolumesRaw] : [];
                      const prevC = prevVolumes.find((v) => v?.DeviceID === "C:") || null;

                      const prevFree = toNum(prevC?.FreeGB);
                      const nowFree = toNum(view?.cFreeGB);
                      const dFree = prevFree != null && nowFree != null ? nowFree - prevFree : null;

                      const prevRam = toNum(pv?.system?.memory?.availableMB);
                      const nowRam = toNum(view?.ramAvailMB);
                      const dRam = prevRam != null && nowRam != null ? nowRam - prevRam : null;

                      const prevScore = toNum(pv?.health?.score);
                      const nowScore = toNum(view?.score);
                      const dScore = prevScore != null && nowScore != null ? nowScore - prevScore : null;

                      const pill = (v, unit) => (
                        <span
                          className={cls(
                            "text-xs px-2 py-1 rounded-lg border",
                            dark ? "bg-zinc-900 border-zinc-800 text-zinc-200" : "bg-white border-gray-200 text-gray-700"
                          )}
                        >
                          {v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)} ${unit}`}
                        </span>
                      );

                      const box = (title, main, delta) => (
                        <div
                          className={cls(
                            "rounded-xl border p-3",
                            dark ? "border-zinc-800 bg-zinc-900/40" : "border-gray-200 bg-white"
                          )}
                        >
                          <div className={cls("text-xs", dark ? "text-zinc-400" : "text-gray-500")}>{title}</div>
                          <div className="mt-1 flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold">{main}</div>
                            {delta}
                          </div>
                        </div>
                      );

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {box("C: libre", `${view?.cFreeGB ?? "N/D"} GB`, pill(dFree, "GB"))}
                          {box("RAM disponible", `${view?.ramAvailMB ?? "N/D"} MB`, pill(dRam, "MB"))}
                          {box("Health score", `${view?.score ?? "N/D"}`, pill(dScore, "pts"))}
                        </div>
                      );
                    })()}
                  </Section>
                ) : null}

                <Section title="Quick actions" dark={dark}>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <QuickButton label="Abrir almacenamiento" onClick={() => doAction("storage")} dark={dark} />
                    <QuickButton label="Apps de inicio" onClick={() => doAction("startup")} dark={dark} />
                    <QuickButton label="Liberador de disco" onClick={() => doAction("cleanmgr")} dark={dark} />
                    <QuickButton label="Abrir TEMP" onClick={() => doAction("temp")} dark={dark} />
                  </div>
                  <div className={cls("text-xs mt-3", dark ? "text-zinc-400" : "text-gray-500")}>
                    Accesos rápidos recomendados (especialmente útil si hay poco espacio en C:).
                  </div>
                </Section>

                <Section title="Top carpetas que ocupan espacio" dark={dark}>
                  {!view.topFolders || view.topFolders.length === 0 ? (
                    <div className={dark ? "text-zinc-300" : "text-gray-600"}>No hay datos de espacio (o no se pudo medir).</div>
                  ) : (
                    <div className="space-y-2">
                      {view.topFolders.map((f, i) => (
                        <div
                          key={i}
                          className={cls(
                            "rounded-xl border px-3 py-2 flex items-center justify-between gap-3",
                            dark ? "border-zinc-800 bg-zinc-900/50" : "border-gray-200 bg-white"
                          )}
                        >
                          <div className="min-w-0">
                            <div className={cls("text-sm font-medium truncate", dark ? "text-zinc-100" : "text-gray-900")}>
                              {safeStr(f.key)} · {f.sizeGB ?? "N/D"} GB
                            </div>
                            <div className={cls("text-xs truncate", dark ? "text-zinc-400" : "text-gray-500")}>{safeStr(f.path)}</div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              className={cls(
                                "text-xs px-2 py-1 rounded-lg border",
                                dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                              )}
                              onClick={() => openFolder(f.path)}
                              type="button"
                            >
                              Abrir
                            </button>

                            <span
                              className={cls(
                                "text-xs px-2 py-1 rounded-lg border",
                                f.sizeGB != null && f.sizeGB >= 10
                                  ? severityStyle("high", dark)
                                  : f.sizeGB != null && f.sizeGB >= 5
                                    ? severityStyle("med", dark)
                                    : severityStyle("low", dark)
                              )}
                            >
                              {f.sizeGB != null && f.sizeGB >= 10 ? "ALTO" : f.sizeGB != null && f.sizeGB >= 5 ? "MEDIO" : "OK"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="Alertas detectadas" dark={dark}>
                  {view.findings.length === 0 ? (
                    <div className={dark ? "text-zinc-300" : "text-gray-600"}>No se detectaron problemas por reglas básicas.</div>
                  ) : (
                    <div className="space-y-3">
                      {view.findings.map((f, idx) => (
                        <div key={idx} className={cls("rounded-2xl border p-4", severityStyle(f.severity, dark))}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold">{safeStr(f.title)}</div>
                              <div className="text-sm mt-1">{safeStr(f.detail)}</div>
                            </div>
                            <span
                              className={cls(
                                "text-xs px-2 py-1 rounded-lg border",
                                dark ? "bg-zinc-900 border-zinc-800 text-zinc-200" : "bg-white/60 border-black/10"
                              )}
                            >
                              {safeStr(f.severity || "info").toUpperCase()}
                            </span>
                          </div>
                          <div className="text-sm mt-3">
                            <span className="font-semibold">Recomendación:</span> {safeStr(f.recommendation)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </>
            ) : null}

            {/* ESPACIO */}
            {view && tab === "espacio" ? (
              <div className="space-y-4">
                <Section title="Asistente de limpieza (recomendado)" dark={dark}>
                  {(() => {
                    const targets = view?.spaceTargets ?? [];
                    const byKey = (k) => targets.find((t) => t?.key === k) || null;

                    const downloads = byKey("Downloads");
                    const tempUser = byKey("TempUser");
                    const tempWin = byKey("TempWin");
                    const docker = byKey("Docker");
                    const packages = byKey("Packages");
                    const wsl = byKey("WSL");

                    const cards = [];
                    const addCard = (title, detail, actions, sev = "low") => cards.push({ title, detail, actions, sev });

                    if (docker?.sizeGB != null && docker.sizeGB >= 5) {
                      addCard(
                        "Docker puede estar llenando C:",
                        `${safeStr(docker.path)} ~ ${docker.sizeGB} GB`,
                        [
                          { label: "Abrir carpeta", fn: () => openFolder(docker.path) },
                          { label: "Ver procesos", fn: () => setTab("procesos") },
                        ],
                        docker.sizeGB >= 10 ? "high" : "med"
                      );
                    }

                    if (wsl?.sizeGB != null && wsl.sizeGB >= 5) {
                      addCard(
                        "WSL ocupa espacio",
                        `${safeStr(wsl.path)} ~ ${wsl.sizeGB} GB`,
                        [
                          { label: "Abrir carpeta", fn: () => openFolder(wsl.path) },
                          { label: "Ver procesos", fn: () => setTab("procesos") },
                        ],
                        wsl.sizeGB >= 10 ? "high" : "med"
                      );
                    }

                    if (downloads?.sizeGB != null && downloads.sizeGB >= 5) {
                      addCard(
                        "Descargas grandes",
                        `${safeStr(downloads.path)} ~ ${downloads.sizeGB} GB`,
                        [
                          { label: "Abrir Descargas", fn: () => openFolder(downloads.path) },
                          { label: "Storage Sense", fn: () => doAction("storage") },
                        ],
                        downloads.sizeGB >= 15 ? "high" : "med"
                      );
                    }

                    const tempTotal = (tempUser?.sizeGB || 0) + (tempWin?.sizeGB || 0);
                    if (tempTotal >= 1) {
                      addCard(
                        "Temporales ocupando espacio",
                        `TEMP usuario + Windows ~ ${tempTotal.toFixed(2)} GB`,
                        [
                          { label: "Abrir TEMP", fn: () => doAction("temp") },
                          { label: "Liberador", fn: () => doAction("cleanmgr") },
                        ],
                        tempTotal >= 3 ? "high" : "low"
                      );
                    }

                    if (packages?.sizeGB != null && packages.sizeGB >= 8) {
                      addCard(
                        "Apps (Store) ocupan bastante",
                        `${safeStr(packages.path)} ~ ${packages.sizeGB} GB`,
                        [
                          { label: "Apps instaladas", fn: () => doAction("apps") },
                          { label: "Abrir carpeta", fn: () => openFolder(packages.path) },
                        ],
                        "med"
                      );
                    }

                    if (view?.cFreePct != null && view.cFreePct < 10) {
                      addCard(
                        "C: está crítico",
                        `Solo ${view.cFreeGB} GB libres (${view.cFreePct}%).`,
                        [
                          { label: "Storage Sense", fn: () => doAction("storage") },
                          { label: "Liberador", fn: () => doAction("cleanmgr") },
                        ],
                        "high"
                      );
                    }

                    if (cards.length === 0) {
                      return (
                        <div className={dark ? "text-zinc-300" : "text-gray-600"}>
                          No hay recomendaciones fuertes por tamaño (o faltan datos).
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cards.map((c, i) => (
                          <div key={i} className={cls("rounded-2xl border p-4", severityStyle(c.sev, dark))}>
                            <div className="font-semibold">{c.title}</div>
                            <div className="text-sm mt-1">{c.detail}</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {c.actions.map((a, j) => (
                                <button
                                  key={j}
                                  className={cls(
                                    "text-xs px-2 py-1 rounded-lg border",
                                    dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                                  )}
                                  onClick={a.fn}
                                  type="button"
                                >
                                  {a.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </Section>

                <Section
                  title="Espacio (carpetas objetivo)"
                  actions={
                    <div className="w-72">
                      <TextInput value={qSpace} onChange={setQSpace} placeholder="Buscar (key o ruta)..." dark={dark} />
                    </div>
                  }
                  dark={dark}
                >
                  <div className={cls("text-sm mb-3", dark ? "text-zinc-400" : "text-gray-600")}>
                    Tamaños estimados por carpeta. Pulsa <b>Abrir</b> para ir directo a la ruta.
                  </div>

                  <Table
                    dark={dark}
                    cols={[
                      { key: "key", label: "Carpeta" },
                      { key: "sizeGB", label: "Tamaño (GB)", render: (r) => (r?.sizeGB != null ? r.sizeGB : "N/D") },
                      { key: "path", label: "Ruta", render: (r) => <span className="text-xs break-all">{safeStr(r?.path)}</span> },
                      {
                        key: "_open",
                        label: "Acción",
                        render: (r) => (
                          <button
                            className={cls(
                              "text-xs px-2 py-1 rounded-lg border",
                              dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                            )}
                            onClick={() => openFolder(r?.path)}
                            type="button"
                          >
                            Abrir
                          </button>
                        ),
                      },
                    ]}
                    rows={filteredSpaceTargets}
                  />
                </Section>

                <Section title="Acciones rápidas de espacio" dark={dark}>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <QuickButton label="Storage Sense" onClick={() => doAction("storage")} dark={dark} />
                    <QuickButton label="Apps instaladas" onClick={() => doAction("apps")} dark={dark} />
                    <QuickButton label="Windows Update" onClick={() => doAction("windowsupdate")} dark={dark} />
                    <QuickButton label="Abrir TEMP" onClick={() => doAction("temp")} dark={dark} />
                  </div>
                </Section>
              </div>
            ) : null}

            {/* PROCESOS */}
            {view && tab === "procesos" ? (
              <div className="space-y-4">
                <Section
                  title="Procesos"
                  actions={
                    <div className="w-72">
                      <TextInput value={qProc} onChange={setQProc} placeholder="Buscar proceso (ej. docker, edge, vmmem)..." dark={dark} />
                    </div>
                  }
                  dark={dark}
                >
                  <div className={cls("text-sm", dark ? "text-zinc-400" : "text-gray-600")}>
                    Filtra por nombre o ruta. (Top CPU y Top RAM)
                  </div>
                </Section>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Section title={`Top por CPU (${filteredTopCPU.length})`} dark={dark}>
                    <Table
                      dark={dark}
                      cols={[
                        { key: "Name", label: "Proceso", render: (r) => safeStr(r?.Name) },
                        { key: "Id", label: "PID", render: (r) => safeStr(r?.Id) },
                        { key: "CPU", label: "CPU total", render: (r) => (r?.CPU != null ? Number(r.CPU).toFixed(2) : "N/D") },
                        { key: "WorkingSet64", label: "RAM", render: (r) => formatBytes(r?.WorkingSet64) },
                        {
                          key: "Path",
                          label: "Ruta",
                          render: (r) => {
                            const p = r?.Path;
                            const ps = typeof p === "string" ? p : "";
                            return ps ? <span className="text-xs break-all">{ps}</span> : <span className="text-xs opacity-70">N/D</span>;
                          },
                        },
                        {
                          key: "_act",
                          label: "Acciones",
                          render: (r) => {
                            const p = r?.Path;
                            const canOpen = typeof p === "string" && p.trim().length > 0;
                            return (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className={cls(
                                    "text-xs px-2 py-1 rounded-lg border",
                                    dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50",
                                    !canOpen && "opacity-50 cursor-not-allowed"
                                  )}
                                  onClick={() => canOpen && openFolder(p)}
                                  type="button"
                                  disabled={!canOpen}
                                >
                                  Abrir
                                </button>
                                <button
                                  className={cls(
                                    "text-xs px-2 py-1 rounded-lg border",
                                    dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                                  )}
                                  onClick={() => {
                                    const pid = r?.Id;
                                    if (!pid) return;
                                    const ok = window.confirm(`¿Terminar proceso ${safeStr(r?.Name)} (PID ${pid})?`);
                                    if (ok) killProcess(pid);
                                  }}
                                  type="button"
                                >
                                  Terminar
                                </button>
                              </div>
                            );
                          },
                        },
                      ]}
                      rows={filteredTopCPU}
                    />
                  </Section>

                  <Section title={`Top por RAM (${filteredTopRAM.length})`} dark={dark}>
                    <Table
                      dark={dark}
                      cols={[
                        { key: "Name", label: "Proceso", render: (r) => safeStr(r?.Name) },
                        { key: "Id", label: "PID", render: (r) => safeStr(r?.Id) },
                        { key: "WorkingSet64", label: "RAM", render: (r) => formatBytes(r?.WorkingSet64) },
                        { key: "CPU", label: "CPU total", render: (r) => (r?.CPU != null ? Number(r.CPU).toFixed(2) : "N/D") },
                        {
                          key: "Path",
                          label: "Ruta",
                          render: (r) => {
                            const p = r?.Path;
                            const ps = typeof p === "string" ? p : "";
                            return ps ? <span className="text-xs break-all">{ps}</span> : <span className="text-xs opacity-70">N/D</span>;
                          },
                        },
                        {
                          key: "_act",
                          label: "Acciones",
                          render: (r) => {
                            const p = r?.Path;
                            const canOpen = typeof p === "string" && p.trim().length > 0;
                            return (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className={cls(
                                    "text-xs px-2 py-1 rounded-lg border",
                                    dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50",
                                    !canOpen && "opacity-50 cursor-not-allowed"
                                  )}
                                  onClick={() => canOpen && openFolder(p)}
                                  type="button"
                                  disabled={!canOpen}
                                >
                                  Abrir
                                </button>
                                <button
                                  className={cls(
                                    "text-xs px-2 py-1 rounded-lg border",
                                    dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                                  )}
                                  onClick={() => {
                                    const pid = r?.Id;
                                    if (!pid) return;
                                    const ok = window.confirm(`¿Terminar proceso ${safeStr(r?.Name)} (PID ${pid})?`);
                                    if (ok) killProcess(pid);
                                  }}
                                  type="button"
                                >
                                  Terminar
                                </button>
                              </div>
                            );
                          },
                        },
                      ]}
                      rows={filteredTopRAM}
                    />
                  </Section>
                </div>
              </div>
            ) : null}

            {/* ARRANQUE */}
            {view && tab === "arranque" ? (
              <div className="space-y-4">
                <Section
                  title={`Programas en inicio (${filteredStartup.length})`}
                  actions={
                    <div className="w-72">
                      <TextInput value={qStartup} onChange={setQStartup} placeholder="Buscar (nombre o comando)..." dark={dark} />
                    </div>
                  }
                  dark={dark}
                >
                  <div className={cls("text-sm mb-3", dark ? "text-zinc-400" : "text-gray-600")}>
                    Tabla con acciones y un resumen Top 10 por tipo+nombre.
                  </div>

                  <div className="mb-4">
                    <Table
                      dark={dark}
                      cols={[
                        { key: "source", label: "Tipo" },
                        { key: "name", label: "Nombre" },
                        { key: "count", label: "Repeticiones" },
                        {
                          key: "_go",
                          label: "Acción",
                          render: (r) => (
                            <button
                              className={cls(
                                "text-xs px-2 py-1 rounded-lg border",
                                dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                              )}
                              onClick={() => {
                                const q = encodeURIComponent(`${safeStr(r?.name)} startup item ${safeStr(r?.source)}`);
                                openUrl(`https://www.google.com/search?q=${q}`);
                              }}
                              type="button"
                            >
                              Buscar
                            </button>
                          ),
                        },
                      ]}
                      rows={startupGroups}
                    />
                  </div>

                  <Table
                    dark={dark}
                    cols={[
                      { key: "Name", label: "Nombre", render: (r) => safeStr(r?.Name) },
                      { key: "Source", label: "Tipo", render: (r) => safeStr(r?.Source) },
                      {
                        key: "Enabled",
                        label: "Estado",
                        render: (r) =>
                          r?.Enabled === false ? (
                            <span className={cls("text-xs px-2 py-1 rounded-lg border", dark ? "border-zinc-800 bg-zinc-900" : "border-gray-200 bg-gray-50")}>
                              Desactivado
                            </span>
                          ) : (
                            <span className={cls("text-xs px-2 py-1 rounded-lg border", dark ? "border-zinc-800 bg-zinc-900" : "border-gray-200 bg-gray-50")}>
                              Activo
                            </span>
                          ),
                      },
                      { key: "Location", label: "Ubicación", render: (r) => safeStr(r?.Location) },
                      {
                        key: "Command",
                        label: "Comando",
                        render: (r) => <span className={cls("text-xs break-all", dark ? "text-zinc-200" : "text-gray-700")}>{safeStr(r?.Command)}</span>,
                      },
                      {
                        key: "_actions",
                        label: "Acciones",
                        render: (r) => {
                          const canToggle = r?.Source === "RunKey" || r?.Source === "StartupFolder";
                          const nextEnabled = r?.Enabled === false;
                          const cmd = r?.Command;
                          const canOpen = typeof cmd === "string" && cmd.trim().length > 0;

                          return (
                            <div className="flex flex-wrap gap-2">
                              <button
                                className={cls(
                                  "text-xs px-2 py-1 rounded-lg border",
                                  dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50",
                                  !canOpen && "opacity-50 cursor-not-allowed"
                                )}
                                onClick={() => canOpen && openFolder(cmd)}
                                type="button"
                                disabled={!canOpen}
                              >
                                Abrir
                              </button>

                              <button
                                className={cls(
                                  "text-xs px-2 py-1 rounded-lg border",
                                  dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50",
                                  !canToggle && "opacity-50 cursor-not-allowed"
                                )}
                                onClick={() => {
                                  if (!canToggle) return;
                                  toggleStartupItem(r, nextEnabled);
                                }}
                                type="button"
                                disabled={!canToggle}
                              >
                                {nextEnabled ? "Activar" : "Desactivar"}
                              </button>

                              <button
                                className={cls(
                                  "text-xs px-2 py-1 rounded-lg border",
                                  dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                                )}
                                onClick={() => {
                                  const q = encodeURIComponent(`${safeStr(r?.Name)} ${safeStr(r?.Command)}`);
                                  openUrl(`https://www.google.com/search?q=${q}`);
                                }}
                                type="button"
                              >
                                Buscar
                              </button>
                            </div>
                          );
                        },
                      },
                    ]}
                    rows={filteredStartup}
                  />
                </Section>
              </div>
            ) : null}

            {/* EVENTOS */}
            {view && tab === "eventos" ? (
              <div className="space-y-4">
                <Section
                  title={`Eventos críticos (${filteredEvents.length})`}
                  actions={
                    <div className="flex items-center gap-2">
                      <select
                        value={eventsWindow}
                        onChange={(e) => setEventsWindow(e.target.value)}
                        className={cls(
                          "rounded-xl px-3 py-2 text-sm border outline-none",
                          dark ? "bg-zinc-900 border-zinc-800 text-zinc-100" : "bg-white border-gray-200 text-gray-900"
                        )}
                      >
                        <option value="24h">24h</option>
                        <option value="48h">48h</option>
                        <option value="7d">7 días</option>
                      </select>

                      <div className="w-72">
                        <TextInput value={qEvents} onChange={setQEvents} placeholder="Buscar (origen, ID, texto)..." dark={dark} />
                      </div>
                    </div>
                  }
                  dark={dark}
                >
                  <div className={cls("text-sm mb-3", dark ? "text-zinc-400" : "text-gray-600")}>
                    Agrupado por origen + EventID (Top 10). Usa “Ver” para detalle y “Buscar” para abrir Google.
                  </div>

                  <div className="mb-4">
                    <Table
                      dark={dark}
                      cols={[
                        { key: "provider", label: "Origen" },
                        { key: "id", label: "ID" },
                        { key: "count", label: "Repeticiones" },
                        {
                          key: "_go",
                          label: "Acción",
                          render: (r) => (
                            <div className="flex flex-wrap gap-2">
                              <button
                                className={cls(
                                  "text-xs px-2 py-1 rounded-lg border",
                                  dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                                )}
                                onClick={() => {
                                  const q = encodeURIComponent(`${safeStr(r?.provider)} event ${safeStr(r?.id)}`);
                                  openUrl(`https://www.google.com/search?q=${q}`);
                                }}
                                type="button"
                              >
                                Buscar
                              </button>

                              <button
                                className={cls(
                                  "text-xs px-2 py-1 rounded-lg border",
                                  dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                                )}
                                onClick={async () => {
                                  const ok = await copyText(`${safeStr(r?.provider)} ${safeStr(r?.id)}`);
                                  setToast(ok ? "Copiado ✅" : "No se pudo copiar ❌");
                                  setTimeout(() => setToast(""), 2000);
                                }}
                                type="button"
                              >
                                Copiar
                              </button>
                            </div>
                          ),
                        },
                      ]}
                      rows={eventGroups}
                    />
                  </div>

                  <Table
                    dark={dark}
                    cols={[
                      {
                        key: "TimeCreated",
                        label: "Fecha",
                        render: (r) => {
                          const d = parsePsDate(r?.TimeCreated);
                          return d ? d.toLocaleString() : safeStr(r?.TimeCreated ?? "");
                        },
                      },
                      { key: "Id", label: "ID", render: (r) => safeStr(r?.Id) },
                      { key: "ProviderName", label: "Origen", render: (r) => safeStr(r?.ProviderName) },
                      { key: "LevelDisplayName", label: "Nivel", render: (r) => safeStr(r?.LevelDisplayName) },
                      {
                        key: "_actions",
                        label: "Acciones",
                        render: (r) => (
                          <div className="flex flex-wrap gap-2">
                            <button
                              className={cls(
                                "text-xs px-2 py-1 rounded-lg border",
                                dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                              )}
                              onClick={() => setEventDetail(r)}
                              type="button"
                            >
                              Ver
                            </button>

                            <button
                              className={cls(
                                "text-xs px-2 py-1 rounded-lg border",
                                dark ? "bg-zinc-900 border-zinc-800 hover:bg-zinc-800" : "bg-white border-gray-200 hover:bg-gray-50"
                              )}
                              onClick={() => {
                                const q = encodeURIComponent(`${safeStr(r?.ProviderName)} event ${safeStr(r?.Id)}`);
                                openUrl(`https://www.google.com/search?q=${q}`);
                              }}
                              type="button"
                            >
                              Buscar
                            </button>
                          </div>
                        ),
                      },
                      {
                        key: "Message",
                        label: "Mensaje (resumen)",
                        render: (r) => {
                          const msg = safeStr(r?.Message ?? "");
                          return (
                            <span className={cls("text-xs whitespace-normal", dark ? "text-zinc-200" : "text-gray-700")}>
                              {msg.slice(0, 160)}
                              {msg.length > 160 ? "…" : ""}
                            </span>
                          );
                        },
                      },
                    ]}
                    rows={filteredEvents}
                  />
                </Section>
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
