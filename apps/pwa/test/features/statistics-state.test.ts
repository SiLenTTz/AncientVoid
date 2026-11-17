import { describe, expect, it } from "vitest";
import { parseStatistikState } from "../../src/features/statistics/StatisticsPage.tsx";

/**
 * EPIC-P66 T66.1/T66.3 (Premortem 2): der Dauerstand aus localStorage ist
 * fail-safe — defektes JSON, alte Formen und Müllwerte fallen auf Defaults
 * zurück, statt die Seite zu crashen (K10).
 */
describe("Statistik-Dauerstand (EPIC-P66)", () => {
  it("liest Schnitt und Klappzustände", () => {
    const state = parseStatistikState(JSON.stringify({
      collapsed: { sessions: true, vergleich: false },
      filter: { period: "30d", project: "/repo", host: "h", harness: "cli" },
    }));
    expect(state.collapsed).toEqual({ sessions: true, vergleich: false });
    expect(state.filter).toEqual({ period: "30d", project: "/repo", host: "h", harness: "cli" });
  });

  it("null und defektes JSON fallen auf Defaults zurück", () => {
    expect(parseStatistikState(null).filter).toEqual({ period: "all", project: "", host: "", harness: "" });
    expect(parseStatistikState("{definitiv kein json").collapsed).toEqual({});
  });

  it("unbekannte Zeitraum- und Nicht-String-Werte werden ignoriert, boolesche Klappwerte behalten", () => {
    const state = parseStatistikState(JSON.stringify({
      collapsed: { sessions: true, muell: "ja", zuege: 3 },
      filter: { period: "alles", project: 5, host: null, harness: "ide" },
    }));
    expect(state.collapsed).toEqual({ sessions: true });
    expect(state.filter).toEqual({ period: "all", project: "", host: "", harness: "ide" });
  });
});
