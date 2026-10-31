# Example: Webhook reporting sink

Reference implementation of the [Reporting-Sink-Contract](../../../docs/adr/0009-reporting-sink-contract.md)
(`onSessionComplete(summary) => void`, T4.1). POSTs the `SessionSummary`
JSON to a configured URL once per completed session — no retry, no queue,
no assumption about what the receiving end is.

This is **an example**, not part of the OSS core: the hub only knows the
`ReportingSink` function type; it never knows this file, Brain, Slack, or
any other specific consumer exists.

## Config

```json
{
  "module": "./examples/reporting-sinks/webhook/sink.ts",
  "config": {
    "url": "https://example.com/ancientvoid-digest",
    "headers": { "Authorization": "Bearer <token>" },
    "timeoutMs": 5000
  }
}
```

Add it to `hub.config.json`'s `reportingSinks` array (empty by default —
no digests, no new network egress, until you configure one).

## What a SessionSummary looks like

See [`packages/contracts/src/reporting.ts`](../../../packages/contracts/src/reporting.ts).
`lessons` are rule-based extractions from the session's real event log
(gate/error events, notable system events like budget parks or approval
decisions) — never LLM-generated free text — each citing the real event
`seq` it came from (`eventSeq`). `archiveRef` points at the session's raw
JSONL event archive (`sessions/<id>/events.jsonl`, relative to the hub's
`dataDir`) instead of embedding full event content.

## Writing your own sink

Export `createSink(config?) => ReportingSink` from any module (package
name, relative path, or absolute path — resolved exactly like an adapter
module). A sink that throws or rejects never affects session lifecycle:
the hub catches the error and records a `session.digest_sink_failed`
system event instead.
