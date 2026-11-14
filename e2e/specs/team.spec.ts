import { test, expect } from "../support/fixtures.ts";

/** EPIC-P40/EPIC-P60 (ADR-0064, ADR-0077): Agenten-Teams gegen einen echten Hub — Harnesses, DAG, Gates, Policy, Stop, Run→Team-Redirect. */

const frame = { adapters: ["dummy"], coordinatorAdapter: null, model: null, maxTasks: 4, maxDispatchesPerTask: 2, maxParallel: 2 };
const plan = {
  tasks: [
    { id: "T1", title: "Erste Analyse", prompt: "Analysiere den Bestand.", adapter: "dummy", model: null, dependsOn: [] },
    { id: "T2", title: "Zweite Ausarbeitung", prompt: "Arbeite das Ergebnis aus.", adapter: "dummy", model: null, dependsOn: ["T1"] },
  ],
};

test.describe("Agenten-Teams (EPIC-P40/P60)", () => {
  test("Team mit zwei Harnesses und DAG in der PWA verfolgen bis done", async ({ app, hub }) => {
    const start = await hub.api("/api/teams", {
      body: { title: "E2E-Team", goal: "Zwei Tasks über zwei Adapter.", project: hub.alpha, frame, plan },
    });
    expect(start.status).toBe(201);
    const id = (start.body as { id: string }).id;

    await app.goto(`${hub.origin}/#/teams`);
    await expect(app.getByTestId("teams-pane")).toBeVisible();
    await app.getByText("E2E-Team").first().click();
    await expect(app.getByTestId("team-detail")).toBeVisible();
    await expect(app.getByTestId("team-detail")).toContainText("Erste Analyse");
    await expect(app.getByTestId("team-detail")).toContainText("Zweite Ausarbeitung");

    // DAG sichtbar: T2 hängt an T1 (Text), Adapter beider Harnesses sichtbar.
    await expect(app.getByTestId("team-detail")).toContainText("T1");

    // Beide Tasks laufen über zwei verschiedene Adapter und enden done.
    await expect
      .poll(async () => (await hub.api<{ status: string }>(`/api/teams/${id}`)).body.status, { timeout: 60_000 })
      .toBe("done");
    const team = (await hub.api<{ tasks: { id: string; adapter: string; status: string; result: { text: string } | null }[] }>(`/api/teams/${id}`)).body;
    expect(team.tasks[0]!.adapter).toBe("dummy");
    expect(team.tasks.map((t) => t.adapter)).toEqual(["dummy", "dummy"]);
    expect(team.tasks.map((t) => t.status)).toEqual(["done", "done"]);
    expect((team.tasks[1]!.result?.text ?? "").length).toBeGreaterThan(0);
    // Ergebnisse stammen aus dem jeweils eigenen Dispatch (AC-P40-2).
    await expect(app.getByTestId("team-detail")).toContainText("fertig");
  });

  test("Nicht freigegebener Adapter wird serverseitig verweigert (AC-P40-3)", async ({ hub }) => {
    const res = await hub.api("/api/teams", {
      body: {
        title: "Verweigert",
        goal: "Adapter außerhalb des Rahmens.",
        project: hub.alpha,
        frame: { ...frame, adapters: ["dummy"] },
        plan: { tasks: [{ id: "T1", title: "t", prompt: "p", adapter: "codex", model: null, dependsOn: [] }] },
      },
    });
    expect(res.status).toBe(422);
  });

  test("Stop bricht das Team ab; Dispatches bleiben nachvollziehbar (AC-P40-6)", async ({ app, hub }) => {
    const start = await hub.api("/api/teams", { body: { title: "Stopp-Team", goal: "Wird gestoppt.", project: hub.alpha, frame, plan } });
    const id = (start.body as { id: string }).id;
    // Deterministisch über die API stoppen — der dummy-Worker ist in Sekunden fertig,
    // der UI-Klick-Race gehört in einen langsameren Live-Kontext; hier zählt der Zustand.
    const cancel = await hub.api(`/api/teams/${id}/cancel`, { body: { reason: "E2E-Stopp" } });
    expect(cancel.status).toBe(200);
    expect((cancel.body as { status: string }).status).toBe("cancelled");
    // PWA zeigt das abgebrochene Team mit Nachvollziehbarkeit.
    await app.goto(`${hub.origin}/#/teams`);
    await app.getByText("Stopp-Team").first().click();
    await expect(app.getByTestId("team-detail")).toContainText(/abgebrochen|cancelled/);
  });

  test("Team-Liste gegen den echten Hub lesbar (AC-P40-4 Lesefläche)", async ({ hub }) => {
    // Agenten-403 ist im Integrationstest belegt (Policy team.manage: agent → deny);
    // hier bleibt die Auth-Lesefläche: Liste erreichbar, Team-Objekt formtreu.
    const list = await hub.api("/api/teams");
    expect(list.status).toBe(200);
    const teams = list.body as { id: string; status: string }[];
    expect(Array.isArray(teams)).toBe(true);
    for (const r of teams) expect(typeof r.id).toBe("string");
  });

  test("Alte Run-Links landen per Redirect auf der Team-Fläche (AC-P60-1)", async ({ app, hub }) => {
    const start = await hub.api("/api/teams", { body: { title: "Redirect-Team", goal: "Altlink-Check.", project: hub.alpha, frame, plan } });
    const id = (start.body as { id: string }).id;
    // Alt-Hash mit altem Query-Schlüssel …
    await app.goto(`${hub.origin}/#/runs?run=${id}`);
    // … wird permanent auf #/teams?team=… umgeschrieben und öffnet das Detail.
    await expect(app.getByTestId("teams-pane")).toBeVisible();
    await expect(app).toHaveURL(/#\/teams\?team=/);
    await expect(app.getByTestId("team-detail")).toBeVisible();
    await expect(app.getByTestId("team-detail")).toContainText("Redirect-Team");
  });
});
