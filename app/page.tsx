"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Verse = { v: number; t: string };
type ActsData = Record<string, Verse[]>; // "1".."28"

type ClickResult = "ok" | "bad";

function cleanText(s: string) {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNFC(s: string) {
  return s.normalize("NFC");
}

function stripDiacritics(s: string) {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
}

function normalizeForCompare(s: string, ignoreAccents: boolean) {
  const n = normalizeNFC(s);
  return ignoreAccents ? stripDiacritics(n) : n;
}

/**
 * Extrae versículos desde el HTML de die-bibel.
 * Estrategia principal: buscar <sup>NUM</sup> (número de verso) y tomar el texto hasta el siguiente sup.
 * Si cambian el HTML, normalmente solo ajustas esta función.
 */
function extractVersesFromHtml(html: string): Verse[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return [];

  function isVerseSup(el: Element) {
    if (el.tagName.toLowerCase() !== "sup") return false;
    const n = cleanText(el.textContent || "");
    return /^\d{1,3}$/.test(n);
  }

  function nextNode(start: Node | null): Node | null {
    if (!start) return null;
    if ((start as any).firstChild) return (start as any).firstChild;
    let n: any = start;
    while (n) {
      if (n.nextSibling) return n.nextSibling;
      n = n.parentNode;
    }
    return null;
  }

  function collectTextUntilNextSup(sup: Element) {
    const texts: string[] = [];
    let node: Node | null = nextNode(sup);

    while (node) {
      if (node.nodeType === 1 && isVerseSup(node as Element)) break;

      if (node.nodeType === 3) {
        const tx = cleanText(node.nodeValue || "");
        if (tx) texts.push(tx);
      } else if (node.nodeType === 1) {
        const el = node as Element;
        // evita duplicar grandes contenedores
        if (el.children.length === 0) {
          const tx = cleanText(el.textContent || "");
          if (tx) texts.push(tx);
        }
      }
      node = nextNode(node);
    }

    return cleanText(texts.join(" "));
  }

  const sups = Array.from(doc.querySelectorAll("sup")).filter(isVerseSup);
  const verses: Verse[] = [];

  if (sups.length > 0) {
    for (const sup of sups) {
      const v = parseInt(cleanText(sup.textContent || ""), 10);
      const t = collectTextUntilNextSup(sup);
      if (Number.isFinite(v) && t) verses.push({ v, t });
    }
  }

  // fallback (menos confiable)
  if (verses.length === 0) {
    const raw = cleanText(body.textContent || "");
    const parts = raw.split(/\s(?=\d{1,3}\s)/g);
    for (const p of parts) {
      const m = p.match(/^(\d{1,3})\s+(.*)$/);
      if (!m) continue;
      verses.push({ v: parseInt(m[1], 10), t: cleanText(m[2]) });
    }
  }

  // dedup + sort
  const seen = new Set<string>();
  const out: Verse[] = [];
  for (const x of verses) {
    const key = `${x.v}|${x.t.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  out.sort((a, b) => a.v - b.v);
  return out;
}

// tokeniza texto griego preservando separadores
function tokenizePreserve(text: string): Array<{ kind: "word" | "sep"; value: string }> {
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

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Page() {
  // --------- MODE: NA28 (online) o TXT local -----------
  const [mode, setMode] = useState<"na28" | "txt">("na28");

  // --------- NA28 data ----------
  const [acts, setActs] = useState<ActsData | null>(null);
  const [loadingActs, setLoadingActs] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [chapter, setChapter] = useState<number>(1);

  // --------- TXT local (opcional) ----------
  const [rawText, setRawText] = useState("");
  const [loadingTxt, setLoadingTxt] = useState(false);

  // --------- Study settings ----------
  const [ignoreAccents, setIgnoreAccents] = useState(true);
  const [onlyMission, setOnlyMission] = useState(false);

  const [missionText, setMissionText] = useState(DEFAULT_MISSION.join("\n"));
  const [search, setSearch] = useState("");

  const [lastClick, setLastClick] = useState<{ key: string; result: ClickResult } | null>(null);
  const [foundCounts, setFoundCounts] = useState<Record<string, number>>({});

  // --------- Refs para scroll a versículo ----------
  const verseRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // --------- Persistencia ----------
  useEffect(() => {
    try {
      const saved = localStorage.getItem("acts_vocab_state_v2");
      const savedDay = localStorage.getItem("acts_vocab_day_v2");

      if (savedDay && savedDay !== todayKey()) {
        localStorage.setItem("acts_vocab_day_v2", todayKey());
        // reset solo progreso diario
        // (misión se conserva)
        const obj = saved ? JSON.parse(saved) : {};
        obj.foundCounts = {};
        localStorage.setItem("acts_vocab_state_v2", JSON.stringify(obj));
      }

      if (saved) {
        const obj = JSON.parse(saved);
        if (obj.missionText) setMissionText(String(obj.missionText));
        if (typeof obj.ignoreAccents === "boolean") setIgnoreAccents(obj.ignoreAccents);
        if (typeof obj.onlyMission === "boolean") setOnlyMission(obj.onlyMission);
        if (typeof obj.mode === "string") setMode(obj.mode);
        if (typeof obj.chapter === "number") setChapter(obj.chapter);

        if (savedDay === todayKey() && obj.foundCounts) setFoundCounts(obj.foundCounts);
      }
      if (!savedDay) localStorage.setItem("acts_vocab_day_v2", todayKey());
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "acts_vocab_state_v2",
        JSON.stringify({ missionText, ignoreAccents, onlyMission, foundCounts, mode, chapter })
      );
      localStorage.setItem("acts_vocab_day_v2", localStorage.getItem("acts_vocab_day_v2") || todayKey());
    } catch {}
  }, [missionText, ignoreAccents, onlyMission, foundCounts, mode, chapter]);

  // --------- Mission set ----------
  const missionSet = useMemo(() => {
    const lines = missionText
      .split("\n")
      .map((s) => normalizeForCompare(s.trim(), ignoreAccents))
      .filter(Boolean);
    return new Set(lines);
  }, [missionText, ignoreAccents]);

  const missionList = useMemo(() => Array.from(missionSet), [missionSet]);

  const missionProgress = useMemo(() => {
    const done = missionList.filter((w) => (foundCounts[w] || 0) > 0).length;
    return { done, total: missionList.length };
  }, [foundCounts, missionList]);

  const totalMissionFound = useMemo(
    () => Object.values(foundCounts).reduce((a, b) => a + b, 0),
    [foundCounts]
  );

  function resetDay() {
    setFoundCounts({});
    setLastClick(null);
  }

  // --------- LOAD NA28 (cache localStorage) ----------
  async function fetchChapterHtml(ch: number) {
    const res = await fetch(`/api/na28?chapter=${ch}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`No pude bajar cap ${ch} (HTTP ${res.status})`);
    return await res.text();
  }

  async function loadNA28(force = false) {
    try {
      setLoadingActs(true);
      setStatus("Cargando NA28 Hechos (1–28)…");

      const key = "NA28_ACTS_JSON";
      if (!force) {
        const cached = localStorage.getItem(key);
        if (cached) {
          setActs(JSON.parse(cached));
          setStatus("Listo (desde cache).");
          return;
        }
      }

      const data: ActsData = {};
      for (let ch = 1; ch <= 28; ch++) {
        setStatus(`Bajando cap ${ch}/28…`);
        const html = await fetchChapterHtml(ch);
        const verses = extractVersesFromHtml(html);
        if (!verses.length) throw new Error(`Capítulo ${ch}: no pude extraer versículos (HTML cambió).`);
        data[String(ch)] = verses;
      }

      localStorage.setItem(key, JSON.stringify(data));
      setActs(data);
      setStatus("Listo. Ya tienes capítulos y versículos.");
    } catch (e: any) {
      console.error(e);
      setStatus("Error: " + (e?.message || String(e)));
    } finally {
      setLoadingActs(false);
    }
  }

  // --------- TXT local ----------
  async function loadTxt() {
    setLoadingTxt(true);
    try {
      const res = await fetch("/acts_griego.txt", { cache: "no-store" });
      const t = await res.text();
      setRawText(t.normalize("NFC"));
    } finally {
      setLoadingTxt(false);
    }
  }

  // Auto-load NA28 on first visit if mode na28
  useEffect(() => {
    if (mode === "na28" && !acts && !loadingActs) {
      loadNA28(false);
    }
    if (mode === "txt" && !rawText && !loadingTxt) {
      loadTxt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // --------- SEARCH across NA28 ----------
  const qNorm = useMemo(() => normalizeForCompare(search.trim(), ignoreAccents), [search, ignoreAccents]);

  const searchResults = useMemo(() => {
    if (mode !== "na28" || !acts || !qNorm) return [];
    const out: Array<{ ch: number; v: number; t: string }> = [];
    for (let ch = 1; ch <= 28; ch++) {
      const verses = acts[String(ch)] || [];
      for (const { v, t } of verses) {
        const comp = normalizeForCompare(t, ignoreAccents);
        if (comp.includes(qNorm)) out.push({ ch, v, t });
      }
    }
    return out.slice(0, 200);
  }, [mode, acts, qNorm, ignoreAccents]);

  function scrollToVerse(ch: number, v: number) {
    const id = `act-${ch}-${v}`;
    const el = verseRefs.current.get(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onWordClick(word: string, clickKey: string) {
    const w = normalizeForCompare(word, ignoreAccents);
    const ok = missionSet.has(w);

    setLastClick({ key: clickKey, result: ok ? "ok" : "bad" });

    if (ok) {
      setFoundCounts((prev) => ({
        ...prev,
        [w]: (prev[w] || 0) + 1
      }));
    }

    window.setTimeout(() => {
      setLastClick((cur) => (cur?.key === clickKey ? null : cur));
    }, 300);
  }

  // --------- Render helpers ----------
  function WordSpan({
    word,
    clickKey
  }: {
    word: string;
    clickKey: string;
  }) {
    const isFlash = lastClick?.key === clickKey ? lastClick.result : null;
    const className =
      "token " +
      (isFlash === "ok" ? "token-ok" : isFlash === "bad" ? "token-bad" : "");

    return (
      <span className={className} onClick={() => onWordClick(word, clickKey)} title="Click">
        {word}
      </span>
    );
  }

  const hasActs = !!acts;

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="h1">Hechos — Juego de Vocabulario (Griego)</div>
          <div className="sub">
            Misión diaria + texto clickeable.{" "}
            <b>{mode === "na28" ? "Modo NA28 (cap/verso)" : "Modo TXT local"}</b>
          </div>
        </div>

        <div className="row">
          <span className="badge">Progreso: {missionProgress.done}/{missionProgress.total}</span>
          <span className="badge">Aciertos: {totalMissionFound}</span>
          <button className="btn" onClick={resetDay}>Reiniciar día</button>
        </div>
      </div>

      <div className="grid">
        {/* LEFT */}
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Misión del día</div>
              <div className="small">1 palabra por línea. (Con “ignorar acentos” ON, escribe sin acentos).</div>
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
            <button className="btn" onClick={() => setMissionText(DEFAULT_MISSION.join("\n"))}>Cargar ejemplo (25)</button>
            <button className="btn" onClick={() => setMissionText("")}>Limpiar</button>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={ignoreAccents} onChange={(e) => setIgnoreAccents(e.target.checked)} />
              <span className="small">Ignorar acentos (recomendado)</span>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={onlyMission} onChange={(e) => setOnlyMission(e.target.checked)} />
              <span className="small">Modo “solo misión”</span>
            </label>
          </div>

          <div className="hr" />

          <div style={{ fontWeight: 800 }}>Fuente de texto</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className={"btn " + (mode === "na28" ? "btn-primary" : "")} onClick={() => setMode("na28")}>
              NA28 (cap/verso)
            </button>
            <button className={"btn " + (mode === "txt" ? "btn-primary" : "")} onClick={() => setMode("txt")}>
              TXT local
            </button>
          </div>

          {mode === "na28" && (
            <div style={{ marginTop: 10 }}>
              <div className="row">
                <button className="btn" disabled={loadingActs} onClick={() => loadNA28(false)}>
                  {hasActs ? "Recargar (cache)" : "Cargar NA28"}
                </button>
                <button className="btn" disabled={loadingActs} onClick={() => loadNA28(true)}>
                  Forzar descarga
                </button>
              </div>
              <div className="small" style={{ marginTop: 6 }}>{status}</div>

              <div className="row" style={{ marginTop: 10 }}>
                <label>Capítulo</label>
                <select
                  value={chapter}
                  onChange={(e) => setChapter(parseInt(e.target.value, 10))}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "rgba(2, 6, 23, 0.6)",
                    color: "var(--text)"
                  }}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((ch) => (
                    <option key={ch} value={ch}>Hechos {ch}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {mode === "txt" && (
            <div style={{ marginTop: 10 }}>
              <button className="btn" disabled={loadingTxt} onClick={loadTxt}>Cargar TXT</button>
              <div className="small" style={{ marginTop: 6 }}>
                Archivo: <code>public/acts_griego.txt</code>
              </div>
            </div>
          )}

          <div className="hr" />

          <div style={{ fontWeight: 800 }}>Marcador</div>
          <div className="small" style={{ marginTop: 4 }}>
            Objetivo: que cada palabra de la misión tenga al menos 1 “found”.
          </div>

          <div style={{ marginTop: 10, maxHeight: 280, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
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

        {/* RIGHT */}
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                {mode === "na28" ? "Texto NA28 (cap/verso)" : "Texto (TXT)"}
              </div>
              <div className="small">
                {mode === "na28"
                  ? "Navega por capítulo/verso, y busca devolviendo Hechos 3:16 etc."
                  : "Modo simple por texto pegado."
                }
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Buscar (si “ignorar acentos” ON, puedes escribir sin acentos)</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ej: ειπεν / εἶπεν, και / καὶ, εγενετο / ἐγένετο..."
            />
          </div>

          {mode === "na28" && qNorm && (
            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ marginBottom: 6 }}>
                Resultados (click para saltar)
              </div>
              <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12, padding: 8 }}>
                {searchResults.length === 0 ? (
                  <div className="small">Sin resultados.</div>
                ) : (
                  searchResults.map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 4px" }}>
                      <div className="small">
                        <b>Hechos {r.ch}:{r.v}</b> — {r.t}
                      </div>
                      <button className="btn" onClick={() => { setChapter(r.ch); setTimeout(() => scrollToVerse(r.ch, r.v), 50); }}>
                        Ir
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }} className="scroller">
            {mode === "na28" ? (
              !acts ? (
                <div className="small">
                  {loadingActs ? "Cargando NA28..." : "Pulsa “Cargar NA28” (o espera el auto-load)."}
                </div>
              ) : (
                <div style={{ lineHeight: 1.75, fontSize: 16, fontFamily: "ui-serif, Georgia, serif" }}>
                  {(acts[String(chapter)] || []).map(({ v, t }) => {
                    const id = `act-${chapter}-${v}`;

                    // “solo misión” = ocultamos versos que no contengan palabras de misión
                    if (onlyMission) {
                      const tNorm = normalizeForCompare(t, ignoreAccents);
                      let ok = false;
                      for (const w of missionSet) {
                        if (w && tNorm.includes(w)) { ok = true; break; }
                      }
                      if (!ok) return null;
                    }

                    const parts = tokenizePreserve(t);
                    return (
                      <div
                        key={id}
                        id={id}
                        ref={(el) => verseRefs.current.set(id, el)}
                        style={{
                          padding: "8px 10px",
                          borderBottom: "1px solid var(--border)"
                        }}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6 }}>
                          <span className="badge" style={{ fontWeight: 800 }}>
                            Hechos {chapter}:{v}
                          </span>
                        </div>

                        <div>
                          {parts.map((p, i) => {
                            if (p.kind === "sep") return <span key={i}>{p.value}</span>;
                            const clickKey = `${id}::${i}`;
                            return <WordSpan key={i} word={p.value} clickKey={clickKey} />;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              loadingTxt ? (
                <div className="small">Cargando TXT...</div>
              ) : rawText.trim().length === 0 ? (
                <div className="small">
                  No hay texto. Verifica <code>public/acts_griego.txt</code> y pulsa “Cargar TXT”.
                </div>
              ) : (
                <div style={{ lineHeight: 1.75, fontSize: 16, fontFamily: "ui-serif, Georgia, serif", whiteSpace: "pre-wrap" }}>
                  {tokenizePreserve(rawText).map((p, i) => {
                    if (p.kind === "sep") return <span key={i}>{p.value}</span>;
                    const clickKey = `txt::${i}`;
                    if (onlyMission) {
                      const w = normalizeForCompare(p.value, ignoreAccents);
                      if (!missionSet.has(w)) return null;
                    }
                    return <WordSpan key={i} word={p.value} clickKey={clickKey} />;
                  })}
                </div>
              )
            )}
          </div>

          <div className="small" style={{ marginTop: 10 }}>
            Tip: Para aprender más rápido: usa “solo misión” + click por verso, y al final revisa tu marcador hasta quedar 25/25.
          </div>
        </div>
      </div>
    </div>
  );
}
