import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0212 (Kais Nachfrage, am laufenden Hub nachgemessen): whisper.cpp abgeschaltet —
 * `GET /api/stt` meldete trotzdem `available:true`, weil die Auskunft allein aus der
 * Konfiguration kommt. Die App hält dadurch an einem toten lokalen Weg fest, statt auf die
 * Browser-Erkennung umzuschalten. Diese Spec verlangt Ehrlichkeit vom Hub.
 *
 * Die Browser-Erkennung selbst ist im Harness nicht fahrbar (Chromium hat keine
 * Web-Speech-API) — deshalb prüft diese Spec die Entscheidungsvorlage (Hub-Auskunft), der
 * Umschaltmechanismus der App steht unitseitig in apps/pwa/test/stt-rueckfall.test.ts.
 */
test.describe("Diktat ohne eigene Erkennung (BUG-0212)", () => {
  test.use({ hubOptions: { sttUrl: "http://127.0.0.1:9/inference", sttStreamingUrl: "ws://127.0.0.1:9/realtime" } });

  test("der Hub behauptet keine Erkennung, die er nicht erreicht", async ({ hub }) => {
    const info = await hub.api<{ available: boolean; streaming: boolean; reason?: string }>("/api/stt");
    expect(JSON.stringify(info.body)).toBeTruthy();
    expect(info.body.available, `Hub meldet „verfügbar“, obwohl nichts läuft: ${JSON.stringify(info.body)}`).toBe(false);
    expect(info.body.streaming).toBe(false);
    expect(info.body.reason ?? "").toBeTruthy();
  });

  test("die Auskunft wird erneut geholt, wenn der Dienst wieder da ist (kurzes Gedächtnis)", async ({ hub }) => {
    const erster = await hub.api<{ available: boolean }>("/api/stt");
    expect(erster.body.available).toBe(false);
    // Zweiter Aufruf direkt hintereinander: gecacht, aber dieselbe ehrliche Antwort.
    const zweiter = await hub.api<{ available: boolean; checkedMsAgo?: number }>("/api/stt");
    expect(zweiter.body.available).toBe(false);
    expect(typeof zweiter.body.checkedMsAgo).toBe("number");
  });
});
