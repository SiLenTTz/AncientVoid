# ADR-0022 — Anhänge: einmal speichern, lokal lesen, nativ übergeben

**Status:** akzeptiert · **Betrifft:** EPIC-P7 T7.5/T7.10, `packages/contracts/src/attachments/`,
`packages/core/src/modules/attachments/`, `apps/hub/src/modules/attachments/`, Adapter, PWA

## Kontext

Prompts waren nur Text (Audit G08). Du möchtest Dateien und Bilder in
Sessions laden, und deren Inhalt muss für jeden Harness lesbar sein, auch für
solche ohne Bildverständnis.

## Entscheidung

1. **Speichern nach Inhalts-Hash:** `POST /api/attachments` nimmt rohe Bytes
   (Name in `x-filename`, max. 25 MB) und speichert sie einmal unter
   `data/attachments/<sha256>` (0600). Ein SQLite-Datensatz enthält Name, Typ,
   Größe, Art und Auslese-Status.
2. **Auslese lokal zuerst:** Text direkt, PDF per `pdftotext`, Scans per
   `pdftoppm` + `tesseract` (deu+eng, Sprachdaten ohne root über
   `scripts/setup-ocr.sh`), DOCX/XLSX/PPTX/ODF aus ihrem XML (fflate).
   **Gemini** (`generateContent`, Standard `gemini-flash-latest`) nur, wenn
   ein Schlüssel hinterlegt ist und lokal kein Text herauskam. Die
   Methode steht immer am Datensatz.
3. **Schlüssel nur schreibbar:** `PUT /api/settings/gemini` setzt ihn,
   `GET /api/settings` sagt nur „hinterlegt“. Das dürfen nur Geräte dieses
   Hubs (Policy `settings.manage`, ADR-0021).
4. **Übergabe nach Fähigkeit** (ADR-0018 `images`/`files`): claude bekommt
   Pfad + `--add-dir` (liest Bilder und PDFs selbst), codex Bilder als
   `localImage`, opencode Bilder und PDFs per `-f`, ACP-Agenten Bildblöcke,
   wenn sie sie anbieten. Alles andere und jeder Harness ohne diese
   Fähigkeit bekommt den ausgelesenen Text im Prompt
   (`promptWithAttachments`, zentral im SessionManager).
5. **K5:** Events tragen nur Verweise (id, Name, Typ, Größe, Methode), nie
   Bytes oder Text.

## Konsequenzen

- Hosts ohne poppler/tesseract lesen weniger; die Karte sagt dann, dass ein
  Gemini-Schlüssel hilft.
- Die Videoanalyse (EPIC-P10.5) baut auf diesem Speicher und dieser
  Auslese auf.
