#!/usr/bin/env node
/**
 * README-Screenshots (EPIC-P53 T53.2): bootet einen Demo-Hub nach TestHub-
 * Muster — Dummy-Adapter und synthetische Stand-in-CLIs aus e2e/support/bin
 * in einem temporären Datenverzeichnis. Nichts erreicht Cloud-Provider,
 * ~/.claude, tmux oder den Hub des Nutzers; keine echten Sessions, keine
 * Secrets (Premortem P53-1: Login-Screenshot immer mit leerem Token-Feld).
 *
 * Voraussetzung: gebaute PWA (`npm -w @ancientvoid/pwa run build`).
 * Ausgabe: docs/assets/readme-*.webp — jeder Lauf überschreibt denselben Satz.
 */
import { chromium } from "playwright";
import { TestHub, repoRoot } from "../e2e/support/hub.ts";

const OUT = `${repoRoot}/docs/assets`;
const PHONE = { width: 412, height: 915 };
const DESKTOP = { width: 1280, height: 800 };

const hub = await TestHub.start();

// Kontext teilt Aussehen (de-DE, reduzierte Bewegung) mit dem E2E-Gate; SW
// blockiert, damit kein Cache-Stand fotografiert wird.
const browser = await chromium.launch();
const context = async (viewport, { isMobile = false } = {}) =>
  browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile,
    hasTouch: isMobile,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.webp`, quality: 88, type: "webp", fullPage: false });

// Klarer deutscher Titel auf der Karte (T8.6: POST /meta) — fail loud.
const rename = async (id, title) => {
  const res = await hub.api(`/api/sessions/${id}/meta`, { method: "POST", body: { title } });
  if (res.status !== 200) throw new Error(`rename ${id} -> ${res.status}`);
};

try {
  // --- Demo-Sessions: deutsche Titel, Stand-in-Inhalte, kein Geheimnis ---
  // läuft noch (LANGSAM hält den Zug 60 s offen) → Zustand „arbeitet“
  const running = await hub.createSession({ adapter: "claude", prompt: "Bitte LANGSAM: Migration der Datenbank vorbereiten" });
  // wartende Freigabe (WERKZEUG → Bash-Freigabe bleibt offen)
  const approval = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
  // offene Rückfrage (FRAGE → „Welche Farbe soll das Logo haben?“)
  const question = await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" });
  // abgeschlossener Dummy-Lauf (14 Events, dann Ende)
  const done = await hub.createSession({ adapter: "dummy", prompt: "Wochenbericht zusammenfassen" });
  await rename(running, "Migration der Datenbank vorbereiten");
  await rename(approval, "Tests ergänzen: Adapter-Matrix");
  await rename(question, "Logo-Entwurf finalisieren");
  await rename(done, "Wochenbericht zusammenfassen");

  // --- Handy: Anmeldung (leeres Feld — nie ein Token fotografieren) ---
  const phone = await (await context(PHONE, { isMobile: true })).newPage();
  await phone.goto(hub.origin);
  await phone.getByRole("heading", { name: "AncientVoid" }).waitFor();
  await shot(phone, "readme-login-412");

  // --- Handy: Übersicht (Warteschlange mit Zustandsgruppen) ---
  await phone.getByLabel("Device-Token").fill(hub.token);
  await phone.getByRole("button", { name: "Verbinden" }).click();
  await phone.getByRole("heading", { name: "AncientVoid", exact: true }).waitFor();
  // Die wartende Freigabe hält die Gruppe „Du bist dran“ garantiert offen (600 s Fenster).
  await phone.locator(".session-title").filter({ hasText: "Tests ergänzen: Adapter-Matrix" }).waitFor();
  await shot(phone, "readme-start-412");

  // --- Handy: Session-Chat mit laufendem Zug ---
  await phone.locator(".session-title").filter({ hasText: "Migration der Datenbank vorbereiten" }).click();
  await phone.getByRole("button", { name: "Chat" }).waitFor();
  await shot(phone, "readme-session-412");

  // --- Handy: Freigabe-Karte (Bash-Freigabe mit Laya-Einschätzung) ---
  await phone.goto(`${hub.origin}/#/sessions/${approval}`);
  await phone.reload(); // Hash-Wechsel allein rendert nicht neu — gleicher Karten-Stand wie im Spec
  await phone.getByRole("button", { name: "Chat" }).click();
  // T43-Zug-UI: Freigabe liegt im laufenden Zug (Bestätigung mit Erlauben/Ablehnen).
  await phone.getByRole("button", { name: "Erlauben" }).waitFor();
  await shot(phone, "readme-freigabe-412");
  await phone.context().close();

  // --- Desktop: Arbeitsfläche (Liste + Detail) ---
  const desktop = await (await context(DESKTOP)).newPage();
  await desktop.goto(hub.origin);
  await desktop.getByLabel("Device-Token").fill(hub.token);
  await desktop.getByRole("button", { name: "Verbinden" }).click();
  await desktop.getByRole("heading", { name: "AncientVoid", exact: true }).waitFor();
  await desktop.locator(".session-title").filter({ hasText: "Tests ergänzen: Adapter-Matrix" }).waitFor();
  await desktop.locator(".session-title").filter({ hasText: "Migration der Datenbank vorbereiten" }).click();
  await desktop.getByRole("button", { name: "Chat" }).first().waitFor().catch(() => {});
  await shot(desktop, "readme-desktop-1280");
  await desktop.context().close();

  console.log(`ok: 5 Screenshots -> ${OUT}/readme-*.webp`);
} finally {
  await browser.close();
  await hub.stop();
}
