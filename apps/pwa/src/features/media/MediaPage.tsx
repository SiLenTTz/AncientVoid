import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, remoteHost, type MediaInfo, type MediaJob, type MediaResult, type SessionRecord } from "../../shared/api.ts";
import { formatTimestamp, handOver, MEDIA_STEP_LABELS, MEDIA_STEPS, timestampLink } from "../../shared/media.ts";
import { pageHash, sessionHash } from "../../app/route.ts";

/**
 * EPIC-P10.5 (ADR-0030): a video becomes material for a session. Link or
 * file in; steps with progress; transcript, key frames, chapters and a
 * summary out — and one tap hands the result to a session.
 */
const STATUS_TEXT: Record<MediaJob["status"], string> = { queued: "wartet", running: "läuft", done: "fertig", failed: "fehlgeschlagen", cancelled: "abgebrochen" };
const STEP_ICON: Record<string, string> = { pending: "·", running: "…", done: "✓", skipped: "–", failed: "✗" };
const SELECTED = "uacc.mediaJob";

function StepList({ job }: { job: MediaJob }) {
  return (
    <ol class="media-steps">
      {MEDIA_STEPS.map((s) => {
        const st = job.steps[s];
        return (
          <li key={s} class={`media-step ${st.status}`} title={st.detail ?? undefined}>
            <span class="media-step-icon">{STEP_ICON[st.status]}</span> {MEDIA_STEP_LABELS[s]}
            {st.status === "running" && st.progress !== null ? ` ${Math.round(st.progress * 100)} %` : ""}
            {st.detail && (st.status !== "pending" || st.detail.includes("Neustart")) ? <span class="dim"> · {st.detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Frame({ jobId, file, alt }: { jobId: string; file: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    void hubApi
      .mediaFrameUrl(jobId, file)
      .then((u) => {
        url = u;
        setSrc(u);
      })
      .catch(() => setSrc(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [jobId, file]);
  return src ? <img class="media-frame-img" src={src} alt={alt} loading="lazy" /> : <div class="media-frame-img placeholder">Bild lädt…</div>;
}

function ResultView({ job, result, sessions }: { job: MediaJob; result: MediaResult; sessions: SessionRecord[] }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [target, setTarget] = useState("new");
  const transcript = useRef<HTMLDivElement>(null);
  const jump = (ms: number) => {
    const link = timestampLink(result.url, ms);
    if (link) window.open(link, "_blank", "noopener");
    // Also show the place in the transcript (for files the only way).
    // The nearest line: a chapter often starts a moment before its sentence.
    let idx = 0;
    result.transcript.forEach((s, i) => {
      if (Math.abs(s.startMs - ms) < Math.abs(result.transcript[idx]!.startMs - ms)) idx = i;
    });
    setFocus(result.transcript.length ? idx : null);
    setTimeout(() => transcript.current?.querySelector(".media-line.focus")?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
  };
  const use = async () => {
    if (!job.resultAttachmentId) return;
    const record = await hubApi.attachment(job.resultAttachmentId);
    handOver(target, record);
    location.hash = target === "new" ? pageHash("new") : sessionHash(target);
  };
  const Stamp = ({ ms }: { ms: number }) => (
    <button type="button" class="media-stamp" onClick={() => jump(ms)} title={result.url ? "Im Video öffnen" : "Im Transkript zeigen"}>
      {formatTimestamp(ms)}
    </button>
  );
  // Ein Bindestrich im Hostnamen (CI-Runner) ist kein fremder Host. Fremd ist,
  // was nicht dieser Hub ist — dieselbe Regel wie remoteHost().
  const local = sessions.filter((s) => remoteHost(s.hostId) === null);
  return (
    <div class="media-result">
      <div class="media-use card">
        <label class="dim" for="media-target">
          Als Anhang verwenden in
        </label>
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <select id="media-target" value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)} aria-label="Ziel-Session">
            <option value="new">neuer Session</option>
            {local.slice(0, 20).map((s) => (
              <option key={s.id} value={s.id}>
                {(s.title ?? s.project.split("/").pop() ?? s.id).slice(0, 50)} · {s.adapter}
              </option>
            ))}
          </select>
          <button class="btn primary" type="button" disabled={!job.resultAttachmentId} onClick={() => void use()}>
            In Session verwenden
          </button>
        </div>
      </div>
      {result.summary && (
        <section>
          <h3>Zusammenfassung</h3>
          <p>{result.summary}</p>
          {result.keyPoints.length > 0 && (
            <ul>
              {result.keyPoints.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          )}
          <div class="dim">von {result.summaryVia}</div>
        </section>
      )}
      {result.chapters.length > 0 && (
        <section>
          <h3>Kapitel</h3>
          <ol class="media-chapters">
            {result.chapters.map((c) => (
              <li key={c.startMs}>
                <Stamp ms={c.startMs} /> <strong>{c.title}</strong> <span class="dim">{c.summary}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {result.frames.length > 0 && (
        <section>
          <h3>Schlüsselbilder ({result.frames.length})</h3>
          <div class="media-frames">
            {result.frames.map((f) => (
              <figure key={f.file} class="media-frame">
                <Frame jobId={job.id} file={f.file} alt={`Bild bei ${formatTimestamp(f.atMs)}`} />
                <figcaption>
                  <Stamp ms={f.atMs} />
                  {f.description && <div class="media-desc">Beschreibung ({f.via ?? "Modell"}, kann irren): {f.description}</div>}
                  {f.ocr && <div class="media-ocr">Text im Bild: {f.ocr.slice(0, 300)}</div>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      {result.notes.length > 0 && (
        <section class="media-notes">
          {result.notes.map((n) => (
            <div key={n} class="dim">
              ⓘ {n}
            </div>
          ))}
        </section>
      )}
      <section>
        <h3>Transkript {result.transcriptVia ? <span class="dim">· {result.transcriptVia}</span> : null}</h3>
        <div class="media-transcript" ref={transcript}>
          {result.transcript.length === 0 && <div class="dim">kein Transkript</div>}
          {result.transcript.map((s, i) => (
            <div key={i} class={`media-line ${focus === i ? "focus" : ""}`}>
              <Stamp ms={s.startMs} /> {s.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function MediaPage({ sessions }: { sessions: SessionRecord[] }) {
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [url, setUrl] = useState("");
  const [allowCloud, setAllowCloud] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem(SELECTED));
  const [result, setResult] = useState<MediaResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void hubApi.media().then(setInfo).catch((err: unknown) => setError(err instanceof Error ? err.message : "Medien nicht verfügbar"));
  }, []);
  // Poll: steps move while a job runs; the list is small and local.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      hubApi
        .mediaJobs()
        .then((list) => alive && setJobs(list))
        .catch(() => undefined);
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const current = jobs.find((j) => j.id === selected) ?? null;
  useEffect(() => {
    if (selected) sessionStorage.setItem(SELECTED, selected);
    setResult(null);
  }, [selected]);
  useEffect(() => {
    if (current?.status === "done" && (!result || result.jobId !== current.id)) void hubApi.mediaResult(current.id).then(setResult).catch(() => setResult(null));
  }, [current?.id, current?.status]);

  const started = (job: MediaJob) => {
    setJobs((j) => [job, ...j.filter((x) => x.id !== job.id)]);
    setSelected(job.id);
    setUrl("");
  };
  const submitUrl = async (e: Event) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    try {
      started(await hubApi.createMediaJob({ url: url.trim(), allowCloud, language }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };
  const pickFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      started(await hubApi.uploadMedia(file, allowCloud, language));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const can = (ok: boolean, text: string) => <span class={`chip ${ok ? "ok" : "subtle"}`}>{ok ? "✓" : "✗"} {text}</span>;
  return (
    <div class="media-page">
      <form class="card media-form" onSubmit={(e) => void submitUrl(e)}>
        <h2>Video analysieren</h2>
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <input class="media-url" type="url" inputMode="url" placeholder="YouTube- oder Video-Link" aria-label="Video-Link" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
          <button class="btn primary" type="submit" disabled={busy || !url.trim() || info?.tools.ytDlp === false}>
            {busy ? "…" : "Analysieren"}
          </button>
          <input ref={fileInput} type="file" accept="video/*,audio/*" hidden aria-label="Videodatei" onChange={(e) => void pickFile((e.target as HTMLInputElement).files)} />
          <button class="btn" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            Datei wählen
          </button>
        </div>
        <div class="row" style="gap: 12px; flex-wrap: wrap; align-items: center">
          <label>
            <input type="checkbox" checked={allowCloud} disabled={!info?.gemini} onChange={(e) => setAllowCloud((e.target as HTMLInputElement).checked)} /> Cloud (Gemini) erlauben
          </label>
          <label>
            Sprache{" "}
            <select value={language} onChange={(e) => setLanguage((e.target as HTMLSelectElement).value)} aria-label="Sprache">
              <option value="auto">automatisch</option>
              <option value="de">Deutsch</option>
              <option value="en">Englisch</option>
            </select>
          </label>
        </div>
        {info && (
          <div class="media-caps">
            {can(info.stt, "Transkript lokal")} {can(info.summary, "Zusammenfassung lokal")} {can(info.vision, "Bildbeschreibung lokal")} {can(info.gemini, "Gemini-Schlüssel")} {can(info.tools.ytDlp, "Links (yt-dlp)")}
          </div>
        )}
        {info && !info.gemini && <div class="dim">Ohne Gemini-Schlüssel (Einstellungen) bleibt alles lokal; Bilder werden dann nur per OCR gelesen.</div>}
        {error && <div class="reply-error">{error}</div>}
      </form>

      {jobs.length > 0 && (
        <div class="media-jobs">
          {jobs.map((j) => (
            <div key={j.id} class={`card media-job ${j.id === selected ? "selected" : ""}`}>
              <button type="button" class="media-job-head" onClick={() => setSelected(j.id)} aria-expanded={j.id === selected}>
                <strong>{j.title ?? j.source.name ?? j.source.url}</strong>
                <span class={`chip status-${j.status}`}>{STATUS_TEXT[j.status]}</span>
                {j.durationSec ? <span class="dim">{formatTimestamp(j.durationSec * 1000)}</span> : null}
              </button>
              {j.id === selected && (
                <>
                  <StepList job={j} />
                  {j.error && <div class="reply-error">{j.error}</div>}
                  <div class="dim media-egress">
                    Hat den Hub verlassen:{" "}
                    {j.egress.length === 0 ? "nichts" : j.egress.map((e) => `${e.service} (${MEDIA_STEP_LABELS[e.step]}${e.own ? ", eigene Hardware" : ""})`).join(" · ")}
                  </div>
                  <div class="row" style="gap: 8px">
                    {(j.status === "running" || j.status === "queued") && (
                      <button class="btn" type="button" onClick={() => void hubApi.cancelMediaJob(j.id).then((x) => setJobs((all) => all.map((y) => (y.id === x.id ? x : y))))}>
                        Abbrechen
                      </button>
                    )}
                    {j.status !== "running" && j.status !== "queued" && (
                      <button
                        class="btn subtle"
                        type="button"
                        onClick={() =>
                          void hubApi.deleteMediaJob(j.id).then(() => {
                            setJobs((all) => all.filter((y) => y.id !== j.id));
                            setSelected(null);
                          })
                        }
                      >
                        Löschen
                      </button>
                    )}
                  </div>
                  {j.status === "done" && result?.jobId === j.id && <ResultView job={j} result={result} sessions={sessions} />}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
