import { test, expect, sessionTab } from "../support/fixtures.ts";

/**
 * BUG-0211 (Kai, 2026-11-18): „irgendwie schneidet der bei mir alte Sachen ab — wenn ich
 * weiter hoch scrollte, kann ich nicht bis an den Anfang des Chats scrollen.“
 *
 * Der Hub liefert den ganzen Schwanz (in Seiten zu 100), der Client hielt davon nur die
 * letzten 500 Eintraege — alles Aeltere war weg, und nach oben gab es nichts zu holen. Der
 * exakte Nachweis laeuft im Verlauf (dort steht eine Zeile pro Ereignis, der Chat faelt
 * Schritte eines Zugs zusammen): die Spitze des Verlaufs muss Folge 1 sein. Der Chat-Fl
 * danach ist das, was Kai tut: hochscrollen und den allerersten Auftrag sehen.
 */
test.describe("Chat bis zu seinem Anfang (BUG-0211)", () => {
  test.use({ hubOptions: { dummyAutoStop: 0, dummyEventsPerSecond: 20 } });

  test("Hochscrollen holt die frueheren Eintraege bis zur Spitze — ohne Sprung", async ({
    app,
    hub,
  }) => {
    test.setTimeout(240_000);
    const id = await hub.createSession({
      adapter: "dummy",
      prompt: "ANFANGSMARKER-0209",
    });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Verlauf");
    const tail = app.locator(".tail-scroll");
    await expect(tail).toBeVisible();

    /** aelteste Folge, die im Verlauf steht — gemessen am DOM, nicht am Lager des Clients */
    const aelteste = () =>
      tail.evaluate((el) => {
        const seqs = [...el.querySelectorAll(".event[data-seq]")].map((n) =>
          Number(n.getAttribute("data-seq")),
        );
        return seqs.length ? Math.min(...seqs) : null;
      });

    // Der Client wirft zuerst alles außer den letzten 500 weg — erst dann ist der Fall da.
    await expect
      .poll(aelteste, {
        timeout: 150_000,
        message: "noch kein verworfener Altbestand im Verlauf",
      })
      .toBeGreaterThan(1);
    await expect(app.getByTestId("load-older")).toBeVisible();

    // Hochscrollen wie im Alltag: Mausrad nach oben, immer wieder.
    for (let i = 0; i < 3; i++) {
      await app.mouse.move(200, 300);
      await app.mouse.wheel(0, -1500);
      await app.waitForTimeout(600);
    }

    // Der Nachladevorgang selbst, in einem Rutsch gemessen: die Zeile, die vorher oben
    // stand, behaelt ihren Abstand zum Rand — kein Sprung, keine verlorene Lesestelle.
    const anker = await tail.evaluate(async (el) => {
      const oben = el.querySelector(".event[data-seq]") as HTMLElement;
      const seq = oben.getAttribute("data-seq");
      const rand =
        oben.getBoundingClientRect().top - el.getBoundingClientRect().top;
      (el.querySelector(".tail-older button") as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 2000)); // auf den Hub und den Render warten
      const jetzt = el.querySelector(
        `.event[data-seq="${seq}"]`,
      ) as HTMLElement | null;
      const seqs = [...el.querySelectorAll(".event[data-seq]")].map((n) =>
        Number(n.getAttribute("data-seq")),
      );
      return {
        seq,
        fund: jetzt
          ? Math.abs(
              jetzt.getBoundingClientRect().top -
                el.getBoundingClientRect().top -
                rand,
            )
          : null,
        min: Math.min(...seqs),
        max: Math.max(...seqs),
        zeilen: seqs.length,
      };
    });
    expect(anker.min, JSON.stringify(anker)).toBe(1);
    expect(anker.fund, JSON.stringify(anker)).not.toBeNull();
    expect(anker.fund).toBeLessThan(24);

    // Weiter hoch: die Spitze kommt in Reichweite — und zwar die echte Folge 1.
    for (let i = 0; i < 6; i++) {
      await app.mouse.move(200, 300);
      await app.mouse.wheel(0, -1500);
      await app.waitForTimeout(600);
    }
    await expect
      .poll(aelteste, {
        timeout: 30_000,
        message: "die Spitze des Verlaufs bleibt unerreichbar",
      })
      .toBe(1);
    await expect(
      app.locator('.tail-scroll .event[data-seq="1"]'),
    ).toBeVisible();

    // Sie bleibt erreichbar, waehrend neue Eintraegen einlaufen.
    const vorNeuen = await aelteste();
    await app.waitForTimeout(1500);
    expect(await aelteste()).toBe(vorNeuen);

    // Und im Chat selbst: hochscrollen zeigt den allerersten Auftrag.
    await sessionTab(app, "Chat");
    const chat = app.locator(".tail-scroll");
    for (let i = 0; i < 5; i++) {
      await app.mouse.move(200, 300);
      await app.mouse.wheel(0, -1500);
      await app.waitForTimeout(600);
    }
    await expect(app.getByText("ANFANGSMARKER-0209").first()).toBeVisible();
    expect(
      await chat.evaluate((el) =>
        Math.min(
          ...[...el.querySelectorAll(".event[data-seq]")].map((n) =>
            Number(n.getAttribute("data-seq")),
          ),
        ),
      ),
    ).toBeLessThanOrEqual(3);
  });
});
