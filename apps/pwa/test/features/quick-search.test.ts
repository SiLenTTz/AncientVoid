import { describe, expect, it } from "vitest";
import { quickMatches, type QuickSources } from "../../src/features/commands/quick.ts";

const src: QuickSources = {
  sessions: [
    { id: "s1", title: "Login reparieren", project: "/repos/alpha" },
    { id: "s2", title: null, project: "/repos/beta", hostId: "h2" },
    { id: "s3", title: "Alte Login-Arbeit", project: "/repos/alpha", archived: true },
  ],
  projects: [
    { path: "/repos/alpha", name: "alpha" },
    { path: "/repos/beta", name: "beta" },
  ],
  here: { sessionId: "s1", hostId: null },
};

describe("quickMatches (EPIC-P43 T43.6)", () => {
  it("ohne Eingabe gibt es nichts zu springen", () => {
    expect(quickMatches("  ", src)).toEqual([]);
  });

  it("Reihenfolge: Sessions, Projekte, Dateien, Werkzeuge, Befehle; Archiviertes nicht", () => {
    const kinds = quickMatches("log", src).map((m) => `${m.kind}:${m.label}`);
    expect(kinds).toEqual(["session:Login reparieren", "datei:„log“ in den Dateien suchen"]);
  });

  it("Session ohne Titel heißt nach dem Projekt und trägt ihren Host", () => {
    const hit = quickMatches("beta", src).find((m) => m.kind === "session");
    expect(hit).toMatchObject({ label: "beta", target: { kind: "session", sessionId: "s2", hostId: "h2" } });
    expect(quickMatches("beta", src).some((m) => m.kind === "projekt" && m.target.kind === "projekt" && m.target.path === "/repos/beta")).toBe(true);
  });

  it("Wortanfang vor Teilstring, Groß/klein egal", () => {
    expect(quickMatches("EIN", src).filter((m) => m.kind === "werkzeug").map((m) => m.label)).toEqual(["Einstellungen"]);
    expect(quickMatches("sess", src).filter((m) => m.kind === "werkzeug").map((m) => m.label)).toEqual(["Neue Session"]);
  });

  it("„Entdeckt“ bleibt im Befehlsfeld und springt auf den Übersichtszustand (EPIC-P47 §3.4)", () => {
    const hit = quickMatches("entdeckt", src).find((m) => m.kind === "werkzeug");
    expect(hit).toMatchObject({ label: "Entdeckt", target: { kind: "werkzeug", page: "dashboard", hash: "#/gefunden" } });
  });

  it("Befehle tragen ihren Text ohne Platzhalter ein", () => {
    const cmd = quickMatches("antworte", src).find((m) => m.kind === "befehl");
    expect(cmd?.target).toEqual({ kind: "befehl", text: "Antworte dort: " });
  });

  it("Dateien nur mit offener Session und ab zwei Zeichen", () => {
    expect(quickMatches("a", src).some((m) => m.kind === "datei")).toBe(false);
    expect(quickMatches("alpha", { ...src, here: null }).some((m) => m.kind === "datei")).toBe(false);
  });
});

it("P43.5 sources and factual status notes are separate jump targets", () => {
  const matches = quickMatches("Prüfung", { ...src, sourceRefs: [{ label: "Prüfung README.md", excerpt: "Befund", hash: "/sessions/s1/datei/README.md" }], notes: [{ sessionId: "s1", hostId: null, text: "Prüfung erfolgreich" }] });
  expect(matches[0]?.target).toEqual({ kind: "quelle", hash: "/sessions/s1/datei/README.md" });
  expect(matches[1]?.target).toEqual({ kind: "statusnotiz", sessionId: "s1", hostId: null });
});
