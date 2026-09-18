# ADR-0007 — Approval-Service-Contract (Klassen, Signatur, Timeout)

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/approval.ts`
(neu), `packages/core/src/approvals.ts` (neu), `packages/core/src/db.ts`,
`packages/core/src/tokens.ts`, `packages/core/src/sessionmanager.ts`,
`packages/server/src/routes.ts`, T2.4/T2.5/T2.6 (`EPIC-P2-diff-approvals-budgets.md`)

## Kontext

EPIC-P2 §3 "Approval-Modell" verlangt drei Klassen (read frei / write
bestätigungspflichtig / destruktiv biometrisch) mit einer harten
Eigenschaft: *"Der Approve-Button schreibt einen signierten Eintrag
(Device-Token-Signatur) — ein Agent kann niemals 'in Prosa' eine Freigabe
simulieren."* Das ist eine Contract-Frage (ein neuer, geteilter Datentyp,
den Server-Routen, `SessionManager` und die PWA gemeinsam verstehen
müssen), keine reine Implementierungsdetail-Frage — daher dieses ADR statt
stillschweigender Erweiterung.

## Entscheidung

### Neuer Contract: `packages/contracts/src/approval.ts`

```ts
export const APPROVAL_CLASSES = ["read", "write", "destructive"] as const;
export type ApprovalClass = (typeof APPROVAL_CLASSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "timed_out"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ApprovalRequest = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  class: z.enum(APPROVAL_CLASSES),
  action: z.string().min(1),      // z.B. "steer.prompt", "session.create"
  summary: z.string().min(1),     // was/wo/Modell/Budget, menschenlesbar
  createdAt: z.string().min(1),
  timeoutAt: z.string().min(1),
  status: z.enum(APPROVAL_STATUSES),
  reasonRequired: z.boolean(),
  reason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedByLabel: z.string().nullable(),  // Device-Token-Label, nicht der Token selbst
  signature: z.string().nullable(),       // s. u.
});
```

`read`-Klasse erzeugt **gar keinen** `ApprovalRequest` — sie ist per
Definition frei (EPIC-P2 §3-Tabelle) und braucht keinen Queue-Eintrag.

### Signatur — real, ohne WebAuthn vorwegzunehmen

Für die `write`-Klasse (T2.4) gibt es noch keine asymmetrische
Gerätesignatur (die kommt erst mit T2.5s WebAuthn-Passkey für
`destructive`). Ein bloßes `decided: true`-Flag wäre aber genau das
„in Prosa simulierte" Approval, das die Anforderung ausschließt. Die
gewählte Lösung nutzt, was bereits real und kryptographisch geprüft
vorhanden ist: den rohen Device-Token aus dem `Authorization`-Header
(bereits durch `checkAuth()` verifiziert, bevor die Decide-Route
überhaupt läuft).

```
signature = HMAC-SHA256(key = raw device token, message = canonical(
  { id, sessionId, decision, reason, decidedAt }
))
```

Der rohe Token existiert nur im Request-Speicher dieses einen Aufrufs
(er wird nirgends persistiert, s. `hashToken()`/`TokenService`) — die
Signatur ist damit ein echter Besitznachweis desselben Bearer-Credentials,
das die App ohnehin als Auth-Grenze vertraut, keine neue, schwächere
Nebenmechanik. Für `destructive` ersetzt T2.5 dieses HMAC-Schema durch die
echte WebAuthn-Assertion-Signatur (asymmetrisch, Passkey-gebunden) — bis
dahin verweigert `ApprovalService.decide()` `destructive`-Entscheidungen
ganz ehrlich mit einem benannten Fehler statt einer schwächeren
Behelfssignatur.

### Timeout — fail-closed, lazy statt Timer-Thread

`ApprovalService` startet keinen `setInterval`. Jeder Lesezugriff
(`get`/`list`) und jeder `decide()`-Aufruf berechnet zuerst, ob
`now > timeoutAt` bei einem noch `pending`en Eintrag gilt, und schreibt in
diesem Fall zuerst den Status `timed_out` (terminal, wie `rejected`)
zurück, bevor irgendetwas anderes passiert — „Timeout = Reject" ist damit
strukturell unmöglich zu umgehen, nicht nur eine Konvention, die ein
Aufrufer einhalten müsste. Ein optionaler `sweepExpired()` existiert
zusätzlich für einen periodischen Aufruf (z. B. vom selben Heartbeat-Timer
wie `SessionManager.runHeartbeat()`), rein für den Fall, dass ein
Eintrag nie wieder gelesen wird, bevor er stillschweigend „ewig pending"
bliebe.

### Begründungspflicht

`reasonRequired` wird bei `create()` gesetzt (immer `true` für
`destructive`, konfigurierbar für `write`, nie für `read`, das ohnehin nie
einen Eintrag erzeugt). `decide()` mit `decision: "approve"` **und**
`reasonRequired: true` **und** leerem/fehlendem `reason` wird abgelehnt,
ohne den Status zu ändern (kein „approved ohne Begründung", AC-P2-5).

### Integration — opt-in, wie T2.1s `WorktreeManager`

`SessionManager` bekommt einen weiteren optionalen Konstruktor-Parameter
`approvals?: ApprovalService`. Ist er gesetzt **und** `spec.args.requireApproval`
(oder künftig eine Session-/Adapter-weite Policy) verlangt es, erzeugt
`steer()` für `kind: "prompt"` statt der sofortigen Weiterleitung an den
Adapter einen `pending`-`ApprovalRequest` und gibt `{ ok: false, detail:
"pending approval", approvalId }` zurück; erst `SessionManager.
applyApprovedSteer(approvalId)` (aufgerufen von der Decide-Route nach
einem echten `approved`) leitet den ursprünglichen Steer-Input tatsächlich
weiter. Ist `approvals` nicht gesetzt (jeder bestehende Aufrufer/Test vor
T2.4), ist das Verhalten exakt wie vorher — additiv, keine bestehenden
Tests brechen.

### SQLite

Neue Tabelle `approvals` (Migration `id: 4`, `approval-queue`):
`id, session_id, class, action, summary, created_at, timeout_at, status,
reason_required, reason, decided_at, decided_by_label, signature` — ein
eigener Store, kein Anhängsel an `sessions`, weil ein Approval-Eintrag ein
eigenständiges Auditobjekt ist (T2.8 Audit-Trail liest genau diese
Tabelle), keine Session-Eigenschaft.

## Konsequenzen

- Additiv: kein bestehender Contract-Typ ändert sich, `SessionManager`s
  neuer Parameter ist optional wie `worktrees` (T2.1) — bestehende
  Call-Sites/Tests unverändert grün.
- `destructive`-Entscheidungen sind bis T2.5 real gesperrt (kein
  Behelfs-„approved" ohne echte Biometrie) — eine bewusste, benannte
  Lücke, keine stillschweigende.
- `decidedByLabel` (nicht der Token-Hash, nicht der Rohtoken) landet im
  Klartext im Audit-Eintrag — Device-Labels sind ohnehin menschenlesbare
  Namen (`hubctl token issue "pixel-9"`), kein Geheimnis.
- Der `signature`-Wert ist nur mit dem (nie persistierten) Rohtoken
  nachprüfbar — er dient als Nachweis-zum-Zeitpunkt-der-Entscheidung, nicht
  als dauerhaft extern verifizierbare Signatur wie eine WebAuthn-Assertion.
  Das ist eine bewusste, im Text benannte Einschränkung dieses
  Zwischenschritts vor T2.5, keine vorgetäuschte Stärke.
