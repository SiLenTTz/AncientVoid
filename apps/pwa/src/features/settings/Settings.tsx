import { useEffect, useState } from "preact/hooks";
import { hubApi, getToken } from "../../shared/api.ts";
import { applyTheme, getTheme, type Theme } from "../../app/theme.ts";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

export function Settings({ onSwitchToken }: { onSwitchToken: () => void }) {
  const [theme, setThemeState] = useState<Theme>(getTheme());
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

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setThemeState(next);
  };

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
    <div class="card form-grid">
      <div class="settings-row">
        <span>Erscheinungsbild</span>
        <button class="btn" onClick={toggleTheme}>
          {theme === "dark" ? "☾ Dunkel" : "☀ Hell"}
        </button>
      </div>
      <div class="settings-row">
        <span>Erreichbar über</span>
        <span class="mono dim">{location.host}</span>
      </div>
      <div class="settings-row">
        <span>Geräte-Token</span>
        <span class="dim">{getToken() ? "•••• aktiv" : "kein Token"}</span>
      </div>
      <div class="settings-row">
        <span>Projekt-Wurzeln</span>
        <span class="dim">{projectCount === null ? "n/a" : `${projectCount} Projekte gefunden`}</span>
      </div>
      <div class="settings-row">
        <span>Passkey (für destruktive Freigaben, T2.5)</span>
        {passkey === undefined ? (
          <span class="dim">nicht konfiguriert</span>
        ) : passkey === true ? (
          <span class="dim">✓ registriert</span>
        ) : (
          <button
            class={passkeyBusy ? "btn busy" : "btn"}
            aria-busy={passkeyBusy}
            onClick={registerPasskey}
            disabled={passkeyBusy}
          >
            {passkeyBusy ? "lädt…" : "Passkey registrieren"}
          </button>
        )}
      </div>
      {passkeyError && <div style="color: var(--err); font-size: 12px">{passkeyError}</div>}
      <button class="btn" onClick={onSwitchToken}>
        Geräte-Token wechseln
      </button>
    </div>
  );
}
