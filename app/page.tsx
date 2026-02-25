"use client";

import React, { useEffect, useMemo, useState } from "react";

type ClickResult = "ok" | "bad";

function normalizeForCompare(s: string) {
  // IMPORTANTE: aquí NO quitamos acentos. Solo normalizamos Unicode.
  // Esto hace que comparaciones sean más estables (NFC).
  return s.normalize("NFC");
}

// Tokenizador: devuelve tokens (palabras griegas) + separadores (espacios/puntuación)
// para poder renderizar “tal cual” el texto.
function tokenizePreserve(text: string): Array<{ kind: "word" | "sep"; value: string }> {
  // Palabra = letras + diacríticos (combining marks)
  // Usamos Unicode property escapes.
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
].map(normalizeForCompare);

export default function Page() {
  const [rawText, setRawText] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // misión editable (una palabra por línea)
  const [missionText, setMissionText] = useState<string>(DEFAULT_MISSION.join("\n"));
  const [search, setSearch] = useState("");
  const [onlyMission, setOnlyMission] = useState(false);

  // feedback de clics (para pintar verde/rojo “por un momento”)
  const [lastClick, setLastClick] = useState<{ idx: number; result: ClickResult } | null>(null);

  // contadores por palabra (solo misión)
  const [foundCounts, setFoundCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const res = await fetch("/acts_griego.txt", { cache: "no-store" });
        const t = await res.text();
        if (isMounted) setRawText(t.normalize("NFC"));
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const missionSet = useMemo(() => {
    const lines = missionText
      .split("\n")
      .map((s) => normalizeForCompare(s.trim()))
      .filter(Boolean);
    return new Set(lines);
  }, [missionText]);

  const missionList = useMemo(() => Array.from(missionSet), [missionSet]);

  const tokens = useMemo(() => tokenizePreserve(rawText), [rawText]);

  const totalMissionFound = useMemo(() => {
    return Object.values(foundCounts).reduce((a, b) => a + b, 0);
  }, [foundCounts]);

  const missionProgress = useMemo(() => {
    // cuántas palabras de la misión ya encontraste al menos 1 vez
    const done = missionList.filter((w) => (foundCounts[w] || 0) > 0).length;
    return { done, total: missionList.length };
  }, [foundCounts, missionList]);

  function resetDay() {
    setFoundCounts({});
    setLastClick(null);
  }

  function onWordClick(word: string, idx: number) {
    const w = normalizeForCompare(word);
    const ok = missionSet.has(w);
    setLastClick({ idx, result: ok ? "ok" : "bad" });

    if (ok) {
      setFoundCounts((prev) => ({
        ...prev,
        [w]: (prev[w] || 0) + 1
      }));
    }

    // quitar “flash” luego de un rato
    window.setTimeout(() => {
      setLastClick((cur) => (cur?.idx === idx ? null : cur));
    }, 350);
  }

  const filteredTokens = useMemo(() => {
    const q = normalizeForCompare(search.trim());
    if (!q && !onlyMission) return tokens;

    return tokens.filter((t) => {
      if (t.kind === "sep") return !onlyMission; // si “solo misión”, ocultamos separadores (para no ver ruido)
      const w = normalizeForCompare(t.value);

      const passMission = !onlyMission || missionSet.has(w);
      const passSearch = !q || w.includes(q);
      return passMission && passSearch;
    });
  }, [tokens, search, onlyMission, missionSet]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="h1">Hechos — Juego de Vocabulario (Griego)</div>
          <div className="sub">
            Clickea palabras en el texto. Verde = está en tu misión. Rojo = no está.
          </div>
        </div>

        <div className="row">
          <span className="badge">Progreso: {missionProgress.done}/{missionProgress.total}</span>
          <span className="badge">Aciertos totales: {totalMissionFound}</span>
          <button className="btn" onClick={resetDay}>Reiniciar día</button>
        </div>
      </div>

      <div className="grid">
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
            <button
              className="btn"
              onClick={() => setMissionText(DEFAULT_MISSION.join("\n"))}
              title="Vuelve a las 25 por defecto"
            >
              Cargar ejemplo (25)
            </button>

            <button className="btn" onClick={() => setMissionText("")}>
              Limpiar
            </button>
          </div>

          <div style={{ marginTop: 14, fontWeight: 700 }}>Marcador</div>
          <div className="small" style={{ marginTop: 4 }}>
            Tip: tu objetivo es que cada palabra de la misión tenga al menos 1 “found”.
          </div>

          <div style={{ marginTop: 10, maxHeight: 260, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Palabra</th>
                  <th>Encontrada</th>
                </tr>
              </thead>
              <tbody>
                {missionList.map((w) => (
                  <tr key={w}>
                    <td style={{ fontFamily: "ui-serif, Georgia, serif" }}>{w}</td>
                    <td>{foundCounts[w] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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
                <input
                  type="checkbox"
                  checked={onlyMission}
                  onChange={(e) => setOnlyMission(e.target.checked)}
                />
                <span className="small">Mostrar solo misión</span>
              </label>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Buscar (subcadena exacta, con acentos)</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ej: εἶπεν, καὶ, ἐγένετο..."
            />
          </div>

          <div style={{ marginTop: 12 }} className="scroller">
            {loading ? (
              <div className="small">Cargando texto...</div>
            ) : rawText.trim().length === 0 ? (
              <div className="small">
                No se encontró texto. Verifica que exista <code>public/acts_griego.txt</code>.
              </div>
            ) : (
              <div style={{ lineHeight: 1.75, fontSize: 16, fontFamily: "ui-serif, Georgia, serif" }}>
                {filteredTokens.map((t, i) => {
                  if (t.kind === "sep") {
                    return <span key={i}>{t.value}</span>;
                  }

                  const w = normalizeForCompare(t.value);
                  const isMission = missionSet.has(w);

                  const isFlash =
                    lastClick?.idx === i ? lastClick.result : null;

                  const className =
                    "token " +
                    (isFlash === "ok"
                      ? "token-ok"
                      : isFlash === "bad"
                      ? "token-bad"
                      : "");

                  // Si “solo misión”, aún pintamos como tokens para que puedas clic
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
            Si quieres que el juego diga “en qué capítulo/verso aparece X”, necesito que el texto tenga marcadores de capítulo/verso
            o que usemos una fuente con versificación (lo agregamos luego).
          </div>
        </div>
      </div>
    </div>
  );
}
