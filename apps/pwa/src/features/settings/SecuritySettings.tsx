import { useEffect, useState } from "preact/hooks";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { hubApi, getToken } from "../../shared/api.ts";
import { SettingRow, SettingsSection } from "./parts.tsx";

/** Gruppe „Sicherheit & Verbindung“: Passkey, Geräte-Token, Adresse, Projekte. */
export function SecuritySettings({ onSwitchToken }: { onSwitchToken: () => void }) {
  const [projectCount, setProjectCount] = useState<number | null>(null);
  // T2.5: null = unknown/loading, undefined = webauthn not configured on
  // this hub (501) — kept distinct from "false" (configured, not
  // registered yet) so the row can say the right thing in each case.
  const [passkey, setPasskey] = useState<boolean | null | undefined>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");

  useEffect(() => {
    let alive = true;
    hubApi
      .projects()
      .then((res) => {
        if (alive) setProjectCount(res.projects.length);
      })
      .catch(() => {
        if (alive) setProjectCount(null);
      });
    hubApi
      .webauthnStatus()
      .then((res) => alive && setPasskey(res.registered))
      .catch(() => alive && setPasskey(undefined));
    return () => {
      alive = false;
    };
  }, []);

  const registerPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyError("");
    try {
      const options = (await hubApi.webauthnRegisterOptions()) as PublicKeyCredentialCreationOptionsJSON;
      const attestation = await startRegistration({ optionsJSON: options });
      const result = await hubApi.webauthnRegisterVerify(attestation);
      setPasskey(result.ok);
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : "Passkey-Registrierung fehlgeschlagen");
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <SettingsSection title="Sicherheit & Verbindung">
      <SettingRow label="Passkey" hint="für destruktive Freigaben (T2.5)">
        {passkey === undefined ? (
          <span class="dim">nicht konfiguriert</span>
        ) : passkey === true ? (
          <span class="dim">✓ registriert</span>
        ) : (
          <button class={passkeyBusy ? "btn busy" : "btn"} aria-busy={passkeyBusy} onClick={registerPasskey} disabled={passkeyBusy}>
            {passkeyBusy ? "lädt…" : "Passkey registrieren"}
          </button>
        )}
      </SettingRow>
      {passkeyError && <div class="reply-error">{passkeyError}</div>}
      <SettingRow label="Geräte-Token">
        <span class="dim">{getToken() ? "•••• aktiv" : "kein Token"}</span>
        <button class="btn" onClick={onSwitchToken}>
          Geräte-Token wechseln
        </button>
      </SettingRow>
      <SettingRow label="Erreichbar über">
        <span class="mono dim">{location.host}</span>
      </SettingRow>
      <SettingRow label="Projekt-Wurzeln">
        <span class="dim">{projectCount === null ? "n/a" : `${projectCount} Projekte gefunden`}</span>
      </SettingRow>
    </SettingsSection>
  );
}
