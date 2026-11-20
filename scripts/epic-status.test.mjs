import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyEpicText, scanEpicsDir, renderTree, renderJson, checkFindings } from "./epic-status.mjs";

// Die Erkennungsregeln selbst sind getestet: Jede Regel findet ihr gepflanztes
// Fixture, bekannte Fallen (DoD-Prosa „kein TODO ohne …“, Negation hinter „ · “,
// delegierte Checkboxen, Retro-Emojis geschlossener Epics) lösen nichts aus.
// Verschwindet eine Regel, schlägt ihr positiver Fall (Rot-vorhanden-Gate).

const rule = (reasons) => reasons.map((r) => r.rule);

describe("epic-status — Statuszeile (S1/S2)", () => {
  const cases = [
    ["Code abgeschlossen, Geräteabnahme offen (T35.10) — Rückstufung · **Phase:** P0", "S1"],
    ["abgeschlossen 2026-10-27, Roll-out teilweise · **Phase:** P20", "S1"],
    ["Code abgeschlossen bis auf die Entscheidung in ADR-0034 (2026-10-09) · **Phase:** P15", "S1"],
    ["Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P30", "S2"],
    ["in Umsetzung — T29.1–T29.7 abgeschlossen (07.11.2026) · **Phase:** P29", "S2"],
    ["Umsetzung (Branch `feat/p42`) · **Phase:** P42", "S2"],
    ["Gebaut (2026-10-28): Contract, Connectors. · **Phase:** P19", "S2"],
    ["offen · **Phase:** P47", "S1"],
  ];
  for (const [status, expected] of cases) {
    it(`offen bei „${status.slice(0, 40)}…“ über ${expected}`, () => {
      const r = classifyEpicText(`# EPIC-Px\n\n**Status:** ${status}\n`);
      expect(r.open).toBe(true);
      expect(rule(r.reasons)).toContain(expected);
    });
  }

  const closed = [
    "abgeschlossen (2026-09-24, Retro unten) · **Phase:** P7",
    "Code abgeschlossen 2026-10-28; Live-Abnahme am Handy → EPIC-P35 T35.16 · **Phase:** P22",
    "umgesetzt 2026-11-08 (T36.1–T36.6, Gate grün; Live-Journey → Endabnahme-Block T35.16) · **Phase:** P36",
    "Exit grün (Closeout 2026-11-11: 11 🟢; Geräte-Reste geparkt) · **Phase:** P43",
    "Fertiggestellt 2026-11-10 — Evaluations-Exit No-go (Nutzerentscheid) · **Phase:** P45",
  ];
  for (const status of closed) {
    it(`abgeschlossen bei „${status.slice(0, 40)}…“`, () => {
      expect(classifyEpicText(`# EPIC-Px\n\n**Status:** ${status}\n`).open).toBe(false);
    });
  }

  it("Negation und Komposita zählen nicht: „fachlich keine offene“ hinter „ · “, „offenbar“, „offene“", () => {
    const text = "# EPIC-Px\n\n**Status:** abgeschlossen · **Abhängigkeit:** fachlich keine offene; offenbar keine offene Reste mehr\n";
    expect(classifyEpicText(text).open).toBe(false);
  });

  it("ohne Statuszeile entscheidet nur der Inhalt", () => {
    expect(classifyEpicText("# EPIC-Px\n\nalles erledigt, keine Marker\n").open).toBe(false);
  });
});

describe("epic-status — Inhaltsmarker (C1/C2)", () => {
  it("offene Checkbox zählt, erledigte nicht", () => {
    const text = "**Status:** abgeschlossen · **Phase:** P1\n\n- [x] T1 gebaut\n- [ ] T2 Rest\n  - [ ] T3 eingerückt\n";
    const r = classifyEpicText(text);
    expect(r.open).toBe(true);
    expect(rule(r.reasons)).toContain("C1");
    expect(r.counts.openCheckboxes).toBe(2);
    expect(r.counts.doneCheckboxes).toBe(1);
  });

  it("delegierte Checkboxen („verschoben nach“/„nach P<n>“) zählen nicht", () => {
    const text = "**Status:** abgeschlossen · **Phase:** P9\n\n- [ ] **T9.x.** → verschoben nach P12 T12.4\n- [ ] **T11.4.** → nicht umgesetzt, nach P12 (AI-P11-2)\n";
    const r = classifyEpicText(text);
    expect(r.open).toBe(false);
    expect(r.counts.delegatedCheckboxes).toBe(2);
  });

  it("Pfeil allein ist keine Delegation („Klick → Datei-Seite“ bleibt offen)", () => {
    const text = "**Status:** abgeschlossen · **Phase:** P47\n\n- [ ] **T47.2** Klick → Datei-Seite\n";
    expect(classifyEpicText(text).open).toBe(true);
  });

  it("„TODO:“ zählt, DoD-Prosa („kein TODO ohne Epic-Bezug“) nicht", () => {
    const offen = classifyEpicText("**Status:** abgeschlossen · **Phase:** P0\n\n- nächste Zeile: TODO: Router bauen\n");
    expect(offen.open).toBe(true);
    expect(rule(offen.reasons)).toContain("C2");
    const prose = classifyEpicText("**Status:** abgeschlossen · **Phase:** P14\n\n- Kein TODO ohne Epic-Referenz.\n");
    expect(prose.open).toBe(false);
  });

  it("Retro-Emojis (🟡 teilweise / 🔴) sind kein Offen-Marker — Historie geschlossener Epics", () => {
    const text = "**Status:** abgeschlossen (2026-09-24) · **Phase:** P7\n\nAC-P7-2: 🟡 teilweise\nAC-P7-3: 🔴 rot\n";
    expect(classifyEpicText(text).open).toBe(false);
  });
});

describe("epic-status — Verzeichnis, Baum und JSON", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "epic-status-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function fixture(name, content) {
    await writeFile(join(dir, name), content, "utf8");
  }

  it("scanEpicsDir: nur EPIC-P*.md werden gewertet, natürliche Sortierung", async () => {
    await fixture("README.md", "# Übersicht\n");
    await fixture("2026-09-12-PRD-x.md", "# PRD\n");
    await fixture("EPIC-P10-offen.md", "**Status:** offen · **Phase:** P10\n\n- [ ] T10.1 Rest\n");
    await fixture("EPIC-P1.5-zu.md", "**Status:** abgeschlossen · **Phase:** P1.5\n");
    await fixture("EPIC-P2-zu.md", "**Status:** umgesetzt (Gate grün) · **Phase:** P2\n");

    const entries = scanEpicsDir(dir);
    expect(entries.map((e) => e.file)).toEqual([
      "2026-09-12-PRD-x.md",
      "EPIC-P1.5-zu.md",
      "EPIC-P2-zu.md",
      "EPIC-P10-offen.md",
      "README.md",
    ]);
    const byName = Object.fromEntries(entries.map((e) => [e.file, e]));
    expect(byName["README.md"].epic).toBe(false);
    expect(byName["EPIC-P10-offen.md"]).toMatchObject({ epic: true, phase: "P10", open: true });
    expect(byName["EPIC-P1.5-zu.md"]).toMatchObject({ epic: true, phase: "P1.5", open: false });
  });

  it("EPIC-000-Sortierplatz wird als Epic gewertet und steht vor allen EPIC-P*", async () => {
    await fixture("EPIC-000-testsuite-fuer-menschen.md", "**Status:** offen · **Phase:** P000\n\n- [ ] T000.1 Rest\n");
    await fixture("EPIC-P0-hub.md", "**Status:** abgeschlossen · **Phase:** P0\n");
    const entries = scanEpicsDir(dir);
    expect(entries[0]).toMatchObject({ file: "EPIC-000-testsuite-fuer-menschen.md", epic: true, open: true });
  });

  it("renderTree: offen farbig (nur bei color), geschlossen unverändert, Legende dabei", async () => {
    await fixture("EPIC-P1-offen.md", "**Status:** offen · **Phase:** P1\n");
    await fixture("EPIC-P2-zu.md", "**Status:** abgeschlossen · **Phase:** P2\n");
    await fixture("README.md", "# x\n");
    const entries = scanEpicsDir(dir);

    const plain = renderTree(entries, false);
    expect(plain).not.toContain("\x1b[");
    expect(plain).toContain("EPIC-P1-offen.md");
    expect(plain).toContain("offen: Statustext nennt");
    expect(plain).toContain("abgeschlossen");
    expect(plain).toContain("Legende");

    const farbe = renderTree(entries, true);
    expect(farbe).toContain("\x1b[1;33mEPIC-P1-offen.md\x1b[0m");
    expect(farbe).toContain("\x1b[1;33mEPIC-P1-offen.md");
    // Geschlossene und Nicht-Epic-Dateien tragen keine Farbcodes im Namen.
    expect(farbe).not.toContain("\x1b[1;33mEPIC-P2-zu.md");
    expect(farbe).not.toContain("\x1b[1;33mREADME.md");
  });

  it("renderJson: Schema mit Zusammenfassung, Regeln und je Datei Grund", async () => {
    await fixture("EPIC-P1-offen.md", "**Status:** Planungsentwurf · **Phase:** P1\n\n- [ ] T1.1\n");
    const data = JSON.parse(renderJson(scanEpicsDir(dir)));
    expect(data.summary).toEqual({ total: 1, open: 1, closed: 0 });
    expect(Object.keys(data.rules)).toEqual(["S1", "S2", "C1", "C2"]);
    expect(data.files[0]).toMatchObject({ file: "EPIC-P1-offen.md", phase: "P1", open: true });
    expect(rule(data.files[0].reasons)).toEqual(["S2", "C1"]);
    expect(data.files[0].counts.openCheckboxes).toBe(1);
  });
});

describe("epic-status — echte epics/ des Repos (Struktur-Invarianten)", () => {
  const repoEpics = resolve(dirname(fileURLToPath(import.meta.url)), "..", "epics");

  it("jede EPIC-P*.md ist klassifiziert und beide Zustände kommen vor", () => {
    const entries = scanEpicsDir(repoEpics);
    const epics = entries.filter((e) => e.epic);
    expect(epics.length).toBeGreaterThan(20);
    expect(epics.every((e) => typeof e.open === "boolean" && Array.isArray(e.reasons)));
    expect(epics.some((e) => e.open)).toBe(true);
    expect(epics.some((e) => !e.open)).toBe(true);
    // Nicht-Epic-Dateien (PRD, README) bleiben ungewertet.
    expect(entries.some((e) => !e.epic)).toBe(true);
  });

describe("epic-status — --check: Statuszeile und Checkliste müssen zusammenpassen", () => {
  const entry = (text) => {
    const r = classifyEpicText("# EPIC-Px\n\n" + text);
    return { file: "EPIC-Px-test.md", epic: true, phase: "Px", ...r };
  };

  it("K1: durchgearbeitete Checkliste, aber Statustext ohne Abschluss — Drift", () => {
    const f = checkFindings([entry("**Status:** gebaut · **Phase:** Px\n\n- [x] T1\n- [x] T2\n")]);
    expect(f.map((x) => x.rule)).toEqual(["K1"]);
  });

  it("K2: Statustext schließt, aber offene Checkbox ohne Delegation — Drift", () => {
    const f = checkFindings([entry("**Status:** abgeschlossen · **Phase:** Px\n\n- [x] T1\n- [ ] T2\n")]);
    expect(f.map((x) => x.rule)).toEqual(["K2"]);
  });

  it("keine Drift: Abschluss mit nur delegierten Punkten; Planung/Entscheidung/On hold mit offenen Punkten", () => {
    const ok = [
      entry("**Status:** abgeschlossen · **Phase:** Px\n\n- [x] T1\n- [ ] T2 nach P000 verschoben\n"),
      entry("**Status:** Planungsentwurf · **Phase:** Px\n\n- [x] T1 geplant\n- [ ] T2\n"),
      entry("**Status:** offen, Entscheidung steht aus · **Phase:** Px\n\n- [x] T1\n"),
      entry("**Status:** On hold (Nutzerentscheid) · **Phase:** Px\n\n- [ ] T1\n"),
      entry("**Status:** in Umsetzung (Grundlage T1, 15.11.2026) · **Phase:** Px\n\n- [x] T1\n- [x] T2\n"),
      entry("**Status:** abgeschlossen · **Phase:** Px\n"), // ohne Checkboxen entscheidet nichts
    ];
    expect(checkFindings(ok)).toEqual([]);
  });

  it("Der echte Datenbaum ist driftfrei — sonst ist die Status-Synchronisation fällig.", () => {
    expect(checkFindings(scanEpicsDir(resolve(dirname(fileURLToPath(import.meta.url)), "..", "epics")))).toEqual([]);
  });
});

  it("Baum und JSON stimmen für die echte Struktur überein", () => {
    const entries = scanEpicsDir(repoEpics);
    const data = JSON.parse(renderJson(entries));
    const openCount = entries.filter((e) => e.epic && e.open).length;
    expect(data.summary.total).toBe(entries.filter((e) => e.epic).length);
    expect(data.summary.open).toBe(openCount);
    expect(renderTree(entries, false)).toContain("Legende");
  });
});
