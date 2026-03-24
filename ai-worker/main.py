"""
Meeting Resume AI Worker
FastAPI backend for audio transcription + speaker diarization.
"""

from __future__ import annotations

import gc
import json
import logging
import os
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import threading
from typing import Generator
from collections import Counter

from dotenv import load_dotenv

# Carregar variáveis de ambiente do diretório raiz
# Como o worker está em /ai-worker, buscamos o .env em ../
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import numpy as np
import torch
import torchaudio
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sklearn.cluster import AgglomerativeClustering

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("worker")

# ---------------------------------------------------------------------------
# Compatibility patch: torchaudio ≥ 2.1 removed legacy backend helpers
# ---------------------------------------------------------------------------
_TORCHAUDIO_STUBS = {
    "list_audio_backends": lambda: ["soundfile"],
    "get_audio_backend": lambda: "soundfile",
    "set_audio_backend": lambda _: None,
}
for _name, _fn in _TORCHAUDIO_STUBS.items():
    if not hasattr(torchaudio, _name):
        setattr(torchaudio, _name, _fn)

# ---------------------------------------------------------------------------
# Windows CUDA DLL injection
# ---------------------------------------------------------------------------
if os.name == "nt":
    for _p in sys.path:
        if "site-packages" not in _p:
            continue
        _nvidia = os.path.join(_p, "nvidia")
        if not os.path.isdir(_nvidia):
            continue
        for _sub in os.listdir(_nvidia):
            _bin = os.path.join(_nvidia, _sub, "bin")
            if os.path.isdir(_bin) and _bin not in os.environ["PATH"]:
                log.debug("DLL patch — injecting %s", _bin)
                os.environ["PATH"] = _bin + os.pathsep + os.environ["PATH"]

# ---------------------------------------------------------------------------
# Lazy imports (heavy libs loaded once at startup)
# ---------------------------------------------------------------------------
import librosa  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

try:
    from speechbrain.pretrained import EncoderClassifier

    DIARIZATION_AVAILABLE = True
except ImportError:
    DIARIZATION_AVAILABLE = False
    log.warning("SpeechBrain not installed — diarization disabled.")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "large-v3-turbo")
SAMPLE_RATE = 16_000
WINDOW_SIZE_S = 1.5           # Time in seconds for each window
WINDOW_STEP_S = 0.75          # Time in seconds for the sliding overlap
DIARIZATION_MODEL_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"
DIARIZATION_SAVEDIR = "pretrained_models/spkrec-ecapa-voxceleb"
WHISPER_MODELS_DIR = os.getenv("WHISPER_MODELS_DIR", "./models")
CLUSTER_DISTANCE_THRESHOLD = 0.60  # Lowered to avoid merging distinct speakers too aggressively
DIARIZATION_ENABLED = False
_classifier = None

# ---------------------------------------------------------------------------
# Device helpers
# ---------------------------------------------------------------------------

def resolve_device(requested: str = "auto") -> str:
    if requested in ("cuda", "gpu"):
        if torch.cuda.is_available():
            return "cuda"
        log.warning("CUDA requested but not available. Falling back to CPU.")
        return "cpu"
    if requested == "cpu":
        return "cpu"
    
    # Check env before auto detection
    env_device = os.getenv("DEVICE", "auto").lower()
    if env_device in ("cuda", "gpu", "cpu"):
        if env_device != "cpu" and not torch.cuda.is_available():
            log.warning("CUDA requested via .env but not available. Falling back to auto.")
        else:
            if env_device != "cpu":
                return "cuda"
            return "cpu"

    # Auto detection: prefer CUDA
    device = "cuda" if torch.cuda.is_available() else "cpu"
    log.info(f"Hardware auto-detected: {device.upper()}")
    return device


def compute_type_for(device: str) -> str:
    # On many consumer cards (like GTX 16-series), int8 or float16 might have issues
    # depending on the ctranslate2 version. float16 is usually best for speed.
    return "float16" if device == "cuda" else "int8"

# ---------------------------------------------------------------------------
# Whisper model manager
# ---------------------------------------------------------------------------

@dataclass
class WhisperState:
    model: WhisperModel | None = None
    model_name: str = ""
    device: str = ""
    compute_type: str = ""
    lock: threading.Lock = field(default_factory=threading.Lock)

    def matches(self, model_name: str, device: str, compute_type: str) -> bool:
        return (
            self.model is not None
            and self.model_name == model_name
            and self.device == device
            and self.compute_type == compute_type
        )

    def unload(self) -> None:
        if self.model is not None:
            log.info("Unloading Whisper model (%s on %s)", self.model_name, self.device)
            del self.model
            self.model = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()


_whisper = WhisperState()


def get_whisper_model(model_name: str = DEFAULT_MODEL, device: str = "auto") -> tuple[WhisperModel, str]:
    """Return a (possibly cached) WhisperModel and the active device string."""
    device = resolve_device(device)
    ctype = compute_type_for(device)

    with _whisper.lock:
        if _whisper.matches(model_name, device, ctype):
            return _whisper.model, device

        _whisper.unload()

        log.info("Loading Whisper: model=%s device=%s compute=%s", model_name, device, ctype)
        try:
            _whisper.model = WhisperModel(
                model_name, device=device, compute_type=ctype, download_root=WHISPER_MODELS_DIR
            )
            _whisper.model_name = model_name
            _whisper.device = device
            _whisper.compute_type = ctype
        except Exception as exc:
            # If it failed on CUDA, attempt CPU fallback. If it was already on CPU, just fail.
            if device == "cuda":
                log.error("Failed to load on CUDA (%s). Trying fallback to CPU/int8: %s", ctype, exc)
                try:
                    _whisper.model = WhisperModel(
                        model_name, device="cpu", compute_type="int8", download_root=WHISPER_MODELS_DIR
                    )
                    _whisper.model_name = model_name
                    _whisper.device = "cpu"
                    _whisper.compute_type = "int8"
                    device = "cpu"
                except Exception as final_exc:
                    log.error("Critical fallback failure on CPU: %s", final_exc)
                    raise final_exc
            else:
                log.error("Failed to load on CPU: %s", exc)
                raise exc

        return _whisper.model, device

# ---------------------------------------------------------------------------
# SpeechBrain diarization
# ---------------------------------------------------------------------------

_active_diarization_device = "cpu"
_diarization_lock = threading.Lock()

def _load_diarization_model() -> None:
    global _classifier, DIARIZATION_ENABLED, _active_diarization_device
    with _diarization_lock:
        if DIARIZATION_ENABLED and _classifier is not None:
             return
        if not DIARIZATION_AVAILABLE:
            log.warning("SpeechBrain not available, skipping diarization loader.")
            return
        
        # We try CUDA first if possible
        device = resolve_device("cuda")
        log.info("Attempting to load SpeechBrain on %s …", device)
        
        try:
            _classifier = EncoderClassifier.from_hparams(
                source=DIARIZATION_MODEL_SOURCE,
                savedir=DIARIZATION_SAVEDIR,
                run_opts={"device": device},
            )
            _active_diarization_device = device
            DIARIZATION_ENABLED = True
            log.info(f"SpeechBrain loaded successfully on {device}")
        except Exception as exc:
            if device == "cuda":
                log.warning(f"Failed to load SpeechBrain on GPU, falling back to CPU: {exc}")
                try:
                    _classifier = EncoderClassifier.from_hparams(
                        source=DIARIZATION_MODEL_SOURCE,
                        savedir=DIARIZATION_SAVEDIR,
                        run_opts={"device": "cpu"},
                    )
                    _active_diarization_device = "cpu"
                    DIARIZATION_ENABLED = True
                    log.info("SpeechBrain loaded on CPU fallback.")
                except Exception as e2:
                    log.error(f"Critical failure loading SpeechBrain even on CPU: {e2}")
                    DIARIZATION_ENABLED = False
            else:
                log.error(f"SpeechBrain load failed — diarization disabled: {exc}")
                DIARIZATION_ENABLED = False


def extract_embeddings_full(audio_path: str) -> tuple[list[np.ndarray], list[tuple[float, float]]]:
    """Divide the whole audio into fixed windows and return embeddings per window."""
    if not DIARIZATION_ENABLED:
        return [], []

    try:
        signal_np, _ = librosa.load(audio_path, sr=SAMPLE_RATE)
        
        # Prevenção do erro 'Not finite': substitui NaN ou Inf no buffer por zero
        if not np.isfinite(signal_np).all():
            log.warning("Valores não-finitos (NaN/Inf) encontrados no áudio. Higienizando buffer...")
            signal_np = np.nan_to_num(signal_np, nan=0.0, posinf=0.0, neginf=0.0)
            
    except Exception as e:
        log.error("Erro ao ler %s com librosa: %s", audio_path, e)
        return [], []

    signal = torch.from_numpy(signal_np).unsqueeze(0)  # [1, T]
    total_samples = signal.shape[1]
    
    window_samples = int(WINDOW_SIZE_S * SAMPLE_RATE)
    step_samples = int(WINDOW_STEP_S * SAMPLE_RATE)

    embeddings: list[np.ndarray] = []
    intervals: list[tuple[float, float]] = []

    # Slide through the whole audio
    try:
        activity_threshold = 0.002  # Lowered from 0.005 to capture quieter speech
        if total_samples < window_samples:
            chunk = signal.to(_active_diarization_device)
            if torch.abs(chunk).mean() > activity_threshold:
                with torch.no_grad():
                    emb = _classifier.encode_batch(chunk)
                embeddings.append(emb.squeeze().cpu().numpy())
                intervals.append((0.0, total_samples / SAMPLE_RATE))
        else:
            for s in range(0, total_samples - window_samples + 1, step_samples):
                e = min(s + window_samples, total_samples)
                chunk = signal[:, s:e].to(_active_diarization_device)
                
                if torch.abs(chunk).mean() > activity_threshold:
                    if chunk.shape[1] < window_samples:
                        chunk = torch.nn.functional.pad(chunk, (0, window_samples - chunk.shape[1]))
                    
                    with torch.no_grad():
                        emb = _classifier.encode_batch(chunk)
                    embeddings.append(emb.squeeze().cpu().numpy())
                    intervals.append((s / SAMPLE_RATE, e / SAMPLE_RATE))
    except Exception as exc:
        # Emergency runtime fallback to CPU if GPU memory or CUDA error occurs during processing
        if _active_diarization_device == "cuda":
            log.error(f"Runtime GPU error in diarization: {exc}. Retrying segment on CPU...")
            # We don't retry the whole loop easily here, but for the next run it will be safer.
            # In a real app, you might want to re-run this function with CPU.
            raise exc
        else:
            raise exc

    return embeddings, intervals


def cluster_speakers(embeddings: list[np.ndarray]) -> list[int]:
    """Assign a speaker label to each embedding."""
    if len(embeddings) < 2:
        return [0] * len(embeddings)

    # Normalize embeddings to unit length for better cosine similarity performance
    X = np.array(embeddings)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    X = X / (norms + 1e-6)

    # Use AgglomerativeClustering with a more robust distance threshold
    clustering = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=CLUSTER_DISTANCE_THRESHOLD,
        metric="cosine",
        linkage="average",
    )
    
    labels = clustering.fit_predict(X).tolist()

    # --- Noise / Ghost Speaker Filtering ---
    # In a typical meeting, everyone talks at least a little bit.
    # If a cluster has only 1 or 2 chunks (e.g. < 3% of the meeting duration),
    # it's usually someone laughing, a slammed door, or mic noise.
    total_elements = len(labels)
    # Consider "major" speakers as anyone talking for at least 3% of the time,
    # or at least 2 chunks minimum so we don't treat brief input as valid.
    min_cluster_size = max(2, int(total_elements * 0.03)) 
    
    counts = Counter(labels)
    valid_clusters = [lbl for lbl, count in counts.items() if count >= min_cluster_size]
    
    # If everyone is valid, or NO one is valid (very short clip), skip filtering.
    if valid_clusters and len(valid_clusters) < len(counts):
        log.info(f"Filtering {len(counts) - len(valid_clusters)} 'ghost/noise' speakers.")
        
        # Calculate the mean embedding of each valid cluster to find the closest match
        valid_means = {}
        for v_lbl in valid_clusters:
            v_idx = [i for i, l in enumerate(labels) if l == v_lbl]
            valid_means[v_lbl] = X[v_idx].mean(axis=0)

        # Re-assign invalid speakers to the nearest valid speaker
        for i, lbl in enumerate(labels):
            if lbl not in valid_clusters:
                best_lbl = valid_clusters[0]
                best_sim = -float('inf')
                
                for v_lbl, v_mean in valid_means.items():
                    # X[i] and v_mean are normalized, so dot product is cosine similarity
                    sim = np.dot(X[i], v_mean)
                    if sim > best_sim:
                        best_sim = sim
                        best_lbl = v_lbl
                        
                labels[i] = best_lbl

    # Re-index labels continuously (e.g. 0, 2, 4 -> 0, 1, 2)
    new_labels = []
    label_map = {}
    for lbl in labels:
        if lbl not in label_map:
            label_map[lbl] = len(label_map)
        new_labels.append(label_map[lbl])

    return new_labels

# ---------------------------------------------------------------------------
# Progress tracking
# ---------------------------------------------------------------------------
_STAGE_WEIGHTS = {"transcription": 0.70, "diarization": 0.15, "summarization": 0.15}

@dataclass
class ProgressState:
    stages: dict[str, int] = field(default_factory=lambda: {k: 0 for k in _STAGE_WEIGHTS})
    status: str = "Pronto"
    current_text: str = ""
    last_update: float = field(default_factory=time.time)
    progress: int = 0
    cancel_requested: bool = False

    def update_stage(self, stage: str, value: int, status: str | None = None) -> None:
        if stage in self.stages:
            self.stages[stage] = value
        if status:
            self.status = status
        self._refresh()

    def reset(self) -> None:
        self.stages = {k: 0 for k in _STAGE_WEIGHTS}
        self.status = "Iniciando..."
        self.current_text = ""
        self.progress = 0
        self.cancel_requested = False
        self._refresh()

    def _refresh(self) -> None:
        self.progress = min(100, int(sum(self.stages[k] * w for k, w in _STAGE_WEIGHTS.items())))
        self.last_update = time.time()

    def as_dict(self) -> dict:
        return {
            "stages": self.stages,
            "status": self.status,
            "current_text": self.current_text,
            "last_update": self.last_update,
            "progress": self.progress,
        }


_progress = ProgressState()

# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    _load_diarization_model()
    yield


app = FastAPI(title="Meeting Resume AI Worker", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routes — progress / control
# ---------------------------------------------------------------------------

@app.get("/progress")
def get_progress() -> dict:
    return _progress.as_dict()


@app.get("/status")
def get_status() -> dict:
    import torch
    cuda_available = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if cuda_available else None
    
    return {
        "status": "ready",
        "cuda_available": cuda_available,
        "gpu_name": gpu_name,
        "device": "cuda" if cuda_available else "cpu",
        "platform": sys.platform,
        "diarization_enabled": DIARIZATION_ENABLED
    }


@app.post("/update-progress")
def update_external_progress(data: dict) -> dict:
    _progress.update_stage(
        stage=data.get("stage", ""),
        value=int(data.get("value", 0)),
        status=data.get("status"),
    )
    return {"status": "ok"}


@app.post("/cancel")
def cancel_processing() -> dict:
    _progress.cancel_requested = True
    return {"status": "cancelled"}

# ---------------------------------------------------------------------------
# Transcription helpers
# ---------------------------------------------------------------------------

def _run_transcription(
    model: WhisperModel,
    audio_path: str,
    use_cpu_label: bool = False,
) -> Generator[any, None, None]:
    """Run faster-whisper and stream segments while updating progress."""
    segments_gen, info = model.transcribe(
        audio_path,
        beam_size=5,
        language="pt",
        condition_on_previous_text=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        word_timestamps=True,
    )

    label = "CPU" if use_cpu_label else ""
    suffix = f" ({label})" if label else ""

    for seg in segments_gen:
        if _progress.cancel_requested:
            return
        
        if info.duration > 0:
            pct = min(100, int(seg.end / info.duration * 100))
            _progress.update_stage("transcription", pct, f"Transcrevendo{suffix}… {pct}%")
        
        _progress.current_text += (seg.text.strip() + " ")
        yield seg


def _build_diarized_text(segments: list, labels: list[int]) -> str:
    """Merge consecutive same-speaker segments into labelled blocks."""
    lines: list[str] = []
    current_speaker: str | None = None
    current_text: list[str] = []

    for seg, label in zip(segments, labels):
        speaker = f"Pessoa {label + 1}"
        if speaker == current_speaker:
            current_text.append(seg.text.strip())
        else:
            if current_speaker is not None:
                lines.append(f"**{current_speaker}:** {' '.join(current_text)}")
            current_speaker = speaker
            current_text = [seg.text.strip()]

    if current_speaker:
        lines.append(f"**{current_speaker}:** {' '.join(current_text)}")

    return "\n\n".join(lines)

# ---------------------------------------------------------------------------
# Routes — transcription
# ---------------------------------------------------------------------------

@app.post("/transcribe")
def transcribe(
    file: UploadFile = File(...),
    model_name: str = DEFAULT_MODEL,
    device: str = "auto",
) -> StreamingResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")

    suffix = os.path.splitext(file.filename)[1] or ".tmp"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    return StreamingResponse(
        _process_audio(tmp_path, file.filename, model_name, device),
        media_type="application/json",
    )


def _process_audio(
    tmp_path: str,
    filename: str,
    model_name: str,
    device: str,
) -> Generator[str, None, None]:
    # Yield an initial space to send headers immediately and prevent UND_ERR_HEADERS_TIMEOUT
    yield " "
    
    # 0. On-demand diarization load if it missed the startup call
    if not DIARIZATION_ENABLED and DIARIZATION_AVAILABLE:
        log.info("Diarization engine was not ready — attempting JIT load...")
        _load_diarization_model()
    
    start_time = time.time()
    try:
        # --- Load model ---
        try:
            active_model, active_device = get_whisper_model(model_name, device)
        except Exception as exc:
            log.error("Model load error, falling back to CPU: %s", exc)
            active_model, active_device = get_whisper_model(model_name, "cpu")

        _progress.reset()
        _progress.status = f"Iniciando… ({model_name} em {active_device})"
        log.info("Processing: %s", filename)

        # --- Transcription ---
        try:
            segments = []
            # We iterate over the segments generator and yield a space for keep-alive
            for seg in _run_transcription(active_model, tmp_path):
                segments.append(seg)
                yield " " # Keep-alive after each segment
                
        except RuntimeError as exc:
            _is_gpu_error = any(k in str(exc).lower() for k in ("cublas", "cudnn"))
            if _is_gpu_error:
                log.warning("GPU error — retrying on CPU: %s", exc)
                active_model, active_device = get_whisper_model(model_name, "cpu")
                segments = []
                for seg in _run_transcription(active_model, tmp_path, use_cpu_label=True):
                    segments.append(seg)
                    yield " "
            else:
                raise

        if _progress.cancel_requested:
            yield json.dumps({"text": "", "status": "cancelled"})
            return

        _progress.update_stage("transcription", 100)
        yield " "

        if not segments:
            yield json.dumps({"text": "", "language": "pt", "duration": 0})
            return

        # --- Diarization (Integrated Approach) ---
        if DIARIZATION_ENABLED:
            _progress.update_stage("diarization", 10, "Mapeando vozes no tempo…")
            yield " "
            
            # 1. Map all voices across the entire audio first
            full_embeddings, window_intervals = extract_embeddings_full(tmp_path)
            yield " "
            
            if full_embeddings:
                window_labels = cluster_speakers(full_embeddings)
                yield " "
                
                # 2. Assign speaker to each Whisper segment by "majority vote" of windows covering it
                labels = []
                for seg in segments:
                    # Find all windows that overlap with this segment
                    overlapping_speakers = []
                    for (w_start, w_end), w_label in zip(window_intervals, window_labels):
                        # Simple overlap check
                        if w_start < seg.end and w_end > seg.start:
                            overlapping_speakers.append(w_label)
                    
                    if overlapping_speakers:
                        # Pick most common speaker ID in that range
                        labels.append(max(set(overlapping_speakers), key=overlapping_speakers.count))
                    else:
                        # Fallback to nearest or just Pessoa 0 if gap
                        labels.append(labels[-1] if labels else 0)
                
                final_text = _build_diarized_text(segments, labels)
            else:
                final_text = " ".join(s.text.strip() for s in segments)
                
            _progress.current_text = final_text
            _progress.update_stage("diarization", 100)
            yield " "
        else:
            log.warning("Diarization is DISABLED. Skipping speaker identification.")
            final_text = " ".join(s.text.strip() for s in segments)
            _progress.current_text = final_text
            labels = [] # Fallback for metadata

        # --- Retrieve duration ---
        duration = segments[-1].end if segments else 0.0

        elapsed = time.time() - start_time
        log.info("Done in %.2fs", elapsed)
        _progress.update_stage("summarization", 0, "Finalizado")
        yield " "

        # Calculate metadata
        word_count = len(final_text.split())
        num_speakers = len(set(labels)) if 'labels' in locals() and labels else 1
        
        # Calculate speaker stats (seconds spent talking)
        speaker_stats = {}
        if 'labels' in locals() and labels:
            for seg, label in zip(segments, labels):
                name = f"Pessoa {label + 1}"
                speaker_stats[name] = speaker_stats.get(name, 0.0) + (seg.end - seg.start)
        
        # Round the values
        speaker_stats = {k: round(v, 2) for k, v in speaker_stats.items()}

        # --- Structure result for playback synchronization ---
        timed_segments = []
        if 'labels' in locals() and labels:
            for seg, label in zip(segments, labels):
                speaker_name = f"Pessoa {label + 1}"
                
                # Format words for this segment
                segment_words = []
                if seg.words:
                    for w in seg.words:
                        segment_words.append({
                            "word": w.word,
                            "start": round(w.start, 2),
                            "end": round(w.end, 2)
                        })

                timed_segments.append({
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "speaker": speaker_name,
                    "text": seg.text.strip(),
                    "words": segment_words
                })
        else:
            # Fallback for no diarization
            for seg in segments:
                timed_segments.append({
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "speaker": "Participante",
                    "text": seg.text.strip(),
                    "words": [{"word": w.word, "start": round(w.start, 2), "end": round(w.end, 2)} for w in (seg.words or [])]
                })

        yield json.dumps({
            "text": final_text.strip(),
            "language": "pt",
            "duration": round(duration, 2),
            "processing_time": round(elapsed, 2),
            "num_speakers": num_speakers,
            "speaker_stats": speaker_stats,
            "word_count": word_count,
            "char_count": len(final_text),
            "segments": timed_segments, # Added for synchronized highlighting
        })

    except Exception as exc:
        log.exception("Processing error: %s", exc)
        yield json.dumps({"error": str(exc), "status": "failed"})

    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("WORKER_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)