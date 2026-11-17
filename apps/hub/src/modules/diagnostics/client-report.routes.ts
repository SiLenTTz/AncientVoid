import type { FastifyInstance } from "fastify";
import { ClientReportBody } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/**
 * BUG-0186: Selbstbericht eines Browsers/Geräts (Fenster-Winkel, Ausrichter-Versuch,
 * Anzeigemodus, Manifest-Ausrichtung). Der Hub **protokolliert** ihn nur — es gibt keinen
 * neuen Dauerzustand und keine Datenbank-Tabelle (K7: nichts, was einen Recovery-Pfad
 * brauchte). Der Wert liegt darin, dass die Diagnose des Geräts im Hub-Protokoll landet,
 * statt dass ein Mensch eine Zeile auf dem Handy abliest.
 *
 * K5: der Körper ist durch den Vertrag nach oben begrenzt (Einzelwerte, Längen Grenzen),
 * die Route nimmt nie einen freien Objekt-Baum an.
 */
export function registerClientReportRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { callerLabel } = ctx;

  app.post("/api/diagnostics/client-report", async (req, reply) => {
    const parsed = ClientReportBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "unbekannter oder unvollständiger Bericht", issues: parsed.error.issues.slice(0, 4) });
    }
    const r = parsed.data;
    // Eine Zeile, kuratiert — damit das Protokoll lesbar bleibt und kein Browser-Müll wächst.
    app.log.info(
      {
        bericht: "orientation",
        von: callerLabel(req),
        winkel: r.angle,
        ausrichter: r.how,
        anzeige: r.displayMode ?? "unbekannt",
        manifest: r.manifestOrientation ?? "unbekannt",
        fenster: r.width && r.height ? `${r.width}x${r.height}@${r.devicePixelRatio ?? "?"}` : "unbekannt",
        geraet: r.platform ?? "unbekannt",
        stand: r.build ?? "unbekannt",
        detail: r.detail,
      },
      "Bericht vom Gerät",
    );
    return reply.code(202).send({ logged: true });
  });
}
