---
id: BUG-0051
slug: gatekeeper-wertet-heredoc-inhalt-als-befehl
status: done
severity: S2
area: core
instance: prod
commit: ""
forge: ""
epic: "P7"
created: 2026-10-09
reporter: jan
---

# BUG-0051 — Gatekeeper wertet den Inhalt eines Here-Documents als Befehl

## Gesehen

Ein Bash-Aufruf, der mit `cat > datei <<'EOF' … EOF` eine **Testdatei schreibt**, wurde als
`CRITICAL_BLOCK` eingestuft und verlangte einen Passkey, weil im Text der Datei ein kritisch
aussehender Befehl stand (`rm -rf …`, `… | sh`). Der Passkey war nicht entscheidbar (0 registriert,
`rpId` stand auf `localhost`), die Anfrage lief nach 10 min ab; „Ablehnen“ verlangt ebenfalls den
Passkey. Die Session hing so mehrfach.

## Erwartet

Der Inhalt eines Here-Documents, das nur in eine Datei geschrieben wird, ist kein Befehl. Wird er
dagegen in eine Shell geleitet oder von einer Shell gelesen, zählt er weiter.

## Repro

1. Tool-Anfrage `Bash` mit `cat > t.ts <<'EOF'` und einer Zeile `rm -rf /` im Inhalt.
2. Einstufung lesen (`assessByRules`).

**Ergebnis nach Schritt 2:** `CRITICAL_BLOCK` → `destructive` → Passkey.

**Häufigkeit:** immer, sobald der geschriebene Text ein Muster der Regeln enthält.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, `toolApprovals: ask` |
| Commit | `e5a7130` |
| Repro-Weg | Unit-Test |

## Logs

```text
approvals: 3dfc2b98 destructive tool.Bash  07:13:27 → timed_out 07:23:28 (UTC, 2026-10-09)
approvals: a18836e6 destructive tool.Bash  21:33:53 → timed_out 21:43:54 (UTC, 2026-10-08)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/gatekeeper/heredoc.test.ts` (6) | 3 rot ohne Fix; 3 weitere schützen vor Überkorrektur (`| bash`, `bash <<EOF`, `<<EOF; bash f`, Befehl nach dem Dokument) |
| Unit | `gatekeeper.test.ts` (beschriftetes Sicherheits-Set) | grün, unverändert |

## Eingrenzung

`packages/core/src/modules/gatekeeper/rules.ts`: die Shell-Regeln prüften `textOf(input)` samt Inhalt
des Here-Documents. Fix: `withoutFileHeredocs` entfernt den Inhalt bei `cat`/`tee`, aber nur, wenn die
Zeile an der Endmarke endet — so bleiben `cat <<EOF | bash`, `bash <<EOF` und `cat > f <<EOF; bash f`
sichtbar.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
