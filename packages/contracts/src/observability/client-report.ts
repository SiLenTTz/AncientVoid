import { z } from "zod";

/**
 * BUG-0186: Was ein Browser/Gerät über sich selbst misst, ist von außen nicht einsehbar —
 * und bei der installierten App, die sich nicht drehen will, entscheidet genau das über die
 * Ursache (Gerät sperrt, App-Metadaten der Installation sperren, oder API fehlt). Der Bericht
 * geht deshalb an den Hub, damit der es protokolliert statt dass ein Mensch eine Zeile auf
 * dem Handy ablesen muss.
 *
 * K5: der Bericht ist klein und endlich — Felder haben Längen- und Zahlen Grenzen, nie ein
 * freier Objekt-Baum.
 */
export const ClientReportBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("orientation"),
    /** Gemessener Fenster-Winkel in Grad (Android: 0, 90, 180, 270). */
    angle: z.number().int().min(-360).max(360),
    /** Wie der Versuch endete: own API-Ergebnis oder gar nicht versucht. */
    how: z.enum(["gelockt", "entsperrt", "abgewiesen", "keine-api", "nicht-versucht"]),
    /** Ein Satz für den Menschen, immer ≤ 200 Zeichen. */
    detail: z.string().min(1).max(200),
    displayMode: z.enum(["standalone", "browser", "minimal-ui", "windowed"]).optional(),
    /** Was die ausgelieferte Manifest-Ausrichtung sagt (aus dem Abruf, nicht dem Cache). */
    manifestOrientation: z.string().max(40).optional(),
    width: z.number().int().positive().max(8000).optional(),
    height: z.number().int().positive().max(8000).optional(),
    devicePixelRatio: z.number().positive().max(10).optional(),
    platform: z.string().max(120).optional(),
    userAgent: z.string().max(300).optional(),
  }),
]);

export type ClientReport = z.infer<typeof ClientReportBody>;
