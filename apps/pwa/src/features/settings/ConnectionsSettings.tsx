import { useEffect, useState } from "preact/hooks";
import { hubApi, type EndpointEntry, type EndpointKind, type VoidWardenConnection } from "../../shared/api.ts";
import { ago } from "../../shared/status.ts";
import { SettingsSection } from "./parts.tsx";
import { Button } from "../../shared/ui/index.ts";
import { copyIntoShelf } from "../../shared/clipboard-copy.ts";

/**
 * Verbindungs-Registry (Optionen): VoidWarden-Instanzen und Modell-/Tool-
 * Endpoints. VoidWarden bekommt pro Eintrag ein eigenes read-only-Token,
 * einmalig sichtbar — der Status ist die letzte Meldung dieses Tokens am Hub.
 * Endpoint-Schlüssel sind write-only: der Hub speichert nur den Hash und sagt
 * nur, ob einer gesetzt ist. Der Prüf-Knopf fragt Erreichbarkeit ohne Schlüssel
 * ab (jede HTTP-Antwort zählt, auch 401/403).
 */

const KIND_LABEL: Record<EndpointKind, string> = { llm: "LLM", image: "Bilderkennung", video: "Videoerkennung", other: "Sonstiges" };

function vwStatus(c: VoidWardenConnection): { text: string; ok: boolean } {
  if (!c.lastSeenAt) return { text: "noch nie gemeldet", ok: false };
  return { text: `gemeldet ${ago(c.lastSeenAt)}`, ok: true };
}

function endpointStatus(e: EndpointEntry): { text: string; ok: boolean | null } {
  if (!e.probe) return { text: "nie geprüft", ok: null };
  if (e.probe.ok) return { text: `erreichbar (HTTP ${e.probe.httpStatus}) · ${ago(e.probe.at)}`, ok: true };
  return { text: `nicht erreichbar${e.probe.detail ? ` · ${e.probe.detail}` : ""}`, ok: false };
}

export function ConnectionsSettings() {
  const [voidwarden, setVoidwarden] = useState<VoidWardenConnection[] | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointEntry[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Einmalig sichtbares Token nach Anlegen/Erneuern — nach dem Verlassen weg. */
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);

  // VoidWarden-Formular
  const [vwEdit, setVwEdit] = useState<VoidWardenConnection | null>(null);
  const [vwName, setVwName] = useState("");
  const [vwEndpoint, setVwEndpoint] = useState("");
  const [vwRotate, setVwRotate] = useState(false);

  // Endpoint-Formular
  const [epEdit, setEpEdit] = useState<EndpointEntry | null>(null);
  const [epName, setEpName] = useState("");
  const [epKind, setEpKind] = useState<EndpointKind>("llm");
  const [epUrl, setEpUrl] = useState("");
  const [epKey, setEpKey] = useState("");
  const [epDropKey, setEpDropKey] = useState(false);
  const [epModels, setEpModels] = useState("");

  const reload = () =>
    hubApi
      .connections()
      .then((c) => {
        setVoidwarden(c.voidwarden);
        setEndpoints(c.endpoints);
      })
      .catch(() => {
        setVoidwarden(null);
        setEndpoints(null);
      });

  useEffect(() => {
    void reload();
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const copyToken = (token: string) => {
    // ADR-0090: ein Token ist kein Ablage-Stoff — die Zwischenablage ja, die Ablage nein.
    void copyIntoShelf(token, "text", { secret: true }).then((ok) =>
      setMessage(ok ? { ok: true, text: "Token kopiert." } : { ok: false, text: "Kopieren nicht erlaubt — bitte von Hand markieren." }),
    );
  };

  const saveVoidWarden = () =>
    run(async () => {
      const body = { name: vwName.trim(), ...(vwEndpoint.trim() ? { endpoint: vwEndpoint.trim() } : {}), ...(vwEdit && vwRotate ? { rotate: true } : {}) };
      const res = vwEdit ? await hubApi.updateVoidWarden(vwEdit.id, body) : await hubApi.addVoidWarden(body);
      if (res.token) setIssued({ name: res.connection.name, token: res.token });
      setMessage({ ok: true, text: vwEdit ? "Verbindung gespeichert." : "Verbindung angelegt." });
      setVwEdit(null);
      setVwName("");
      setVwEndpoint("");
      setVwRotate(false);
      await reload();
    });

  const editVoidWarden = (c: VoidWardenConnection) => {
    setIssued(null);
    setVwEdit(c);
    setVwName(c.name);
    setVwEndpoint(c.endpoint ?? "");
    setVwRotate(false);
  };

  const saveEndpoint = () =>
    run(async () => {
      const models = epModels.split(",").map((m) => m.trim()).filter((m) => m.length > 0);
      const key: { apiKey?: string | null } = epDropKey ? { apiKey: null } : epKey.trim() ? { apiKey: epKey.trim() } : {};
      const body = { name: epName.trim(), kind: epKind, baseUrl: epUrl.trim(), models, ...key };
      await (epEdit ? hubApi.updateEndpoint(epEdit.id, body) : hubApi.addEndpoint(body));
      setMessage({ ok: true, text: epEdit ? "Endpoint gespeichert." : "Endpoint angelegt." });
      setEpEdit(null);
      setEpName("");
      setEpKind("llm");
      setEpUrl("");
      setEpKey("");
      setEpDropKey(false);
      setEpModels("");
      await reload();
    });

  const editEndpoint = (e: EndpointEntry) => {
    setIssued(null);
    setEpEdit(e);
    setEpName(e.name);
    setEpKind(e.kind);
    setEpUrl(e.baseUrl);
    setEpKey("");
    setEpDropKey(false);
    setEpModels(e.models.join(", "));
  };

  const probe = (e: EndpointEntry) =>
    run(async () => {
      const res = await hubApi.probeEndpoint(e.id);
      setEndpoints((prev) => (prev ? prev.map((x) => (x.id === e.id ? res.endpoint : x)) : prev));
      setMessage(res.endpoint.probe?.ok ? { ok: true, text: `„${e.name}“ antwortet (HTTP ${res.endpoint.probe.httpStatus}).` } : { ok: false, text: `„${e.name}“ nicht erreichbar.` });
    });

  return (
    <SettingsSection title="Verbindungen" testid="connections-settings">
      <div class="dim settings-intro">VoidWarden-Instanzen (Handy-Kiosk, ESP32-Board) und Modell-/Tool-Endpoints mit eigenem Schlüssel — alles bleibt über Neuladen hinweg gespeichert.</div>

      <div class="connection-group" role="group" aria-label="VoidWarden-Instanzen">
        <strong class="connection-group-title">VoidWarden-Instanzen</strong>
        {(voidwarden ?? []).map((c) => {
          const st = vwStatus(c);
          return (
            <div key={c.id} class="connection-entry">
              <div class="connection-entry-head">
                <span class="connection-name">{c.name}</span>
                <span class={st.ok ? "connection-status ok" : "connection-status dim"}>{st.text}</span>
              </div>
              {c.endpoint && <div class="mono dim connection-url">{c.endpoint}</div>}
              <div class="row connection-actions">
                <Button disabled={busy} onClick={() => editVoidWarden(c)}>
                  Bearbeiten
                </Button>
                <Button disabled={busy} aria-label={`${c.name} löschen`} onClick={() => void run(async () => (await hubApi.removeVoidWarden(c.id), setMessage({ ok: true, text: "Verbindung gelöscht, Token zurückgezogen." }), reload()))} variant="danger">
                  Löschen
                </Button>
              </div>
            </div>
          );
        })}
        {voidwarden !== null && voidwarden.length === 0 && <div class="dim">Noch keine Instanz eingetragen.</div>}

        <label>
          Name
          <input value={vwName} onInput={(e) => setVwName((e.target as HTMLInputElement).value)} placeholder="Nyx Board" />
        </label>
        <label>
          Endpunkt (optional)
          <input value={vwEndpoint} onInput={(e) => setVwEndpoint((e.target as HTMLInputElement).value)} placeholder="http://pixel:8080" inputMode="url" autocapitalize="off" spellcheck={false} />
        </label>
        {vwEdit && (
          <label class="row" style="gap: 8px">
            <input type="checkbox" checked={vwRotate} onChange={(e) => setVwRotate((e.target as HTMLInputElement).checked)} />
            Token ersetzen (altes wird ungültig)
          </label>
        )}
        <div class="row" style="gap: 8px">
          <Button disabled={busy || !vwName.trim()} onClick={() => void saveVoidWarden()} variant="primary">
            {vwEdit ? "Ändern" : "Verbindung anlegen"}
          </Button>
          {vwEdit && (
            <Button onClick={() => (setVwEdit(null), setVwName(""), setVwEndpoint(""), setVwRotate(false))}>
              Abbrechen
            </Button>
          )}
        </div>

        {issued && (
          <div class="connection-token">
            <div class="connection-token-title">Token für „{issued.name}“ — einmalig sichtbar</div>
            <div class="mono connection-token-value">{issued.token}</div>
            <div class="dim">Jetzt nach VoidWarden kopieren; der Hub zeigt es nie wieder.</div>
            <Button onClick={() => copyToken(issued.token)}>
              Kopieren
            </Button>
          </div>
        )}
      </div>

      <div class="connection-group" role="group" aria-label="Modell- und Tool-Endpoints">
        <strong class="connection-group-title">Modell- &amp; Tool-Endpoints</strong>
        {(endpoints ?? []).map((e) => {
          const st = endpointStatus(e);
          return (
            <div key={e.id} class="connection-entry">
              <div class="connection-entry-head">
                <span class="connection-name">
                  {e.name} <span class="dim">· {KIND_LABEL[e.kind]}</span>
                </span>
                <span class={st.ok === null ? "connection-status dim" : st.ok ? "connection-status ok" : "connection-status err"}>{st.text}</span>
              </div>
              <div class="mono dim connection-url">{e.baseUrl}</div>
              <div class="dim connection-models">
                {e.models.length > 0 ? e.models.join(", ") : "keine Modelle aktiviert"}
                {e.hasKey ? " · Schlüssel hinterlegt ✓" : ""}
              </div>
              <div class="row connection-actions">
                <Button disabled={busy} onClick={() => void probe(e)}>
                  Prüfen
                </Button>
                <Button disabled={busy} onClick={() => editEndpoint(e)}>
                  Bearbeiten
                </Button>
                <Button disabled={busy} aria-label={`${e.name} löschen`} onClick={() => void run(async () => (await hubApi.removeEndpoint(e.id), setMessage({ ok: true, text: "Endpoint gelöscht." }), reload()))} variant="danger">
                  Löschen
                </Button>
              </div>
            </div>
          );
        })}
        {endpoints !== null && endpoints.length === 0 && <div class="dim">Noch kein Endpoint eingetragen.</div>}

        <label>
          Name
          <input value={epName} onInput={(e) => setEpName((e.target as HTMLInputElement).value)} placeholder="Gpubox" />
        </label>
        <label>
          Typ
          <select value={epKind} onChange={(e) => setEpKind((e.target as HTMLSelectElement).value as EndpointKind)}>
            <option value="llm">LLM</option>
            <option value="image">Bilderkennung</option>
            <option value="video">Videoerkennung</option>
            <option value="other">Sonstiges</option>
          </select>
        </label>
        <label>
          Endpunkt-URL
          <input value={epUrl} onInput={(e) => setEpUrl((e.target as HTMLInputElement).value)} placeholder="http://100.64.0.10:8100/v1" inputMode="url" autocapitalize="off" spellcheck={false} />
        </label>
        <label>
          API-Key {epEdit ? "(leer lassen = unverändert)" : "(optional)"}
          <input type="password" value={epKey} onInput={(e) => setEpKey((e.target as HTMLInputElement).value)} placeholder={epEdit?.hasKey ? "neuen Key eingeben, um ihn zu ersetzen" : "sk-…"} autocomplete="off" />
        </label>
        {epEdit?.hasKey && (
          <label class="row" style="gap: 8px">
            <input type="checkbox" checked={epDropKey} onChange={(e) => setEpDropKey((e.target as HTMLInputElement).checked)} />
            Schlüssel entfernen
          </label>
        )}
        <label>
          Aktivierte Modelle (Komma-getrennt)
          <input value={epModels} onInput={(e) => setEpModels((e.target as HTMLInputElement).value)} placeholder="halogen-qwen, halogen-vision" autocapitalize="off" autocorrect="off" spellcheck={false} />
        </label>
        <div class="row" style="gap: 8px">
          <Button disabled={busy || !epName.trim() || !epUrl.trim()} onClick={() => void saveEndpoint()} variant="primary">
            {epEdit ? "Ändern" : "Endpoint anlegen"}
          </Button>
          {epEdit && (
            <Button onClick={() => (setEpEdit(null), setEpName(""), setEpKind("llm"), setEpUrl(""), setEpKey(""), setEpDropKey(false), setEpModels(""))}>
              Abbrechen
            </Button>
          )}
        </div>
        <div class="dim settings-intro">Der Hub speichert vom Schlüssel nur einen Hash — „Prüfen“ fragt nur Erreichbarkeit ab, ohne Schlüssel zu senden.</div>
      </div>

      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"}>{message.text}</div>}
    </SettingsSection>
  );
}
