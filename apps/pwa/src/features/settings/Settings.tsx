import { useEffect, useState } from "preact/hooks";
import { hubApi, getToken } from "../../shared/api.ts";
import { applyTheme, getTheme, type Theme } from "../../app/theme.ts";
import { applyPinchZoom, pinchZoomAllowed } from "../../app/zoom.ts";
import { applyCtxMotion, ctxMotionOn, getScale, setScale, SCALE_MAX, SCALE_MIN, SCALE_STEP } from "../../app/ui-scale.ts";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

export function Settings({ onSwitchToken }: { onSwitchToken: () => void }) {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [zoom, setZoomState] = useState<boolean>(pinchZoomAllowed());
  // EPIC-P20: the scale changes from the keyboard and wheel too — follow it.
  const [scale, setScaleState] = useState<number>(getScale());
  const [motion, setMotion] = useState<boolean>(ctxMotionOn());
  useEffect(() => {
    const on = (e: Event) => setScaleState((e as CustomEvent<number>).detail);
    window.addEventListener("ancientvoid:scale", on);
    return () => window.removeEventListener("ancientvoid:scale", on);
  }, []);
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

  const toggleZoom = () => {
    const next = !zoom;
    applyPinchZoom(next);
    setZoomState(next);
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
        <span>
          Zoom der Oberfläche
          <span class="dim settings-hint"> · Strg + Mausrad, Strg + / − , Strg + 0</span>
        </span>
        <span class="scale-control">
          <button class="btn" aria-label="Kleiner" disabled={scale <= SCALE_MIN} onClick={() => setScale(scale - SCALE_STEP)}>
            −
          </button>
          <span class="scale-value mono" aria-live="polite">
            {Math.round(scale * 100)} %
          </span>
          <button class="btn" aria-label="Größer" disabled={scale >= SCALE_MAX} onClick={() => setScale(scale + SCALE_STEP)}>
            +
          </button>
          <button class="btn" disabled={scale === 1} onClick={() => setScale(1)}>
            100 %
          </button>
        </span>
      </div>
      <div class="settings-row">
        <span>
          Schimmer der Kontextleiste
          <span class="dim settings-hint"> · folgt „Bewegung reduzieren“ des Systems</span>
        </span>
        <button
          class="btn"
          onClick={() => {
            applyCtxMotion(!motion);
            setMotion(!motion);
          }}
        >
          {motion ? "an" : "aus"}
        </button>
      </div>
      <div class="settings-row">
        <span>Pinch-Zoom (Feld-Zoom bleibt aus)</span>
        <button class="btn" onClick={toggleZoom}>
          {zoom ? "an" : "aus"}
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
