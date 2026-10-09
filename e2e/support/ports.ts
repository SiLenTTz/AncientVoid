import { createServer } from "node:net";

/**
 * Ein freier Port vom Betriebssystem. Ein zufälliger Port aus einem festen Bereich kollidierte mit
 * fremden Prozessen (EADDRINUSE im Volllauf); so ist die Lücke bis zum eigenen listen() winzig.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}
