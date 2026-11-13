import { describe, expect, it } from "vitest";
import { itemStarted, itemCompleted } from "../src/app-server-events.ts";

/** Shapes aus codex-cli 0.164.0: app-server generate-json-schema, ThreadItem. */
describe("Codex ThreadItem-Werkzeuge", () => {
  it("ordnet dynamische Werkzeuge mit Namespace und Textausgabe zu", () => {
    const item = { type: "dynamicToolCall", id: "d", namespace: "functions", tool: "exec_command", arguments: { cmd: "pwd" }, status: "completed", success: true, contentItems: [{ type: "inputText", text: "/repo" }] };
    expect(itemStarted(item)).toMatchObject([{ type: "tool_use", payload: { id: "d", name: "functions.exec_command", input: { cmd: "pwd" } } }]);
    expect(itemCompleted(item)).toMatchObject([{ type: "tool_result", payload: { toolUseId: "d", content: "/repo", isError: false } }]);
    expect(itemCompleted({ ...item, success: false, status: "failed" })).toMatchObject([{ payload: { isError: true } }]);
  });
  it("zeigt delegierte Arbeit und deren Fehlschlag", () => {
    const item = { type: "collabAgentToolCall", id: "a", tool: "spawnAgent", prompt: "Prüfe Tests", status: "failed", agentsStates: { worker: { status: "errored", message: "abgebrochen" } } };
    expect(itemStarted(item)).toMatchObject([{ type: "tool_use", payload: { name: "spawnAgent", input: { prompt: "Prüfe Tests" } } }]);
    expect(itemCompleted(item)).toMatchObject([{ type: "tool_result", payload: { toolUseId: "a", isError: true } }]);
  });
  it("verschluckt neue Item-Typen nicht still", () => {
    expect(itemCompleted({ type: "futureTool", id: "u" })).toMatchObject([{ type: "system", payload: { kind: "codex.unknown_item", itemType: "futureTool" } }]);
  });
  it("erhält Bildpfade und kennzeichnet fehlgeschlagene Bilderzeugung", () => {
    const view = { type: "imageView", id: "v", path: "/repo/diagram.png" };
    expect(itemStarted(view)).toMatchObject([{ payload: { id: "v", input: { path: "/repo/diagram.png" } } }]);
    expect(itemCompleted(view)).toMatchObject([{ payload: { toolUseId: "v", content: "/repo/diagram.png", isError: false } }]);
    expect(itemCompleted({ type: "imageGeneration", id: "g", status: "failed", failure: "quota" })).toMatchObject([{ payload: { toolUseId: "g", isError: true } }]);
    expect(itemCompleted({ type: "sleep", id: "s", durationMs: 1000 })).toMatchObject([{ payload: { toolUseId: "s", isError: false } }]);
  });
});
