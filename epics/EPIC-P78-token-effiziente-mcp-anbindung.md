# EPIC-P78 — Token-effiziente MCP-Anbindung: Progressive Disclosure statt Tool-Flut

**Status:** Planungsentwurf (Nutzerauftrag 20.11.2026) · **Phase:** P78 · **Dauer:** ~1–2 Agenten-Tage · **Abhängigkeit:** baut auf EPIC-P74 (`KnowledgeSource`-Contract, ADR-0096, MCP-Fassade) auf; kein harter Blocker — solange nur der Librarian als Backend dient, ist dringender Handlungsbedarf Null (5 Tools ≈ ein paar hundert Token/Session).

## 1. Ziel

Wenn AncientVoid (oder die Fassade) später an **beliebige MCP-Server mit großen Tool-Oberflächen** andockt (Cloudflare-API-Scale, hunderte+ Tools), dürfen die Tool-Schemas nicht mehr vollständig in den Agenten-Kontext geladen werden — sonst explodieren die Input-Token-Kosten (Cloudflare-Benchmark „Code Mode", 20.11.2026: 1,17 Mio. Token Tool-Definitionen vs. ~1.000 Token bei 2 Meta-Tools; ~99,9 % Ersparnis). Dieses Epic etabliert **Progressive Disclosure** als Muster für alle zukünftigen MCP-Integrationen, mit gemessener statt geglaubter Ersparnis.

Nutzerauftrag wörtlich: „Können wir das auch nutzen, um unsere Token-Kosten minimal zu halten wenn wir MCPs anbinden wollen. Gibt es noch andere bessere Möglichkeiten?"

## 2. Scope (In / Out)

**In:**

- ADR-0098: Entscheidung Progressive-Disclosure-Strategie für MCP-Integrationen:
  a) **Dynamic Tool Search** (Anthropic-Muster, Claude Code): Tools werden erst nach Relevanz-Filter in den Kontext geladen; Referenzmessung ~94 % Ersparnis (Heyer/Google-Cloud-Reimplementierung). **Bevorzugter Weg für AV.**
  b) **Server-side Code Mode** (Cloudflare Agents SDK): 2 Tools (`search()`/`execute()`) mit JS-Code-Ausführung in Sandbox-Isolate. Nur für sehr große Tool-Oberflächen; Sicherheits-Delta beachten (siehe Premortem F2).
  c) **Fixer Domänen-Contract** (bereits P74-Realität): `KnowledgeSource` mit konstant 4–5 Ops unabhängig vom Backend — Tool-Oberfläche wächst nicht mit Anzahl Backends.
- Tool-Description-Hygiene in der Librarian-Fassade (T74.4-Rückflug): Beschreibungen hart kürzen, Defaults dokumentieren statt ausschreiben (ArXiv 2602.14878 „MCP Tool Descriptions Are Smelly": kolloquiale/redundante Beschreibungen kosten messbar Tokens).
- Messlatte: Token-Counter pro Session vorher/nachher (Tools-List-Serialisierung), dokumentiert im ADR — EPIC-134-Geist: Ersparnis benchmark-bewiesen, nicht behauptet.
- `epics/README.md`-Zeile.

**Out:**

- Änderungen an P74-Laufzeitverhalten (Librarian-Fassade bleibt bei 5 Tools; keine Code-Mode-Einführung am laufenden System).
- Client-side Code Mode (benötigt Sandbox im Agenten — Angriffsfläche, kein Nutzen hier).
- Generischer „any MCP"-Client (der Phase-2/3-Pfad aus P74; hier nur die Design-Regel, die er dann einhalten muss).

## 3. Design-Details

### 3.1 Entscheidungsmatrix (ADR-0098-Inhalt)

| Kriterium | Dynamic Tool Search | Code Mode (server) | Fixer Contract |
|---|---|---|---|
| Token-Ersparnis | ~94 % (gemessen, Heyer) | ~99,9 % (CF-Benchmark) | 100 % für Domäne (kein Wachstum) |
| Sicherheit | unverändert | − (beliebiger Code, Sandbox nötig, OAuth-Downscoping) | + (kleinste Fläche) |
| Komplexität | mittel (Relevanz-Ranking) | hoch (Isolate-Betrieb) | gering (P74 schon da) |
| Passt zu | AV generische MCP-Clients | Fassade für Riesen-APIs | Knowledge-Domäne |

Regel: **Fixer Contract, wo eine Domäne existiert (Standard). Dynamic Tool Search, wo fremde Server mit vielen Tools andocken. Code Mode nur, wenn Tool-Zahl > ~50 und Domäne nicht modellierbar.**

### 3.2 Dynamic Tool Search für AV (Skizze)

- Beim Connect einer Knowledge-Source: `tools/list` cachen (Server-seitig), NICHT in Session-Kontext laden.
- Neues Meta-Tool `knowledge_find_tools(query)` → rankt gecachte Tool-Descriptions, lädt Top-k (k≤5) temporär in die Session.
- Budget-Gate: `maxOverviewBytes`-Analogon für Tools (`maxToolSchemaBytes`), harte Obergrenze pro Session.

### 3.3 Messlatte

- Metrik `tools_tokens_per_session` im Hub (bestehende Metrik-Infrastruktur P59/P66 anbinden).
- Abnahme nur mit Zahlen: Baseline (alle Tools geladen) vs. Progressive Disclosure auf einem Test-MCP-Server mit ≥50 Tools.

## 4. Aufgaben (Checkliste T78.m)

- [ ] T78.1 ADR-0098: Entscheidungsmatrix + Regel (fixer Contract / DTS / Code Mode) schreiben
- [ ] T78.2 Tool-Description-Hygiene an der Librarian-Fassade (nach T74.4-Go-Live)
- [ ] T78.3 `knowledge_find_tools`-Prototyp + Tool-Schema-Caching (erst wenn generischer MCP-Client aus P74-Phase 2 angegangen wird — Trigger: >1 Backend mit >20 Tools)
- [ ] T78.4 Messlatte `tools_tokens_per_session` + Benchmark-Doku
- [ ] T78.5 `epics/README.md`-Zeile + Doku-Verweis im P74-Epic (§ Premortem/Outlook)

## 5. Acceptance Criteria (AC-P78-k)

1. ADR-0098 final mit Entscheidungsmatrix und formaler Regel; Nutzer-Review-Gate.
2. Fassaden-Tool-Beschreibungen gekürzt; Vorher/Nachher-Token-Zahl im ADR dokumentiert.
3. Sobald T78.3 getriggert: Benchmark mit ≥50-Tool-Testserver, Ersparnis in % dokumentiert (nicht geschätzt).
4. P74-Epic verweist auf P78 (Progressive-Disclosure-Regel für Phase-2-Generik).

## 6. Premortem (Failure-Modi + Mitigation)

- **F1 Over-Engineering:** P78 bauen, obwohl nur der 5-Tool-Librarian live ist. → T78.3 hat expliziten Trigger (>1 Backend, >20 Tools); davor nur ADR + Hygiene.
- **F2 Code-Mode-Sicherheitsaufweichung:** `execute(js)` auf der Fassade unterläuft „DB nur über Librarian" — der Code kann alles, was die API kann, inkl. Tenant-Nachbar-Zugriff bei Fehlkonfiguration. → Code Mode nur hinter eigener Zustimmung (Nutzer-Gate) + nie am Multi-Tenant-Librarian ohne Sandbox-Isolat-Betrieb.
- **F3 Ranking-Qualität:** DTS filtert relevante Tools weg (false negatives) → Agent sieht Critical-Op nicht. → `knowledge_find_tools` liefert Top-k PLUS Hinweis auf Gesamtzahl/`overview()`-Fallback; Akzeptanzkriterium im späteren T78.3-Benchmark: Recall@5 ≥ 0,9 auf Testsuite.
- **F4 Messdaten-Recycling:** Cloudflare/Heyer-Zahlen ungeprüft auf AV übertragen. → T78.4 misst am eigenen Stack; externe Zahlen nur als Motivation, nicht als Nachweis.

## 7. Definition of Done

ADR-0098 gemerged; Fassaden-Hygiene mit Vorher/Nachher-Zahlen; README-Zeile; T78.3 als getriggerter Folgeauftrag dokumentiert. Menschen-Abnahme: Jan reviews ADR-0098 (Entscheidungsmatrix).
