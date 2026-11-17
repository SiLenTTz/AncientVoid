/** Welches Bündel auf diesem Gerät läuft, weiß nur das Bündel selbst — der Server kann nur
 * sagen, was er ausliefert, und ein Cache auf dem Gerät kann älter sein als das. Vite ersetzt
 * `__BUILD_SHA__` zur Bauzeit (apps/pwa/vite.config.ts); ohne Ersetzung (Testlauf) bleibt der
 * Stand ehrlich „unbekannt“. */
declare const __BUILD_SHA__: string | undefined;

export const BUILD_SHA: string = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "unbekannt";

/** Kurzform für Anzeigen — 8 Zeichen reichen, um zwei Stände sicher zu unterscheiden. */
export const BUILD_SHA_SHORT: string = BUILD_SHA.slice(0, 8);
