import { useEffect, useState } from "preact/hooks";
import { hubApi, type FleetPeer } from "../../shared/api.ts";
import { InviteQr, QrScanner } from "./InviteQr.tsx";
import { pairLink, parsePairLink } from "./pair-link.ts";
import { SettingRow, SettingsSection } from "../settings/parts.tsx";

/**
 * T6.2 / ADR-0017: pair this hub with others. On the other hub, create a
 * code; here, enter its address and the code. Tokens stay on the hubs.
 */
export function FleetSettings() {
  const [self, setSelf] = useState<string | null>(null);
  const [peers, setPeers] = useState<FleetPeer[] | null>(null);
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const reload = () =>
    hubApi
      .fleetPeers()
      .then(setPeers)
      .catch(() => setPeers([]));

  useEffect(() => {
    hubApi
      .fleetHello()
      .then((h) => setSelf(h.hostId))
      .catch(() => setSelf(null));
    void reload();
  }, []);

  const createInvite = async () => {
    try {
      setInvite(await hubApi.fleetInvite());
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Code fehlgeschlagen" });
    }
  };

  const addPeer = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const peer = await hubApi.fleetAddPeer(url.trim(), code.trim());
      setMessage({ ok: true, text: `Verbunden mit ${peer.hostId}.` });
      setUrl("");
      setCode("");
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Verbinden fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  const onScan = (text: string) => {
    setScanning(false);
    const link = parsePairLink(text);
    if (!link) {
      setMessage({ ok: false, text: "Das ist kein AncientVoid-Einladungscode." });
      return;
    }
    setUrl(link.url);
    setCode(link.code);
    setMessage({ ok: true, text: `Einladung von ${link.url} gelesen — jetzt verbinden.` });
  };

  const removePeer = async (hostId: string) => {
    try {
      await hubApi.fleetRemovePeer(hostId);
      setConfirmRemove(null);
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Entfernen fehlgeschlagen" });
    }
  };

  return (
    <SettingsSection title="Flotte" >
      <SettingRow label="Dieser Hub" hint="Name in der Flotte">
        <span class="mono dim" data-testid="fleet-self">{self ?? "…"}</span>
      </SettingRow>

      {peers && peers.length > 0 && (
        <div class="fleet-peers">
          {peers.map((p) => (
            <div key={p.hostId} class="setting-row" data-testid="fleet-peer">
              <span class="setting-label">
                <strong>{p.hostId}</strong> <span class="mono dim">{p.url}</span>
              </span>
              {confirmRemove === p.hostId ? (
                <span class="row setting-control" style="gap: 6px">
                  <button class="btn danger" type="button" onClick={() => void removePeer(p.hostId)}>
                    Wirklich entfernen
                  </button>
                  <button class="btn" type="button" onClick={() => setConfirmRemove(null)}>
                    Abbrechen
                  </button>
                </span>
              ) : (
                <span class="setting-control">
                  <button class="btn" type="button" onClick={() => setConfirmRemove(p.hostId)}>
                    Entfernen
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <button class="btn" type="button" onClick={() => { setMessage(null); setScanning((v) => !v); }}>
        {scanning ? "Kamera schließen" : "QR-Code scannen"}
      </button>
      {scanning && <QrScanner onResult={onScan} onClose={() => setScanning(false)} />}
      <label>
        Host hinzufügen — Adresse
        <input value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder="https://home-server.<tailnet>.ts.net" autocapitalize="off" autocorrect="off" spellcheck={false} />
      </label>
      <label>
        Einladungscode vom anderen Hub
        <input value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} placeholder="ABCD-EFGH-JKLM" autocapitalize="characters" autocorrect="off" spellcheck={false} />
      </label>
      <button class={busy ? "btn primary busy" : "btn primary"} type="button" disabled={busy || !url.trim() || !code.trim()} onClick={() => void addPeer()}>
        {busy ? "lädt…" : "Host verbinden"}
      </button>
      {message && <div class={message.ok ? "fleet-message ok" : "fleet-message reply-error"}>{message.text}</div>}

      <SettingRow label="Diesen Hub von einem anderen aus verbinden">
        <button class="btn" type="button" onClick={() => void createInvite()}>
          Einladungscode erzeugen
        </button>
      </SettingRow>
      {invite && (
        <div class="fleet-invite">
          <InviteQr text={pairLink(location.origin, invite.code)} />
          <code class="mono">{invite.code}</code>
          <span class="dim">
            einmalig, gültig bis {new Date(invite.expiresAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span class="dim fleet-invite-origin">
            Adresse im QR-Code: <span class="mono">{location.origin}</span>
            {/^https?:\/\/(localhost|127\.|\[::1\])/.test(location.origin) && " — nur auf diesem Rechner erreichbar; für den QR-Code den Hub über seine Tailnet-Adresse öffnen."}
          </span>
        </div>
      )}
    </SettingsSection>
  );
}
