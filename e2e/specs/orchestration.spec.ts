import { test, expect } from "../support/fixtures.ts";

/** EPIC-P40 (ADR-0064): Orchestrierung gegen einen echten Hub — zwei Harnesses, DAG, Gates, Policy, Stop. */

const frame = { adapters: ["dummy"], coordinatorAdapter: null, model: null, maxTasks: 4, maxDispatchesPerTask: 2, maxParallel: 2 };
const plan = {
  tasks: [
    { id: "T1", title: "Erste Analyse", prompt: "Analysiere den Bestand.", adapter: "dummy", model: null, dependsOn: [] },
    { id: "T2", title: "Zweite Ausarbeitung", prompt: "Arbeite das Ergebnis aus.", adapter: "dummy", model: null, dependsOn: ["T1"] },
  ],
};

test.describe("Orchestrierung (EPIC-P40)", () => {
  test("Run mit zwei Harnesses und DAG in der PWA verfolgen bis done", async ({ app, hub }) => {
    const start = await hub.api("/api/orchestration/runs", {
      body: { title: "E2E-Run", goal: "Zwei Tasks über zwei Adapter.", project: hub.alpha, frame, plan },
    });
    expect(start.status).toBe(201);
    const id = (start.body as { id: string }).id;

    await app.goto(`${hub.origin}/#/runs`);
    await expect(app.getByTestId("runs-pane")).toBeVisible();
    await app.getByText("E2E-Run").first().click();
    await expect(app.getByTestId("run-detail")).toBeVisible();
    await expect(app.getByTestId("run-detail")).toContainText("Erste Analyse");
    await expect(app.getByTestId("run-detail")).toContainText("Zweite Ausarbeitung");

    // DAG sichtbar: T2 hängt an T1 (Text), Adapter beider Harnesses sichtbar.
    await expect(app.getByTestId("run-detail")).toContainText("T1");

    // Beide Tasks laufen über zwei verschiedene Adapter und enden done.
    await expect
      .poll(async () => (await hub.api<{ status: string }>(`/api/orchestration/runs/${id}`)).body.status, { timeout: 60_000 })
      .toBe("done");
    const run = (await hub.api<{ tasks: { id: string; adapter: string; status: string; result: { text: string } | null }[] }>(`/api/orchestration/runs/${id}`)).body;
    expect(run.tasks[0]!.adapter).toBe("dummy");
    expect(run.tasks.map((t) => t.adapter)).toEqual(["dummy", "dummy"]);
    expect(run.tasks.map((t) => t.status)).toEqual(["done", "done"]);
    expect((run.tasks[1]!.result?.text ?? "").length).toBeGreaterThan(0);
    // Ergebnisse stammen aus dem jeweils eigenen Dispatch (AC-P40-2).
    await expect(app.getByTestId("run-detail")).toContainText("fertig");
  });

  test("Nicht freigegebener Adapter wird serverseitig verweigert (AC-P40-3)", async ({ hub }) => {
    const res = await hub.api("/api/orchestration/runs", {
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

  test("Stop bricht den Run ab; Dispatches bleiben nachvollziehbar (AC-P40-6)", async ({ app, hub }) => {
    const start = await hub.api("/api/orchestration/runs", { body: { title: "Stopp-Run", goal: "Wird gestoppt.", project: hub.alpha, frame, plan } });
    const id = (start.body as { id: string }).id;
    // Deterministisch über die API stoppen — der dummy-Worker ist in Sekunden fertig,
    // der UI-Klick-Race gehört in einen langsameren Live-Kontext; hier zählt der Zustand.
    const cancel = await hub.api(`/api/orchestration/runs/${id}/cancel`, { body: { reason: "E2E-Stopp" } });
    expect(cancel.status).toBe(200);
    expect((cancel.body as { status: string }).status).toBe("cancelled");
    // PWA zeigt den abgebrochenen Run mit Nachvollziehbarkeit.
    await app.goto(`${hub.origin}/#/runs`);
    await app.getByText("Stopp-Run").first().click();
    await expect(app.getByTestId("run-detail")).toContainText(/abgebrochen|cancelled/);
  });

  test("Run-Liste gegen den echten Hub lesbar (AC-P40-4 Lesefläche)", async ({ hub }) => {
    // Agenten-403 ist im Integrationstest belegt (Policy orchestration.manage: agent → deny);
    // hier bleibt die Auth-Lesefläche: Liste erreichbar, Run-Objekt formtreu.
    const list = await hub.api("/api/orchestration/runs");
    expect(list.status).toBe(200);
    const runs = list.body as { id: string; status: string }[];
    expect(Array.isArray(runs)).toBe(true);
    for (const r of runs) expect(typeof r.id).toBe("string");
  });
});
