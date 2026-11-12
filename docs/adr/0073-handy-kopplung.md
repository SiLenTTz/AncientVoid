# ADR-0073 — Handy-Kopplung: Token bleibt manuell, der Wizard nennt den Weg

**Status:** akzeptiert · **Betrifft:** EPIC-P57 T57.8, `setup.sh`, PWA-Token-Gate (T57.9) · **Bezug:** PRD §8, K1

## Kontext

Das Token-Gate der PWA verlangt ein Device-Token, das nur per `hubctl token issue`
(oder der Wizard-Ausgabe) entsteht. Für den ersten Handy-Start (P57, Ziel ≤ 15 Minuten)
ist das die größte Hürde: Token und Tailnet-URL müssen vom Rechner aufs Handy.
Zu entscheiden war, ob dafür eine neue Auth-Semantik nötig ist (PRD §8: Tokens nur
als Hash, nie in URLs oder Logs, kein öffentlicher Port).

## Optionen

- **(a) Token bleibt manuell.** Der Wizard nennt, wie die Handy-URL entsteht
  (`scripts/setup-tailscale-serve.sh` druckt `https://<host>.<tailnet>.ts.net`),
  und dass das Token im Gate eingegeben wird. Keine neue Auth-Semantik.
- **(b) Einmaliger Kopplungscode** analog `hubctl fleet invite`: 10 Minuten
  gültig, Einmalgebrauch, im Gate statt des Tokens eingegeben und gegen ein neues
  Device-Token getauscht. Das braucht einen unauthentifizierten Einlöse-Endpunkt,
  Ablauf- und Wiederverwendungslogik, Rate-Limit und eigene Tests — neue Angriffsfläche
  genau an der Stelle, die das Sicherheitsprinzip schützt.

Ausgeschlossen in beiden Varianten: Token oder Code als URL-Parameter oder QR mit
eingebettetem Token (Browser-Verlauf, Screenshots, Proxy-Logs).

## Entscheidung

**(a).** Begründung: Der Hub bleibt für ein Solo-Setup unverändert; PRD §8 hat
Vorrang vor Komfort. Die Reibung ist mit besseren Anweisungen lösbar (Wizard-Hinweis,
eigene Fehlermeldungen im Token-Gate, Tutorial), ohne einen offenen Einlöse-Pfad
zu schaffen. K1 ist nicht berührt (kein neuer Pfad zur Freigabe).

Umsetzung:

- `setup.sh` nennt im Abschlussblock die Handy-Schritte (Tailnet-URL erzeugen,
  Token im Gate eingeben, eigenes Token je Gerät via `hubctl token issue`). Der
  Wizard druckt **kein** Token in einer URL und keine URL mit Token.
- Das Token-Gate zeigt je Fehlerfall (leer, abgelehnt, Hub unerreichbar) den
  nächsten Schritt (T57.9).

## Option (b) — nur dokumentiert, nicht gebaut

Sie bleibt zulässig, wenn die Eingabe des Tokens auf dem Handy sich im
TTFS-Messlauf (T57.10) als Haupthindernis zeigt. Dann braucht sie vor dem Code:
einen eigenen ADR zum Einlöse-Endpunkt (Policy-Operation, Rate-Limit, Code nur als
Hash gespeichert, 10 Minuten, Einmalgebrauch, Test gegen Wiederverwendung) und
eine Prüfung, dass der Code weder in Logs noch in URLs landet.

## Folgen

Das Handy-Setup bleibt zwei bewusste Handgriffe (URL öffnen, Token eingeben).
Kein Contract, keine Policy-Zeile und kein Hub-Code ändert sich; der
Rückbau ist trivial. Wer das Token vom Rechner aufs Handy bringt, nutzt einen
selbst gewählten sicheren Weg (Passwortmanager, Teilen an sich selbst); das
Tutorial sagt es ehrlich.
