"use client";

import React, { useEffect, useMemo, useState } from "react";

type ClickResult = "ok" | "bad";

/** Normaliza Unicode para estabilidad */
function nfc(s: string) {
  return (s ?? "").normalize("NFC");
}

/**
 * Clave de comparación:
 * - lower
 * - NFD
 * - quita diacríticos (combining marks)
 * - vuelve a NFC
 *
 * Así: ειπεν == εἶπεν
 */
function keyNoAccents(s: string) {
  return nfc(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "") // diacríticos
    .normalize("NFC")
    .trim();
}

/** Tokenizador: preserva separadores para render “tal cual” */
function tokenizePreserve(text: string): Array<{ kind: "word" | "sep"; value: string }> {
  // palabra = letras + diacríticos; separador = lo demás
  const re = /([\p{L}\p{M}]+)|([^\p{L}\p{M}]+)/gu;
  const out: Array<{ kind: "word" | "sep"; value: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const word = m[1];
    const sep = m[2];
    if (word) out.push({ kind: "word", value: word });
    else if (sep) out.push({ kind: "sep", value: sep });
  }
  return out;
}

const DEFAULT_MISSION = [
  "ειπεν",
  "εστιν",
  "θεος",
  "ουκ",
  "θεου",
  "παυλος",
  "εγενετο",
  "συν",
  "ανδρες",
  "κυριου",
  "ημερας",
  "ιερουσαλημ",
  "πετρος",
  "ονοματι",
  "πνευμα",
  "ιησου",
  "λογον",
  "θεον",
  "παυλον",
  "ησαν",
  "ουτως",
  "ιησουν",
  "λεγων",
  "αδελφοι",
  "νυν"
];

export default function Page() {
  const [rawText, setRawText] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // misión editable (1 palabra por línea)
  const [missionText, setMissionText] = useState<string>(DEFAULT_MISSION.join("\n"));

  // filtros
  const [search, setSearch] = useState("");
  const [onlyMission, setOnlyMission] = useState(false);

  // opciones clave
  const [ignoreAccents, setIgnoreAccents] = useState(true); // <-- default ON
  const [lineMode, setLineMode] = useState(true); // modo “verso-like” por líneas

  // feedback clic
  const [lastClick, setLastClick] = useState<{ idx: number; result: ClickResult } | null>(null);

  // contadores por palabra (guardamos por clave)
  const [foundCounts, setFoundCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const res = await fetch("/acts_griego.txt", { cache: "no-store" });
        const t = await res.text();
        if (isMounted) setRawText(nfc(t));
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Misión:
   * guardamos:
   * - display: lo que el usuario escribió
   * - key: clave (sin acentos si ignoreAccents)
   */
  const missionItems = useMemo(() => {
    const lines = missionText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    // quitamos duplicados por “clave”
    const map = new Map<string, string>(); // key -> display
    for (const w of lines) {
      const k = ignoreAccents ? keyNoAccents(w) : nfc(w).toLowerCase();
      if (!map.has(k)) map.set(k, w);
    }
    return Array.from(map.entries()).map(([key, display]) => ({ key, display }));
  }, [missionText, ignoreAccents]);

  const missionSet = useMemo(() => new Set(missionItems.map((x) => x.key)), [missionItems]);

  const tokens = useMemo(() => tokenizePreserve(rawText), [rawText]);

  // texto por líneas (para “capítulo/verso-like”)
  const lines = useMemo(() => {
    const ls = rawText.split(/\r?\n/);
    // quitamos líneas vacías al inicio/fin, pero mantenemos las internas
    return ls;
  }, [rawText]);

  const totalMissionFound = useMemo(() => Object.values(foundCounts).reduce((a, b) => a + b, 0), [foundCounts]);

  const missionProgress = useMemo(() => {
    const done = missionItems.filter((w) => (foundCounts[w.key] || 0) > 0).length;
    return { done, total: missionItems.length };
  }, [foundCounts, missionItems]);

  function resetDay() {
    setFoundCounts({});
    setLastClick(null);
  }

  function wordKey(word: string) {
    return ignoreAccents ? keyNoAccents(word) : nfc(word).toLowerCase();
  }

  function onWordClick(word: string, idx: number) {
    const k = wordKey(word);
    const ok = missionSet.has(k);

    setLastClick({ idx, result: ok ? "ok" : "bad" });

    if (ok) {
      setFoundCounts((prev) => ({
        ...prev,
        [k]: (prev[k] || 0) + 1
      }));
    }

    window.setTimeout(() => {
      setLastClick((cur) => (cur?.idx === idx ? null : cur));
    }, 350);
  }

  const filteredTokens = useMemo(() => {
    const qRaw = search.trim();
    const q = ignoreAccents ? keyNoAccents(qRaw) : nfc(qRaw).toLowerCase();

    if (!q && !onlyMission) return tokens;

    return tokens.filter((t) => {
      if (t.kind === "sep") return !onlyMission;

      const k = wordKey(t.value);

      const passMission = !onlyMission || missionSet.has(k);
      const passSearch = !q || k.includes(q);

      return passMission && passSearch;
    });
  }, [tokens, search, onlyMission, missionSet, ignoreAccents]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="h1">Hechos — Juego de Vocabulario (Griego)</div>
          <div className="sub">Clickea palabras. Verde = está en tu misión. Rojo = no está.</div>
        </div>

        <div className="row">
          <span className="badge">
            Progreso: {missionProgress.done}/{missionProgress.total}
          </span>
          <span className="badge">Aciertos totales: {totalMissionFound}</span>
          <button className="btn" onClick={resetDay}>
            Reiniciar día
          </button>
        </div>
      </div>

      <div className="grid">
        {/* LEFT */}
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Misión del día</div>
              <div className="small">1 palabra por línea (tal cual la ves en tu lista).</div>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <textarea
              value={missionText}
              onChange={(e) => setMissionText(e.target.value)}
              placeholder="Pega aquí tus palabras de hoy (una por línea)"
            />
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setMissionText(DEFAULT_MISSION.join("\n"))}>
              Cargar ejemplo (25)
            </button>
            <button className="btn" onClick={() => setMissionText("")}>
              Limpiar
            </button>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={ignoreAccents} onChange={(e) => setIgnoreAccents(e.target.checked)} />
              <span className="small">Ignorar acentos (recomendado)</span>
            </label>
          </div>

          <div style={{ marginTop: 14, fontWeight: 700 }}>Marcador</div>
          <div className="small" style={{ marginTop: 4 }}>
            Objetivo: que cada palabra tenga al menos 1 “found”.
          </div>

          <div
            style={{
              marginTop: 10,
              maxHeight: 260,
              overflow: "auto",
              border: "1px solid var(--border)",
              borderRadius: 12
            }}
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Palabra</th>
                  <th>Encontrada</th>
                </tr>
              </thead>
              <tbody>
                {missionItems.map((w) => (
                  <tr key={w.key}>
                    <td style={{ fontFamily: "ui-serif, Georgia, serif" }}>{w.display}</td>
                    <td>{foundCounts[w.key] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="small" style={{ marginTop: 10 }}>
            Nota: tu <code>acts_griego.txt</code> no trae números de capítulo/verso. Por eso agregué “Modo líneas” (línea #).
            Si luego me pasas un texto con versificación (1:1, 1:2…), lo actualizamos a capítulo/verso real.
          </div>
        </div>

        {/* RIGHT */}
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Texto (clickeable)</div>
              <div className="small">
                Archivo: <code>public/acts_griego.txt</code>
              </div>
            </div>

            <div className="row">
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={onlyMission} onChange={(e) => setOnlyMission(e.target.checked)} />
                <span className="small">Mostrar solo misión</span>
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={lineMode} onChange={(e) => setLineMode(e.target.checked)} />
                <span className="small">Modo líneas</span>
              </label>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Buscar (si “ignorar acentos” está ON, puedes escribir sin acentos)</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ej: ειπεν / εἶπεν, και / καὶ, εγενετο / ἐγένετο..."
            />
          </div>

          <div style={{ marginTop: 12 }} className="scroller">
            {loading ? (
              <div className="small">Cargando texto...</div>
            ) : rawText.trim().length === 0 ? (
              <div className="small">
                No se encontró texto. Verifica que exista <code>public/acts_griego.txt</code>.
              </div>
            ) : lineMode ? (
              // ===== MODO LÍNEAS =====
              <div style={{ lineHeight: 1.9, fontSize: 16, fontFamily: "ui-serif, Georgia, serif" }}>
                {lines.map((line, li) => {
                  const lineTokens = tokenizePreserve(line);

                  // filtro: si “solo misión”, removemos líneas que no contengan ninguna palabra de misión
                  if (onlyMission) {
                    const hasAny = lineTokens.some((t) => t.kind === "word" && missionSet.has(wordKey(t.value)));
                    if (!hasAny) return null;
                  }

                  // filtro de búsqueda por línea
                  const qRaw = search.trim();
                  const q = ignoreAccents ? keyNoAccents(qRaw) : nfc(qRaw).toLowerCase();
                  if (q) {
                    const hasSearch = lineTokens.some((t) => t.kind === "word" && wordKey(t.value).includes(q));
                    if (!hasSearch) return null;
                  }

                  return (
                    <div key={li} style={{ marginBottom: 10 }}>
                      <div className="small" style={{ marginBottom: 6 }}>
                        Línea {li + 1}
                      </div>

                      <div>
                        {lineTokens.map((t, ti) => {
                          const idx = li * 100000 + ti; // idx único estable

                          if (t.kind === "sep") return <span key={idx}>{t.value}</span>;

                          const k = wordKey(t.value);
                          const isMission = missionSet.has(k);
                          const isFlash = lastClick?.idx === idx ? lastClick.result : null;

                          const className =
                            "token " +
                            (isFlash === "ok" ? "token-ok" : isFlash === "bad" ? "token-bad" : "");

                          return (
                            <span
                              key={idx}
                              className={className}
                              onClick={() => onWordClick(t.value, idx)}
                              title={
                                (isMission ? "Está en la misión" : "No está en la misión") +
                                ` • Línea ${li + 1}`
                              }
                            >
                              {t.value}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              // ===== MODO CONTINUO (original) =====
              <div style={{ lineHeight: 1.75, fontSize: 16, fontFamily: "ui-serif, Georgia, serif" }}>
                {filteredTokens.map((t, i) => {
                  if (t.kind === "sep") return <span key={i}>{t.value}</span>;

                  const k = wordKey(t.value);
                  const isMission = missionSet.has(k);
                  const isFlash = lastClick?.idx === i ? lastClick.result : null;

                  const className =
                    "token " + (isFlash === "ok" ? "token-ok" : isFlash === "bad" ? "token-bad" : "");

                  return (
                    <span
                      key={i}
                      className={className}
                      onClick={() => onWordClick(t.value, i)}
                      title={isMission ? "Está en la misión" : "No está en la misión"}
                    >
                      {t.value}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="small" style={{ marginTop: 10 }}>
            Próximo upgrade (cuando quieras): **capítulo/verso real**. Para eso necesitamos un texto con marcadores (ej: “1:1 …”),
            o convertir tu TXT a un JSON de versos.
          </div>
        </div>
      </div>
    </div>
  );
}
