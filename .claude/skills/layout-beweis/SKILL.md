---
name: layout-beweis
description: Sichtbare UI-Defekte auf dem Handy messbar machen (Überlappung, Höhen, Mitrollen) statt sie zu beäugen — mit einer Wegwerf-Playwright-Spec, Geometriezahlen und elementFromPoint. Nutzen bei „fühlt sich gedrungen/überdeckt an“, FAB-/Dock-/Composer-Flächen, Scrollverhalten, oder wenn ein Screenshot allein nichts beweist.
---

# Layout-Beweis statt Layout-Beäugung

Ein Screenshot zeigt ein Standbild. Für Flächen-, Überlappungs- und Scroll-Defekte gibt es
Zahlen. Rezept (funktioniert gegen den E2E-Hub des Harness, also ohne Produkt-Hub anzufassen):

## 1. Wegwerf-Spec anlegen

`e2e/specs/_scratch-<thema>.spec.ts` (Unterstrich = Wegwerf; **vor dem Commit löschen**).
Fixture-Muster aus `e2e/support/fixtures.ts`:

```ts
import { test, expect } from "../support/fixtures.ts";
test.describe("Messung", () => {
  test.use({ viewport: { width: 390, height: 844 } });          // Handy
  test("…", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Erzaehl kurz was" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "Antwort", 20_000);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
  });
});
```

Ausführen: `npx playwright test e2e/specs/_scratch-<thema>.spec.ts --workers=1 --reporter=line`
(der Global-Setup baut `apps/pwa/dist-e2e`, der Produkt-Hub auf 7373 bleibt unberührt).

## 2. Drei Sonden, die meist die Antwort geben

**Flächenhaushalt** (Dock/Composer vs. Chat — BUG-0053/BUG-0194 und der Hochformat-Fall):

```ts
app.evaluate(`(() => { const b=(s)=>{const e=document.querySelector(s); if(!e) return null;
  const r=e.getBoundingClientRect(); return {top:Math.round(r.top),bottom:Math.round(r.bottom),height:Math.round(r.height)};};
  return { vh: innerHeight, tail: b(".tail-scroll"), dock: b(".dock-stack"), tabbar: b(".tab-bar, nav") }; })()`)
```

Untergrenze aus der Repo-Geschichte: `.tail-scroll` ≥ ⅓ der Viewport-Höhe; zusätzlich die
**eingeklappte** Steuerung messen (Dock-Toggle `.dock-toggle` / aria „Steuerung einblenden“) —
der Unterschied zeigt, ob die Default-Einstellung das Problem ist oder die Untergrenze.

**Überlappung** (FAB/Klebestoff über Bedienelementen — BUG-0176/BUG-0199): den Mittelpunkt
jedes Controls unter der Fixbox testen, nicht ob etwas „drauf aussieht“:

```ts
const hit = document.elementFromPoint(cx, cy);
if (hit === ctl || ctl.contains(hit)) continue;      // frei
verdeckt.push({ text, trifft: String(hit?.className || hit?.tagName) });
```

Über **mehrere Scrollpositionen** (z. B. 0, 900, 1800, 2700, 3200, 4200, 5200) — fix
positionierte Elemente erwischen Reihen erst mitten im Scrollen. `trifft: "nyx-fab"` ist der
Beweis, dass ein Tipp nicht am Control ankommt.

**Mitrollen** (live wachsender Inhalt, ADR-0083): unterer Rand der wachsenden Blase muss im
sichtbaren Container bleiben und der Container in der Anheft-Schwelle:
`scrollHeight − clientHeight − scrollTop ≤ 48` und `scrollTop > 0`.

## 3. Regeln für den Rückgabewert

- Zahlen im Bericht (vorher/nachher), Screenshot nur als Beilage — Pfad angeben.
- Vorher-Nachher am **selben** Stand messen (z. B. `git stash push -- <datei>` → Messung →
  `git stash pop` → Messung), sonst vergleicht man Äpfel mit Branch-Ständen.
- Ist der Ausgang eine Produktentscheidung (Funktion verstecken vs. dynamisch ausweichen):
  Akte mit beiden Ausgängen öffnen (`bug-report`-Skill), Spec löschen, nicht still die Spec
  umbiegen.
- Auf Windows: `execFileSync("npm", …)` braucht `shell` (`e2e/support/win-shell.ts`,
  BUG-0169) — sonst scheitert der Bau schon im `beforeAll`.

## Messfalle: Zustand nur an Punkten erfassen, die wirklich angefahren werden

Am 17.11.2026 gemeldet und falsch: „FAB war bei Scroll 3200 px versteckt“. Die Sonde fuhr
300er-Schritte an (0, 300, …, 5700) und zeichnete den Zustand **nur bei `y === 3200`** auf —
ein Punkt, der nie angefahren wurde. Ergebnis war `null`, als „versteckt“ gelesen. Regel:
den Zustand **an jedem angefahrenen Punkt** zählen (`versteckt++`, `treffer += …`) und die
Schiene mitzählen (`Punkte=20`), damit ein fehlender Punkt als fehlend sichtbar ist. Ein
`null`/leerer Wert ist kein Befund, sondern ein Loch in der Messung.
