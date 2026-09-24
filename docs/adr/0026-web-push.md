# ADR-0026 — Web Push als Hinweis, bewusster Egress, Glocke bleibt die Quelle

**Status:** akzeptiert · **Betrifft:** EPIC-P8 T8.3, AC-P8-3,
`packages/contracts/src/push/push.ts`, `packages/core/src/modules/push/`
(Migration 19), `apps/hub/src/modules/push/`, `apps/pwa/public/sw.js`,
Einstellungen → Benachrichtigungen

## Kontext

Die Glocke (ADR-0015) sieht man nur mit offener App. Für „Freigabe nötig“
und „Fehler“ braucht es einen Hinweis bei gesperrtem Handy. Web Push läuft
zwingend über den Push-Dienst des Browser-Herstellers: FCM, Apple, Mozilla,
Microsoft. Das ist Egress aus dem Tailnet.

## Entscheidung

1. **Aus, bis ein Mensch es einschaltet:** `PUT /api/push/enabled` gehört zur
   Einstellungsklasse (`settings.manage`). Das Einschalten erzeugt einmalig
   ein VAPID-Schlüsselpaar in der `config`-Tabelle. Der Text in den
   Einstellungen sagt, dass Push das Tailnet verlässt.
2. **Nur eine Kennung:** Der Inhalt ist `{id, category, sessionId, hostId}`.
   Titel und Text setzt der Service Worker fest: „Freigabe nötig“, „Fehler“,
   „Zug fertig“. Kein Prompt, kein Befehl, kein Projektname auf dem
   Sperrbildschirm. Beim Tippen öffnet sich die Session, der Inhalt wird
   nach Anmeldung geladen.
3. **Nur bekannte Push-Dienste:** Endpunkte müssen `https` sein und bei
   FCM, Apple, Mozilla oder Microsoft liegen. Sonst könnte ein Gerät den Hub
   gegen interne Adressen feuern lassen (SSRF).
4. **Pro Gerät:** Abo mit Gerätelabel, Ruhezeit (Gerätezeit) und der Wahl
   „auch bei fertigem Zug“. Standard sind nur Freigaben und Fehler. Agenten
   und Flotten-Tokens abonnieren nicht (`push.subscribe`).
5. **Genau einmal:** Je Abo merkt sich der Hub die letzte gesendete
   Meldungs-ID. Sie wird vor dem Senden gesetzt, doppelte `notify()` senden
   nichts. Zusätzlich setzt der Service Worker `tag` = Meldungs-ID.
6. **Sichtbarer Zustellstatus:** zuletzt zugestellt, letzter Fehler. 404/410
   vom Push-Dienst setzen das Abo auf „erloschen“, mit Hinweis zum
   Neu-Einschalten. Ein vom Betriebssystem oder Browser blockiertes Gerät
   zeigt das in den Einstellungen.
7. **Rotation:** `pushsubscriptionchange` bittet die App, sich neu
   anzumelden. Beim App-Start registriert sie ein vorhandenes Abo erneut
   (idempotent, `oldEndpoint` ersetzt ein altes).
8. **Die Glocke bleibt die Quelle.** Ruhezeit und Filter unterdrücken nur
   den Push, nie den Eintrag in der Glocke. Ohne Netz kommt kein Push, und
   das wird nirgends behauptet.

## Folgen

- Senden über `web-push` 3.6.7 (aes128gcm, VAPID ES256).
- Meldungen gepaarter Peers (ADR-0017) pusht jeder Peer selbst, sofern dort
  eingeschaltet. Der Heim-Hub leitet sie nicht weiter (später, T12.4).
- Hintergrund- und Sperrbildschirm-Zustellung ist nur auf echten Geräten
  prüfbar (T12.4). Headless-Browser haben keinen Push-Dienst.
