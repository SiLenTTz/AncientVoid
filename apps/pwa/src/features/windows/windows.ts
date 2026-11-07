import { useEffect, useState } from "preact/hooks";
import { dropFeatures, type DropPoint } from "./drag.ts";
import { applyWindowMessage, parseWindowMessage, popoutUrl, pruneWindows, targetKey, WINDOW_CHANNEL, windowFor, type WindowMessage, type WindowRegistry, type WindowTarget } from "./protocol.ts";

/**
 * EPIC-P34 T34.10 (ADR-0053): die Seite des Kanals. Jede Seite (Hauptfenster wie eigenes Fenster) führt dieselbe
 * Liste der lebenden Fenster, gespeist aus `hello`/`heartbeat`/`bye` und mit Ablauf nach `WINDOW_TTL_MS`.
 */
let registry: WindowRegistry = {};
let channel: BroadcastChannel | null = null;
let starts = 0;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();
const handlers = new Set<(msg: WindowMessage) => void>();

function publish(next: WindowRegistry): void {
  registry = next;
  subscribers.forEach((fn) => fn());
}

export function getOpenWindows(): WindowRegistry {
  return registry;
}

export function postWindowMessage(msg: WindowMessage): void {
  channel?.postMessage(msg);
}

/** Wer reagieren will (Hauptfenster auf `return`, Fenster auf `focus`/`ping`), hängt sich hier ein. */
export function onWindowMessage(handler: (msg: WindowMessage) => void): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Öffnet den Kanal (einmal je Seite, zählt Aufrufer) und fragt bestehende Fenster nach einem neuen `hello`. */
export function startWindowHub(): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  if (starts++ === 0) {
    channel = new BroadcastChannel(WINDOW_CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      const msg = parseWindowMessage(e.data);
      if (!msg) return;
      publish(applyWindowMessage(registry, msg, Date.now()));
      handlers.forEach((fn) => fn(msg));
    };
    pruneTimer = setInterval(() => {
      const next = pruneWindows(registry, Date.now());
      if (Object.keys(next).length !== Object.keys(registry).length) publish(next);
    }, 3000);
    channel.postMessage({ type: "ping" } satisfies WindowMessage);
  }
  return () => {
    if (--starts > 0) return;
    channel?.close();
    channel = null;
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = null;
    registry = {};
  };
}

export function useOpenWindows(): WindowRegistry {
  const [snapshot, setSnapshot] = useState(registry);
  useEffect(() => {
    const on = () => setSnapshot(registry);
    subscribers.add(on);
    on();
    return () => {
      subscribers.delete(on);
    };
  }, []);
  return snapshot;
}

export function isPopoutWindow(): boolean {
  return new URLSearchParams(location.search).get("window") === "1";
}

export type PopoutResult = "opened" | "focused" | "blocked";
const HELLO_WAIT_MS = 3000;

/**
 * Öffnet ein eigenes Fenster. Ist das Ziel schon offen, kommt es nach vorn statt doppelt zu entstehen.
 * `noopener`: Das Fenster hat keinen Bezug zum Öffner (ein voller Tail bremst sonst den Haupt-Thread, K2); `window.open`
 * liefert dann immer `null`. Ob es aufging, zeigt allein das `hello` — bleibt es aus, blockiert der Browser Pop-ups.
 */
export function openPopout(target: WindowTarget, drop?: DropPoint): Promise<PopoutResult> {
  const existing = windowFor(registry, target);
  if (existing) {
    postWindowMessage({ type: "focus", id: existing.id });
    return Promise.resolve("focused");
  }
  return new Promise((resolve) => {
    const key = targetKey(target);
    let done = false;
    const finish = (result: PopoutResult) => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      resolve(result);
    };
    const off = onWindowMessage((msg) => {
      if (msg.type === "hello" && targetKey(msg.target) === key) finish("opened");
    });
    const timer = setTimeout(() => finish("blocked"), HELLO_WAIT_MS);
    window.open(popoutUrl(target), "_blank", dropFeatures(drop));
  });
}

export function focusWindowFor(target: WindowTarget): boolean {
  const existing = windowFor(registry, target);
  if (!existing) return false;
  postWindowMessage({ type: "focus", id: existing.id });
  return true;
}
