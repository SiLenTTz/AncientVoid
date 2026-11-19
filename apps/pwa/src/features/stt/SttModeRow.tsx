import { useEffect, useState } from "preact/hooks";
import { Segmented } from "../../shared/ui/forms.tsx";
import { recordingSupported, sttStatus } from "../../shared/local-stt.ts";
import { speechRecognitionSupported } from "../../shared/speech.ts";
import { EREIGNIS, liesstModus, modusHinweis, setzeModus, type SttFaehigkeiten, type SttModus } from "../../shared/stt-mode.ts";

/**
 * ADR-0094: die Quelle der Spracheingabe ist pro Geraet waehlbar. Der Hinweis
 * daneben nennt sie beim Namen — inklusive der Cloud — damit niemand raten muss,
 * wo das Gesprochene gerade hingeht.
 */
const OPTIONEN = [
  { value: "auto", label: "Automatisch" },
  { value: "lokal", label: "Lokal" },
  { value: "browser", label: "Browser" },
] as const;

export function SttModeRow() {
  const [modus, setModus] = useState<SttModus>(() => liesstModus());
  const [status, setStatus] = useState<{ available: boolean; engine?: string }>({ available: false });

  useEffect(() => {
    void sttStatus().then(setStatus);
    const horcht = () => setModus(liesstModus());
    window.addEventListener(EREIGNIS, horcht);
    return () => window.removeEventListener(EREIGNIS, horcht);
  }, []);

  const faehigkeiten: SttFaehigkeiten = {
    lokalVerfuegbar: status.available,
    aufnahmeMoeglich: recordingSupported(),
    browserFaehig: speechRecognitionSupported(),
  };

  // Ohne Mikrofon UND ohne Browser-Erkennung gibt es nichts auszuwaehlen.
  if (!faehigkeiten.aufnahmeMoeglich && !faehigkeiten.browserFaehig) return null;

  return (
    <div class="stt-modus" data-testid="stt-modus">
      <Segmented label="Quelle der Spracheingabe" value={modus} options={OPTIONEN} onChange={(naechster) => setModus(setzeModus(naechster))} />
      <span class="stt-modus-note" data-testid="stt-modus-note">
        {modusHinweis(modus, faehigkeiten, status.engine)}
      </span>
    </div>
  );
}
