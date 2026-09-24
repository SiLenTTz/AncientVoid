#!/usr/bin/env python3
"""T10.6: local speech-to-text candidates on German developer dictation.

Every engine is loaded once (warm), then transcribes the same WAV files
(16 kHz mono). Reported per engine: WER, share of domain terms recognised,
median/p90 latency per utterance and real-time factor.

    python bench.py --audio DIR --refs refs.tsv --engines whisper.cpp:large-v3-turbo-q5_0,faster:large-v3-turbo,onnx:nemo-parakeet-tdt-0.6b-v3 --out results.json

refs.tsv: id <TAB> text <TAB> terms (|-separated, may be empty).
"""
import argparse
import json
import re
import statistics
import subprocess
import time
import unicodedata
import urllib.request
from pathlib import Path

import jiwer
import soundfile as sf


def norm(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).lower()
    t = re.sub(r"[-_/]", " ", t)
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


NUMBERS = {"eins": "1", "zwei": "2", "drei": "3", "vier": "4", "fünf": "5", "sechs": "6", "sieben": "7", "acht": "8", "neun": "9", "zehn": "10", "zwanzig": "20", "dreißig": "30", "vierzig": "40", "fünfzig": "50", "hundert": "100"}


def squash(text: str) -> str:
    """For term matching: spaces/hyphens out, number words as digits (5 = fünf)."""
    t = norm(text)
    for word, digit in NUMBERS.items():
        t = re.sub(rf"\b{word}\b", digit, t)
    return re.sub(r"[\s-]", "", t)


# Words a developer dictates; a Whisper prompt biases towards their spelling.
VOCAB = "UACC, Session, Codex, Claude, opencode, TypeScript, JavaScript, Vitest, pytest, npm, pnpm, Pull Request, Branch, main, Rebase, Merge, Commit, Push, Worktree, Git Status, Diff, Build, Deploy, Logs, Cache, Cloud, Adapter, Hub, Tailnet, PWA, API, WebSocket, Service Worker, Docker, Container, llama.cpp, Gatekeeper, Readme, Doku, Kontingent, Unit-Test, Bug, Refactoring. mobile-hub"


class WhisperCpp:
    """whisper-server (Vulkan) — one process per model, HTTP per utterance."""

    def __init__(self, model: str, root: Path, port: int = 8093):
        self.prompt = model.endswith("+prompt")
        model = model.removesuffix("+prompt")
        self.name = f"whisper.cpp {model} (Vulkan){' + Vokabular' if self.prompt else ''}"
        binary = root / "whisper.cpp/build/bin/whisper-server"
        self.proc = subprocess.Popen(
            [str(binary), "-m", str(root / f"models/ggml-{model}.bin"), "-l", "de", "--host", "127.0.0.1", "--port", str(port), "-t", "8"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.url = f"http://127.0.0.1:{port}/inference"
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1)
                break
            except Exception:
                time.sleep(0.5)

    def transcribe(self, wav: Path) -> str:
        boundary = "----uacc"
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n",
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nde\r\n",
        ]
        if self.prompt:
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n{VOCAB}\r\n")
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n")
        body = "".join(parts).encode() + wav.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        return json.loads(urllib.request.urlopen(req, timeout=120).read())["text"]

    def close(self):
        self.proc.terminate()


class Faster:
    def __init__(self, model: str):
        from faster_whisper import WhisperModel

        repo = {"large-v3-turbo": "deepdml/faster-whisper-large-v3-turbo-ct2"}.get(model, model)
        self.name = f"faster-whisper {model} (CPU int8)"
        self.m = WhisperModel(repo, device="cpu", compute_type="int8", cpu_threads=16)

    def transcribe(self, wav: Path) -> str:
        segs, _ = self.m.transcribe(str(wav), language="de", beam_size=1, vad_filter=False)
        return " ".join(s.text for s in segs)

    def close(self):
        pass


ONNX_REPOS = {"nemo-parakeet-tdt-0.6b-v3": "istupakov/parakeet-tdt-0.6b-v3-onnx", "nemo-canary-1b-v2": "istupakov/canary-1b-v2-onnx"}


class Onnx:
    def __init__(self, model: str, root: Path):
        import onnx_asr
        from huggingface_hub import snapshot_download

        self.name = f"{model} (onnx-asr, CPU)"
        # A real directory: onnxruntime refuses external data behind HF cache symlinks.
        local = root / "onnx" / model
        snapshot_download(ONNX_REPOS[model], local_dir=str(local))
        self.m = onnx_asr.load_model(model, str(local))
        self.model = model

    def transcribe(self, wav: Path) -> str:
        out = self.m.recognize(str(wav), language="de") if "canary" in self.model else self.m.recognize(str(wav))
        return out if isinstance(out, str) else str(out)

    def close(self):
        pass


def make(spec: str, root: Path):
    kind, _, model = spec.partition(":")
    if kind == "whisper.cpp":
        return WhisperCpp(model, root)
    if kind == "faster":
        return Faster(model)
    if kind == "onnx":
        return Onnx(model, root)
    raise SystemExit(f"unknown engine {spec}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--refs", required=True)
    ap.add_argument("--engines", required=True)
    ap.add_argument("--root", default=str(Path.home() / "uacc-stt"))
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    refs = []
    for line in Path(args.refs).read_text(encoding="utf-8").splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) >= 2:
            refs.append((parts[0], parts[1], [t for t in (parts[2] if len(parts) > 2 else "").split("|") if t]))
    audio = Path(args.audio)
    results = []
    for spec in args.engines.split(","):
        try:
            engine = make(spec, Path(args.root))
        except Exception as err:
            print(json.dumps({"engine": spec, "error": str(err)[:300]}), flush=True)
            results.append({"engine": spec, "error": str(err)[:300]})
            continue
        try:
            engine.transcribe(audio / f"{refs[0][0]}.wav")  # warm-up
            hyps, lat, dur, terms_ok, terms_all = [], [], 0.0, 0, 0
            for rid, text, terms in refs:
                wav = audio / f"{rid}.wav"
                info = sf.info(str(wav))
                dur += info.duration
                t0 = time.perf_counter()
                hyp = engine.transcribe(wav)
                lat.append(time.perf_counter() - t0)
                hyps.append(hyp)
                for term in terms:
                    terms_all += 1
                    terms_ok += squash(term) in squash(hyp)
            wer = jiwer.wer([norm(r[1]) for r in refs], [norm(h) for h in hyps])
            lat.sort()
            results.append(
                {
                    "engine": engine.name,
                    "utterances": len(refs),
                    "wer": round(wer, 4),
                    "terms": f"{terms_ok}/{terms_all}" if terms_all else None,
                    "termRate": round(terms_ok / terms_all, 4) if terms_all else None,
                    "latencyMedianMs": round(statistics.median(lat) * 1000),
                    "latencyP90Ms": round(lat[int(0.9 * (len(lat) - 1))] * 1000),
                    "rtf": round(sum(lat) / dur, 4),
                    "samples": [{"id": r[0], "ref": r[1], "hyp": h.strip()} for r, h in list(zip(refs, hyps))[:6]],
                }
            )
            print(json.dumps(results[-1], ensure_ascii=False)[:400], flush=True)
            Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as err:  # one engine failing must not hide the others
            print(json.dumps({"engine": spec, "error": str(err)[:300]}), flush=True)
            results.append({"engine": spec, "error": str(err)[:300]})
        finally:
            engine.close()
    Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
