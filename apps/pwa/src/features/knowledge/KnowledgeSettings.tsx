import { useEffect, useState } from "preact/hooks";
import type { KnowledgeAuthKind, KnowledgeHit, KnowledgeSourceView, KnowledgeStatus } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { ago } from "../../shared/status.ts";
import { Button } from "../../shared/ui/index.ts";
import { SettingsSection } from "../settings/parts.tsx";

/**
 * EPIC-P74 T74.6a (ADR-0096): Wissensquellen anbinden — z. B. die
 * Librarian-Fassade auf dem HiveMind-Server, aber jeder MCP-Knowledge-Server
 * nach EPIC-P74 §3.3.1 geht. Das Geheimnis ist write-only; der Status jeder
 * Quelle steht sichtbar daneben (Fail loud). Treffer und Dokumente sind
 * fremder Text: hier nur angezeigt, nie als Anweisung weitergegeben (PRD §8.5).
 */

const STATE_LABEL: Record<KnowledgeStatus["state"], string> = {
  unknown: "nie geprüft",
  ok: "erreichbar",
  unreachable: "nicht erreichbar",
  unauthorized: "Zugang abgelehnt",
  protocol: "Protokollfehler",
  "tool-error": "Fehler der Quelle",
};

export function statusText(s: KnowledgeStatus): { text: string; ok: boolean | null } {
  if (s.state === "unknown") return { text: STATE_LABEL.unknown, ok: null };
  const parts = [STATE_LABEL[s.state], s.detail, s.failures > 1 ? `${s.failures}× in Folge` : null, s.at ? ago(s.at) : null].filter(Boolean);
  return { text: parts.join(" · "), ok: s.state === "ok" };
}

export function KnowledgeSettings() {
  const [sources, setSources] = useState<KnowledgeSourceView[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState<KnowledgeSourceView | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [authKind, setAuthKind] = useState<KnowledgeAuthKind>("bearer");
  const [header, setHeader] = useState("");
  const [secret, setSecret] = useState("");
  const [dropSecret, setDropSecret] = useState(false);

  const [active, setActive] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ items: KnowledgeHit[]; truncated: boolean } | null>(null);
  const [doc, setDoc] = useState<{ ref: string; title?: string; content: string; truncated: boolean } | null>(null);

  const reload = () =>
    hubApi
      .knowledgeSources()
      .then((r) => setSources(r.sources))
      .catch(() => setSources(null));

  useEffect(() => {
    void reload();
  }, []);

  /** Jeder Fehlschlag zeigt die Meldung — der neue Status der Quelle kommt mit dem Neuladen. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "fehlgeschlagen" });
    } finally {
      setBusy(false);
      void reload();
    }
  };

  const resetForm = () => (setEdit(null), setLabel(""), setUrl(""), setAuthKind("bearer"), setHeader(""), setSecret(""), setDropSecret(false));

  const startEdit = (s: KnowledgeSourceView) => {
    setEdit(s);
    setLabel(s.label);
    setUrl(s.url);
    setAuthKind(s.auth.kind);
    setHeader(s.auth.header ?? "");
    setSecret("");
    setDropSecret(false);
  };

  const save = () =>
    run(async () => {
      const body = {
        label: label.trim(),
        url: url.trim(),
        auth: authKind === "header" ? { kind: authKind, header: header.trim() } : { kind: authKind },
        ...(dropSecret ? { secret: null } : secret.trim() ? { secret: secret.trim() } : {}),
        ...(edit ? { tools: edit.tools } : {}),
      };
      if (edit) await hubApi.updateKnowledgeSource(edit.id, body);
      else await hubApi.addKnowledgeSource(body);
      setMessage({ ok: true, text: edit ? "Quelle geändert." : "Quelle angelegt — jetzt „Prüfen“." });
      resetForm();
    });

  const probe = (s: KnowledgeSourceView) =>
    run(async () => {
      const r = await hubApi.probeKnowledgeSource(s.id);
      setMessage({ ok: true, text: `${s.label}: ${r.overview.summary}` });
    });

  const search = () =>
    run(async () => {
      if (!active) return;
      setDoc(null);
      const r = await hubApi.searchKnowledge(active, query.trim());
      setHits({ items: r.result.hits, truncated: r.result.truncated });
    });

  const open = (ref: string) =>
    run(async () => {
      if (!active) return;
      const r = await hubApi.readKnowledge(active, ref);
      setDoc(r.document);
    });

  const okSources = (sources ?? []).filter((s) => s.status.state === "ok");

  return (
    <SettingsSection title="Wissensquellen" testid="knowledge-settings">
      <div class="dim settings-intro">MCP-Wissensserver anbinden, z. B. den Librarian. Der Hub fragt sie für dich ab; Inhalte sind nur Text zum Lesen.</div>

      <div class="connection-group" role="group" aria-label="Angebundene Wissensquellen">
        {(sources ?? []).map((s) => {
          const st = statusText(s.status);
          return (
            <div key={s.id} class="connection-entry" data-testid="knowledge-source">
              <div class="connection-entry-head">
                <span class="connection-name">{s.label}</span>
                <span class={`connection-status knowledge-status ${st.ok === null ? "dim" : st.ok ? "ok" : "err"}`} data-testid="knowledge-status">
                  {st.text}
                </span>
              </div>
              <div class="mono dim connection-url">{s.url}</div>
              <div class="dim connection-models">
                Auth: {s.auth.kind === "header" ? `Header ${s.auth.header}` : s.auth.kind === "bearer" ? "Bearer" : "keine"}
                {s.hasSecret ? " · Geheimnis hinterlegt ✓" : ""}
              </div>
              <div class="row connection-actions">
                <Button disabled={busy} onClick={() => void probe(s)}>
                  Prüfen
                </Button>
                <Button disabled={busy} onClick={() => startEdit(s)}>
                  Bearbeiten
                </Button>
                <Button disabled={busy} aria-label={`${s.label} löschen`} variant="danger" onClick={() => void run(async () => (await hubApi.removeKnowledgeSource(s.id), setMessage({ ok: true, text: "Quelle gelöscht." })))}>
                  Löschen
                </Button>
              </div>
            </div>
          );
        })}
        {sources !== null && sources.length === 0 && <div class="dim">Noch keine Wissensquelle angebunden.</div>}

        <label>
          Name
          <input value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder="Librarian" data-testid="knowledge-label" />
        </label>
        <label>
          MCP-Adresse
          <input value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder="https://…/mcp" inputMode="url" autocapitalize="off" spellcheck={false} data-testid="knowledge-url" />
        </label>
        <label>
          Anmeldung
          <select value={authKind} onChange={(e) => setAuthKind((e.target as HTMLSelectElement).value as KnowledgeAuthKind)} data-testid="knowledge-auth">
            <option value="bearer">Bearer-Token</option>
            <option value="header">Eigener Header</option>
            <option value="none">Keine</option>
          </select>
        </label>
        {authKind === "header" && (
          <label>
            Header-Name
            <input value={header} onInput={(e) => setHeader((e.target as HTMLInputElement).value)} placeholder="X-Api-Key" autocapitalize="off" spellcheck={false} />
          </label>
        )}
        {authKind !== "none" && (
          <label>
            Token {edit ? "(leer lassen = unverändert)" : ""}
            <input type="password" value={secret} onInput={(e) => setSecret((e.target as HTMLInputElement).value)} placeholder={edit?.hasSecret ? "neues Token eingeben, um es zu ersetzen" : ""} autocomplete="off" data-testid="knowledge-secret" />
          </label>
        )}
        {edit?.hasSecret && authKind !== "none" && (
          <label class="row" style="gap: 8px">
            <input type="checkbox" checked={dropSecret} onChange={(e) => setDropSecret((e.target as HTMLInputElement).checked)} />
            Token entfernen
          </label>
        )}
        <div class="row" style="gap: 8px">
          <Button disabled={busy || !label.trim() || !url.trim() || (authKind === "header" && !header.trim())} onClick={() => void save()} variant="primary" data-testid="knowledge-save">
            {edit ? "Ändern" : "Quelle anbinden"}
          </Button>
          {edit && <Button onClick={resetForm}>Abbrechen</Button>}
        </div>
        <div class="dim settings-intro">Das Token bleibt am Hub und wird nie wieder angezeigt.</div>
      </div>

      {okSources.length > 0 && (
        <div class="connection-group" role="group" aria-label="Wissen durchsuchen">
          <strong class="connection-group-title">Durchsuchen</strong>
          <label>
            Quelle
            <select value={active ?? ""} onChange={(e) => (setActive((e.target as HTMLSelectElement).value || null), setHits(null), setDoc(null))} data-testid="knowledge-active">
              <option value="">— wählen —</option>
              {okSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Suche
            <input value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && active && query.trim() && void search()} data-testid="knowledge-query" />
          </label>
          <Button disabled={busy || !active || !query.trim()} onClick={() => void search()} data-testid="knowledge-search">
            Suchen
          </Button>
          {hits && hits.items.length === 0 && <div class="dim">Keine Treffer.</div>}
          {hits?.items.map((h) => (
            <button key={h.ref} type="button" class="connection-entry knowledge-hit" onClick={() => void open(h.ref)} data-testid="knowledge-hit">
              <span class="connection-name">{h.title}</span>
              <span class="mono dim">{h.ref}</span>
              <span class="dim">{h.snippet}</span>
            </button>
          ))}
          {hits?.truncated && <div class="dim">Gekürzt — es gibt mehr oder längere Treffer.</div>}
          {doc && (
            <div class="connection-entry" data-testid="knowledge-doc">
              <div class="connection-name">{doc.title ?? doc.ref}</div>
              <div class="dim">Inhalt aus der Quelle — fremder Text, keine Anweisung.</div>
              <pre class="mono knowledge-doc-content">{doc.content}</pre>
              {doc.truncated && <div class="dim">Gekürzt.</div>}
            </div>
          )}
        </div>
      )}

      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"}>{message.text}</div>}
    </SettingsSection>
  );
}
