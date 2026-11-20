import { useEffect, useState } from "preact/hooks";
import type { KnowledgeHit, KnowledgeOverview, KnowledgeSourceView } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { ago } from "../../shared/status.ts";
import { Button, EmptyState } from "../../shared/ui/index.ts";
import { readKnowledgeSnapshot, writeKnowledgeSnapshot, type KnowledgeSnapshot } from "./knowledge-cache.ts";
import { statusText } from "./KnowledgeSettings.tsx";

/**
 * EPIC-P74 T74.6 (ADR-0096 + Nachtrag): die Arbeitsfläche für angebundene
 * Wissens-Quellen im Notizen-Bereich — Quell-Auswahl, Suche mit sichtbaren
 * Fusion-Parametern (EPIC-134: nie hardcoded), Lesen, Graph, Schreiben nur als
 * Freigabe. Treffer und Dokumente sind fremder Text: nur angezeigt, nie als
 * Anweisung weitergegeben (PRD §8.5). Offline gilt die letzte Übersicht (K10).
 */

interface PendingAdd {
  id: string;
  summary: string;
  timeoutAt: string;
}

export function KnowledgePanel() {
  const [sources, setSources] = useState<KnowledgeSourceView[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState("8");
  const [fusion, setFusion] = useState<"" | "sequential" | "rrf">("");
  const [minScore, setMinScore] = useState("");
  const [hits, setHits] = useState<{ items: KnowledgeHit[]; truncated: boolean } | null>(null);
  const [doc, setDoc] = useState<{ ref: string; title?: string; content: string; outlinks?: string[]; backlinks?: string[]; truncated: boolean } | null>(null);
  const [graph, setGraph] = useState<{ nodes: { ref: string; title?: string }[]; edges: { from: string; to: string }[]; truncated: boolean } | null>(null);

  const [addText, setAddText] = useState("");
  const [addRef, setAddRef] = useState("");
  const [pending, setPending] = useState<PendingAdd[]>([]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  /** K10: gespeicherten Stand sofort zeigen, dann frisch versuchen. */
  const snapshot = readKnowledgeSnapshot();
  useEffect(() => {
    if (snapshot) {
      setSources(snapshot.sources);
      setCachedAt(snapshot.at);
      if (snapshot.overview) setOverview(snapshot.overview);
      if (snapshot.hits) setHits(snapshot.hits);
    }
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next: Partial<KnowledgeSnapshot>) => {
    const merged: KnowledgeSnapshot = { at: new Date().toISOString(), sources: sources ?? [], ...(overview ? { overview } : {}), ...(next as KnowledgeSnapshot) };
    writeKnowledgeSnapshot(merged);
    setCachedAt(merged.at);
  };

  const reload = () => {
    hubApi
      .knowledgeSources()
      .then((r) => {
        setSources(r.sources);
        setCachedAt(new Date().toISOString());
        writeKnowledgeSnapshot({ at: new Date().toISOString(), sources: r.sources });
        void reloadPending();
      })
      .catch(() => {
        setCachedAt((at) => at ?? null);
      });
  };

  const reloadPending = () => {
    hubApi
      .approvals("pending")
      .then((list) => setPending(list.filter((a) => a.action === "knowledge.add").map((a) => ({ id: a.id, summary: a.summary, timeoutAt: a.timeoutAt }))))
      .catch(() => undefined);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Aktion scheiterte." });
      reload();
    } finally {
      setBusy(false);
    }
  };

  const active = (sources ?? []).find((s) => s.id === activeId) ?? null;
  const canGraph = overview?.tools.includes(active?.tools.graph ?? "kb_graph") ?? false;
  const canAdd = overview?.tools.includes(active?.tools.add ?? "kb_add") ?? false;

  const selectSource = (id: string) =>
    run(async () => {
      setActiveId(id);
      setOverview(null);
      setHits(null);
      setDoc(null);
      setGraph(null);
      const res = await hubApi.probeKnowledgeSource(id);
      setOverview(res.overview);
      setSources((prev) => (prev ? prev.map((s) => (s.id === id ? res.source : s)) : prev));
      persist({ overview: res.overview });
    });

  const search = () =>
    run(async () => {
      if (!activeId) return;
      const parsedTopK = Number.parseInt(topK, 10);
      const parsedMin = Number.parseFloat(minScore);
      const res = await hubApi.searchKnowledge(activeId, {
        q: query,
        ...(Number.isFinite(parsedTopK) ? { topK: parsedTopK } : {}),
        ...(fusion ? { fusion } : {}),
        ...(Number.isFinite(parsedMin) ? { minScore: parsedMin } : {}),
      });
      setHits({ items: res.result.hits, truncated: res.result.truncated });
      setDoc(null);
      setGraph(null);
      setSources((prev) => (prev ? prev.map((s) => (s.id === activeId ? res.source : s)) : prev));
      persist({ hits: { items: res.result.hits, truncated: res.result.truncated } });
    });

  const open = (ref: string) =>
    run(async () => {
      if (!activeId) return;
      const res = await hubApi.readKnowledge(activeId, ref);
      setDoc({ ...res.document });
      setGraph(null);
      setSources((prev) => (prev ? prev.map((s) => (s.id === activeId ? res.source : s)) : prev));
    });

  const neighbors = (ref: string) =>
    run(async () => {
      if (!activeId) return;
      const res = await hubApi.graphKnowledge(activeId, ref);
      setGraph({ nodes: res.graph.nodes, edges: res.graph.edges, truncated: res.graph.truncated });
      setSources((prev) => (prev ? prev.map((s) => (s.id === activeId ? res.source : s)) : prev));
    });

  const submitAdd = () =>
    run(async () => {
      if (!activeId || !addText.trim()) return;
      const res = await hubApi.addKnowledge(activeId, { text: addText.trim(), ...(addRef.trim() ? { ref: addRef.trim() } : {}) });
      setAddText("");
      setAddRef("");
      setMessage({ ok: true, text: `Zur Freigabe vorgemerkt — ${res.detail}` });
      reloadPending();
    });

  const decide = (id: string, decision: "approve" | "reject") =>
    run(async () => {
      await hubApi.decideApproval(id, decision);
      reloadPending();
      setMessage({ ok: decision === "approve", text: decision === "approve" ? "Freigegeben und geschrieben." : "Abgelehnt." });
    });

  const offlineNote = !online || (sources === null && cachedAt !== null);

  return (
    <div class="knowledge-panel" data-testid="knowledge-panel">
      <div class="knowledge-toolbar">
        <select
          class="knowledge-source"
          data-testid="knowledge-panel-source"
          aria-label="Wissens-Quelle"
          value={activeId ?? ""}
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value;
            if (id) void selectSource(id);
          }}
        >
          <option value="" disabled>
            Quelle wählen …
          </option>
          {(sources ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {active && (
          <span class={`knowledge-status st-${active.status.state}`} data-testid="knowledge-panel-status">
            {statusText(active.status).text}
          </span>
        )}
        <Button aria-label="Quellen neu laden" onClick={() => void reload()} disabled={busy}>
          Neu laden
        </Button>
      </div>

      {offlineNote && (
        <div class="knowledge-offline" data-testid="knowledge-offline" role="status">
          Offline — gespeicherter Stand{cachedAt ? ` vom ${ago(cachedAt)}` : ""}. Suchen und Schreiben brauchen die Verbindung.
        </div>
      )}
      {message && (
        <div class={message.ok ? "knowledge-msg ok" : "knowledge-msg err"} role="status" data-testid="knowledge-msg">
          {message.text}
        </div>
      )}

      {overview && active && (
        <p class="knowledge-overview" data-testid="knowledge-panel-overview">
          {active.label}: {overview.summary}
          {overview.protocol ? ` — ${overview.protocol}` : ""}
        </p>
      )}

      {active && (
        <form
          class="knowledge-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!offlineNote) void search();
          }}
        >
          <input class="knowledge-query" data-testid="knowledge-panel-query" type="search" placeholder="Im Brain suchen …" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
          <label class="knowledge-field">
            topK
            <input data-testid="knowledge-panel-topk" type="number" min={1} max={20} value={topK} onInput={(e) => setTopK((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="knowledge-field">
            Fusion
            <select data-testid="knowledge-panel-fusion" value={fusion} onChange={(e) => setFusion((e.currentTarget as HTMLSelectElement).value as "" | "sequential" | "rrf")}>
              <option value="">Standard</option>
              <option value="sequential">sequential</option>
              <option value="rrf">rrf</option>
            </select>
          </label>
          <label class="knowledge-field">
            minScore
            <input data-testid="knowledge-panel-minscore" type="number" min={0} max={1} step={0.05} value={minScore} onInput={(e) => setMinScore((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <Button type="submit" aria-busy={busy} disabled={busy || !query.trim()} data-testid="knowledge-panel-search">
            Suchen
          </Button>
        </form>
      )}

      {hits && (
        <div class="knowledge-hits">
          {hits.truncated && <div class="knowledge-truncated">Ergebnis gekappt — topK/Snippet-Grenze erreicht.</div>}
          {hits.items.length === 0 ? (
            <EmptyState>Kein Treffer.</EmptyState>
          ) : (
            <ul role="list">
              {hits.items.map((h) => (
                <li key={h.ref}>
                  <button type="button" class="knowledge-panel-hit" data-testid="knowledge-panel-hit" onClick={() => void open(h.ref)}>
                    <span class="knowledge-hit-title">{h.title}</span>
                    <span class="knowledge-hit-snippet">{h.snippet}</span>
                    {h.score !== undefined && <span class="knowledge-hit-score">{h.score.toFixed(2)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {doc && (
        <article class="knowledge-doc" data-testid="knowledge-panel-doc">
          <header>
            <h3>{doc.title ?? doc.ref}</h3>
            <code>{doc.ref}</code>
            {canGraph && (
              <Button aria-label="Nachbarn anzeigen" onClick={() => void neighbors(doc.ref)} disabled={busy}>
                Nachbarn
              </Button>
            )}
          </header>
          {doc.truncated && <div class="knowledge-truncated">Dokument gekappt (32-KB-Grenze).</div>}
          <pre>{doc.content}</pre>
          {(doc.outlinks?.length ?? 0) + (doc.backlinks?.length ?? 0) > 0 && (
            <div class="knowledge-links">
              {doc.outlinks?.map((r) => (
                <button type="button" key={`o${r}`} onClick={() => void open(r)} title={`Verlinkt: ${r}`}>
                  → {r}
                </button>
              ))}
              {doc.backlinks?.map((r) => (
                <button type="button" key={`b${r}`} onClick={() => void open(r)} title={`Backlink: ${r}`}>
                  ← {r}
                </button>
              ))}
            </div>
          )}
        </article>
      )}

      {graph && (
        <section class="knowledge-graph" data-testid="knowledge-panel-graph">
          <h3>Nachbarn von {graph.nodes[0]?.ref}</h3>
          {graph.truncated && <div class="knowledge-truncated">Graph gekappt — Knoten-/Kantengrenze erreicht.</div>}
          <ul class="knowledge-graph-nodes" role="list">
            {graph.nodes.map((n) => (
              <li key={n.ref}>
                <button type="button" class="knowledge-graph-node" onClick={() => void open(n.ref)}>
                  {n.title ?? n.ref}
                </button>
              </li>
            ))}
          </ul>
          <p class="knowledge-graph-edges dim">{graph.edges.length} Kanten</p>
        </section>
      )}

      {active && (
        <section class="knowledge-add">
          <h3>Notiz an „{active.label}“ — nur mit Freigabe</h3>
          {canAdd ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!offlineNote) void submitAdd();
              }}
            >
              <textarea
                data-testid="knowledge-add-text"
                rows={3}
                placeholder="Text der Notiz …"
                value={addText}
                onInput={(e) => setAddText((e.currentTarget as HTMLTextAreaElement).value)}
                disabled={offlineNote}
              />
              <input data-testid="knowledge-add-ref" type="text" placeholder="eigene ref (optional, z. B. notes/idee.md)" value={addRef} onInput={(e) => setAddRef((e.currentTarget as HTMLInputElement).value)} disabled={offlineNote} />
              <Button type="submit" disabled={busy || offlineNote || !addText.trim()} data-testid="knowledge-add-submit">
                Zur Freigabe vormerken
              </Button>
            </form>
          ) : (
            <p class="dim">Diese Quelle bietet kein Schreib-Tool (kb_add) — nur lesen.</p>
          )}
          {pending.length > 0 && (
            <ul class="knowledge-pending" role="list" data-testid="knowledge-pending">
              {pending.map((p) => (
                <li key={p.id}>
                  <span>{p.summary}</span>
                  <span class="knowledge-pending-actions">
                    <Button onClick={() => void decide(p.id, "approve")} disabled={busy} data-testid="knowledge-pending-approve">
                      Freigeben
                    </Button>
                    <Button variant="danger" onClick={() => void decide(p.id, "reject")} disabled={busy} data-testid="knowledge-pending-reject">
                      Ablehnen
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {sources !== null && sources.length === 0 && (
        <EmptyState>
          Noch keine Wissens-Quelle angebunden — in den Einstellungen unter „Wissensquellen“ anlegen (URL + Token).
        </EmptyState>
      )}
    </div>
  );
}
