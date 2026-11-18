import { useEffect, useState } from "preact/hooks";
import { SettingRow, SettingsSection } from "./parts.tsx";
import { Segmented, Select } from "../../shared/forms.tsx";
import { hubApi, type MainSyncSettingsDto } from "../../shared/api.ts";
import { Button } from "../../shared/ui/index.ts";

/**
 * EPIC-P67 T67.7 / ADR-0088: „Main-Synchronisation“ — globale Einstellungen
 * plus Überschreibungen je Projekt. Speichert komplett (PUT), lädt vom Hub;
 * fehlende Einträge gelten dort als Defaults (K7). Die Erklärtexte nennen
 * ausdrücklich, was NICHT passiert: kein Rebase, kein Push, kein Eingriff
 * in laufende Züge.
 */

type Override = Partial<Omit<MainSyncSettingsDto, "onlyWhenIdle">>;

interface State {
  global: MainSyncSettingsDto;
  projects: Record<string, Override>;
}

const INTERVALS = [0, 5, 15, 60, 240, 1440];
const TIMEOUTS = [2, 5, 10, 30, 60];

function numberOptions(values: readonly number[], current: number, label: (v: number) => string): readonly { value: string; label: string }[] {
  const all = values.includes(current) ? [...values] : [...values, current].sort((a, b) => a - b);
  return all.map((v) => ({ value: String(v), label: label(v) }));
}

export function MainSyncSettings() {
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<{ path: string; name: string }[]>([]);
  const [addPath, setAddPath] = useState("");

  useEffect(() => {
    hubApi
      .mainSyncSettings()
      .then((s) => setState({ global: s.global.value, projects: s.projects.value }))
      .catch(() => setState(null));
    hubApi
      .projects()
      .then((p) => setProjects(p.projects.filter((x) => x.isGit !== false).map((x) => ({ path: x.path, name: x.name }))))
      .catch(() => setProjects([]));
  }, []);

  const save = async (next: State) => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await hubApi.saveMainSyncSettings({ global: { ...next.global, onlyWhenIdle: true }, projects: next.projects });
      setState({ global: saved.global.value, projects: saved.projects.value });
      setMessage({ ok: true, text: "Gespeichert." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Speichern fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  };

  if (state === null) {
    return (
      <SettingsSection title="Main-Synchronisation" testid="main-sync-settings">
        <div class="dim">Einstellungen nicht erreichbar.</div>
      </SettingsSection>
    );
  }

  const g = state.global;
  const patchGlobal = (patch: Partial<MainSyncSettingsDto>) => setState({ ...state, global: { ...g, ...patch } });
  const patchOverride = (path: string, patch: Override) => setState({ ...state, projects: { ...state.projects, [path]: { ...(state.projects[path] ?? {}), ...patch } } });
  const removeOverride = (path: string) => {
    const next = { ...state.projects };
    delete next[path];
    setState({ ...state, projects: next });
  };
  const addOverride = () => {
    const path = addPath.trim();
    if (!path || state.projects[path]) return;
    setState({ ...state, projects: { ...state.projects, [path]: {} } });
    setAddPath("");
  };

  const overriddenPaths = Object.keys(state.projects);
  const candidates = projects.filter((p) => !state.projects[p.path]);

  return (
    <SettingsSection title="Main-Synchronisation" testid="main-sync-settings">
      <div class="dim settings-intro">
        Neue Sessions starten auf dem aktuellen Hauptbranch (origin), laufende Sessions werden im Takt geprüft. Nicht passieren: kein Rebase, kein Push nach main, kein Merge in laufende Züge — gemergt wird nur in wartende Sessions.
      </div>

      <SettingRow label="Neue Sessions starten auf" hint="Nur wenn der Projektordner auf dem Hauptbranch steht — sonst bleibt der lokale Stand.">
        <Segmented
          label="Neue Sessions starten auf"
          value={g.startSync}
          options={[
            { value: "fetch-base", label: "origin/Hauptbranch" },
            { value: "off", label: "lokaler Stand" },
          ]}
          onChange={(v) => patchGlobal({ startSync: v })}
        />
      </SettingRow>

      <SettingRow label="Fetch-Zeitlimit" hint="Harte Grenze — danach startet die Session auf dem lokalen Stand (mit Meldung).">
        <Select
          label="Fetch-Zeitlimit"
          value={String(g.fetchTimeoutSec)}
          options={numberOptions(TIMEOUTS, g.fetchTimeoutSec, (v) => `${v} s`)}
          onChange={(v) => patchGlobal({ fetchTimeoutSec: Number(v) })}
        />
      </SettingRow>

      <SettingRow label="Hauptbranch" hint="Leer = origin/HEAD, wie vom Remote angekündigt.">
        <input
          data-testid="main-sync-default-branch"
          value={g.defaultBranch}
          placeholder="origin/HEAD"
          onInput={(e) => patchGlobal({ defaultBranch: (e.target as HTMLInputElement).value })}
          autocapitalize="off"
          spellcheck={false}
        />
      </SettingRow>

      <SettingRow label="Prüfen alle" hint="Rückstand melden, fragen oder selbst mergen — nur bei wartenden Sessions.">
        <Select
          label="Prüfen alle"
          value={String(g.checkIntervalMin)}
          options={numberOptions(INTERVALS, g.checkIntervalMin, (v) => (v === 0 ? "aus" : v >= 60 ? `${v / 60} h` : `${v} min`))}
          onChange={(v) => patchGlobal({ checkIntervalMin: Number(v) })}
        />
      </SettingRow>

      <SettingRow label="Bei Rückstand">
        <Segmented
          label="Bei Rückstand"
          value={g.behindAction}
          options={[
            { value: "notify", label: "melden" },
            { value: "ask", label: "fragen" },
            { value: "auto", label: "automatisch" },
          ]}
          onChange={(v) => patchGlobal({ behindAction: v })}
        />
      </SettingRow>

      <SettingRow label="Automatisch mergen" hint="„sauber“ prüft den Merge vorher (Probelauf) und lässt Konflikte liegen.">
        <Segmented
          label="Automatisch mergen"
          value={g.autoMerge}
          options={[
            { value: "off", label: "nie" },
            { value: "clean-only", label: "nur sauber" },
            { value: "ask", label: "fragen" },
          ]}
          onChange={(v) => patchGlobal({ autoMerge: v })}
        />
      </SettingRow>

      <SettingRow label="Nur bei wartenden Sessions">
        <span class="dim">immer aktiv — ein Merge läuft nie in einen laufenden Zug.</span>
      </SettingRow>

      <div class="settings-subhead" role="heading" aria-level={4}>
        Projekt-Überschreibungen
      </div>
      {overriddenPaths.length === 0 && <div class="dim">Keine — alle Projekte folgen den globalen Werten.</div>}
      {overriddenPaths.map((path) => (
        <div key={path} class="mainsync-override" data-testid="main-sync-override">
          <div class="row" style="justify-content: space-between; align-items: baseline">
            <strong>{path}</strong>
            <Button onClick={() => removeOverride(path)} disabled={busy}>
              Entfernen
            </Button>
          </div>
          <SettingRow label="Neue Sessions starten auf">
            <Select
              label={`Neue Sessions (${path})`}
              value={state.projects[path]?.startSync ?? "inherit"}
              options={[
                { value: "inherit", label: "wie global" },
                { value: "fetch-base", label: "origin/Hauptbranch" },
                { value: "off", label: "lokaler Stand" },
              ]}
              onChange={(v) => patchOverride(path, v === "inherit" ? { startSync: undefined } : { startSync: v })}
            />
          </SettingRow>
          <SettingRow label="Prüfen alle">
            <Select
              label={`Prüfen alle (${path})`}
              value={state.projects[path]?.checkIntervalMin !== undefined ? String(state.projects[path]?.checkIntervalMin) : "inherit"}
              options={[
                { value: "inherit", label: "wie global" },
                ...numberOptions(INTERVALS, state.projects[path]?.checkIntervalMin ?? 60, (v) => (v === 0 ? "aus" : v >= 60 ? `${v / 60} h` : `${v} min`)),
              ]}
              onChange={(v) => patchOverride(path, v === "inherit" ? { checkIntervalMin: undefined } : { checkIntervalMin: Number(v) })}
            />
          </SettingRow>
        </div>
      ))}
      {candidates.length > 0 && (
        <div class="row" style="gap: 8px">
          <Select label="Projekt hinzufügen" value={addPath} hideLabel options={[{ value: "", label: "Projekt wählen…" }, ...candidates.map((p) => ({ value: p.path, label: p.name }))]} onChange={setAddPath} />
          <Button onClick={() => addOverride()} disabled={busy || addPath === ""}>
            Übernehmen
          </Button>
        </div>
      )}

      <div class="row" style="gap: 8px; align-items: center">
        <Button variant="primary" disabled={busy} onClick={() => void save(state)} class={busy ? "busy" : undefined}>
          Speichern
        </Button>
        {message && <span class={message.ok ? "gemini-state ok" : "gemini-state dim"}>{message.text}</span>}
      </div>
    </SettingsSection>
  );
}
