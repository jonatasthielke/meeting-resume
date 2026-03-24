"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Upload, FileAudio, FileText, BrainCircuit, Loader2, Mic, StopCircle,
  RefreshCw, Layers, ChevronRight, Calendar, Users, Clock, CheckCircle2,
  AlertCircle, Sparkles, Cpu, Zap, XCircle, Copy, Download, Edit3, Check,
  Play, Pause, Volume2, ListChecks, History, Trash2, ArrowLeft, ExternalLink,
  Settings2, ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";

interface Segment {
  start: number;
  end: number;
  speaker: string;
  text: string;
  words: Array<{ word: string, start: number, end: number }>;
}

interface MeetingResult {
  transcription: string;
  summary: string;
  num_speakers?: number;
  word_count?: number;
  duration?: number;
  processing_time?: number;
  speaker_stats?: Record<string, number>;
  segments?: Segment[];
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<"upload" | "live">("upload");
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [copiedStage, setCopiedStage] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressStatus, setProgressStatus] = useState("Aguardando...");
  const [progressValue, setProgressValue] = useState(0);
  const [stages, setStages] = useState({ transcription: 0, diarization: 0, summarization: 0 });
  const [previewText, setPreviewText] = useState("");
  const [results, setResults] = useState<MeetingResult | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const [settings, setSettings] = useState({
    transcriptionModel: "large-v3-turbo",
    summarizationModel: "qwen3:4b",
    device: "auto"
  });
  const [workerStatus, setWorkerStatus] = useState<any>(null);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState("");
  const [actionItems, setActionItems] = useState<Array<{ text: string, checked: boolean, id: string }>>([]);
  const [newTaskText, setNewTaskText] = useState("");
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [tempName, setTempName] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("meeting_history");
    if (saved) setHistory(JSON.parse(saved));

    const checkStatus = async () => {
      try {
        const res = await fetch("http://localhost:8000/status");
        if (res.ok) setWorkerStatus(await res.json());
      } catch (e) { }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (results?.speaker_stats) {
      const initialNames: Record<string, string> = {};
      Object.keys(results.speaker_stats).forEach(key => {
        initialNames[key] = key;
      });
      setSpeakerNames(initialNames);
    }
  }, [results]);

  const saveToHistory = (newResult: any) => {
    const updated = [
      { ...newResult, timestamp: new Date().toISOString(), id: Date.now() },
      ...history.slice(0, 9)
    ];
    setHistory(updated);
    localStorage.setItem("meeting_history", JSON.stringify(updated));
  };

  const loadFromHistory = (item: any) => {
    setResults(item);
    extractActionItems(item.summary);
    setShowHistory(false);
  };

  const deleteHistoryItem = (id: number) => {
    const updated = history.filter(item => item.id !== id);
    setHistory(updated);
    localStorage.setItem("meeting_history", JSON.stringify(updated));
  };

  const copyToClipboard = async (text: string, stage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStage(stage);
      setTimeout(() => setCopiedStage(null), 2000);
    } catch (err) { console.error(err); }
  };

  const exportToMarkdown = () => {
    if (!results) return;
    let content = `# Reunião - ${new Date().toLocaleDateString()}\n\n`;
    content += `## 📊 Resumo da IA\n\n${displaySummary}\n\n`;
    content += `## 📝 Transcrição Completa\n\n${displayTranscription}\n`;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting_resume_${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setResults(null);
      setAudioUrl(URL.createObjectURL(selectedFile));
      setActionItems([]);
    }
  };

  const handleCancel = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    try {
      await fetch("http://localhost:8000/cancel", { method: "POST" });
    } catch (e) { }
    setLoading(false);
    setProgressStatus("Cancelado");
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setResults(null);
    setPreviewText("");
    setStages({ transcription: 0, diarization: 0, summarization: 0 });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const progressInterval = setInterval(async () => {
      try {
        const res = await fetch("http://localhost:8000/progress");
        if (res.ok) {
          const data = await res.json();
          setProgressStatus(data.status);
          setProgressValue(data.progress || 0);
          if (data.stages) setStages(data.stages);
          if (data.current_text) setPreviewText(data.current_text);
        }
      } catch (e) { }
    }, 800);

    const formData = new FormData();
    formData.append("audio", file);
    formData.append("modelTranscription", settings.transcriptionModel);
    formData.append("modelSummary", settings.summarizationModel);
    formData.append("device", settings.device);

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
        signal: abortController.signal
      });
      if (!response.ok) throw new Error("Falha ao processar");
      const data = await response.json();
      setResults(data);
      saveToHistory(data);
      extractActionItems(data.summary);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setProgressStatus("Cancelado pelo usuário");
      }
    } finally {
      clearInterval(progressInterval);
      setLoading(false);
      setProgressValue(0);
      abortControllerRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start(1000);
      setIsRecording(true);
      setLiveTranscription("");
      setResults(null);

      intervalRef.current = setInterval(async () => {
        if (audioChunksRef.current.length === 0) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("audio", audioBlob);

        try {
          const response = await fetch("/api/process?type=transcription-only", { method: "POST", body: formData });
          if (response.ok) {
            const data = await response.json();
            setLiveTranscription(data.transcription);
          }
        } catch (err) { }
      }, 10000);
    } catch (err) {
      alert("Microfone não acessível!");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    if (intervalRef.current) clearInterval(intervalRef.current);

    setIsRecording(false);
    setLoading(true);
    setProgressStatus("Gerando resumo final...");

    setTimeout(async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("audio", audioBlob);
      formData.append("modelTranscription", settings.transcriptionModel);
      formData.append("modelSummary", settings.summarizationModel);
      formData.append("device", settings.device);

      try {
        const response = await fetch("/api/process", { method: "POST", body: formData });
        const data = await response.json();
        setResults(data);
        setAudioUrl(URL.createObjectURL(audioBlob));
        saveToHistory(data);
        extractActionItems(data.summary);
      } catch (err) {
        alert("Erro no resumo final.");
      } finally {
        setLoading(false);
      }
    }, 500);
  };

  const extractActionItems = (summary: string) => {
    if (!summary) return;
    const lines = summary.split('\n');
    const items: Array<{ text: string, checked: boolean, id: string }> = [];
    let inSection = false;

    lines.forEach(line => {
      const isHeader = /#|Checklist|Decisões|Próximos Passos|Action Items/i.test(line);
      if (isHeader) inSection = true;
      else if (inSection && line.startsWith('## ')) inSection = false;
      else if (inSection && (line.trim().startsWith('-') || line.trim().startsWith('*') || line.includes('[ ]'))) {
        const cleanText = line.replace(/^([-*]|\[ \])\s*/, '').replace(/\[ \]/g, '').trim();
        if (cleanText.length > 3) {
          items.push({ text: cleanText, checked: false, id: Math.random().toString(36).substr(2, 9) });
        }
      }
    });
    if (items.length > 0) setActionItems(items);
  };

  const handleRenameSpeaker = (originalId: string) => {
    if (tempName.trim()) {
      setSpeakerNames(prev => ({ ...prev, [originalId]: tempName.trim() }));
    }
    setEditingSpeaker(null);
  };

  const getProcessedText = (originalText: string) => {
    let text = originalText || "";
    Object.entries(speakerNames).forEach(([id, name]) => {
      if (id !== name) {
        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`\\*\\*${escapedId}:\\*\\*`, 'g'), `**${name}:**`);
        text = text.replace(new RegExp(`${escapedId}:`, 'g'), `${name}:`);
      }
    });
    return text;
  };

  const displayTranscription = getProcessedText(results?.transcription || previewText || liveTranscription);
  const displaySummary = getProcessedText(results?.summary || "");

  const groupedSegments = useMemo(() => {
    if (!results?.segments) return [];
    return results.segments.reduce((acc: any[], current) => {
      if (acc.length > 0 && acc[acc.length - 1].speaker === current.speaker) {
        acc[acc.length - 1].words = [...acc[acc.length - 1].words, ...current.words];
        acc[acc.length - 1].end = current.end;
        acc[acc.length - 1].text += " " + current.text;
      } else acc.push({ ...current });
      return acc;
    }, []);
  }, [results?.segments]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-indigo-500/30 selection:text-white">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-5%] left-[-5%] w-[45%] h-[45%] bg-indigo-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[45%] h-[45%] bg-emerald-600/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-[1400px] mx-auto px-6 py-8 lg:py-12">
        <header className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12">
          <div className="flex items-center gap-5">
            <div className="p-3.5 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl shadow-2xl shadow-indigo-500/20">
              <BrainCircuit className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white">
                Meeting<span className="text-indigo-500">Resume</span>
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20">
                  <CheckCircle2 size={12} /> PRIVADO
                </span>
                <button onClick={() => setShowHistory(true)} className="text-[10px] font-bold text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition-colors">
                  <History size={12} /> VER HISTÓRICO
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex bg-slate-900/50 border border-slate-800 rounded-2xl p-1.5 backdrop-blur-md">
              {["upload", "live"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab as any); setResults(null); }}
                  className={`relative px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === tab ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {activeTab === tab && (
                    <motion.div layoutId="activeTab" className="absolute inset-0 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-600/20" />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    {tab === "upload" ? <Upload size={16} /> : <Mic size={16} />}
                    {tab === "upload" ? "Arquivo" : "Ao Vivo"}
                  </span>
                </button>
              ))}
            </div>

            {results && (
              <button
                onClick={exportToMarkdown}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600 hover:text-white transition-all border border-emerald-500/20"
              >
                <Download size={16} /> Exportar
              </button>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <aside className="lg:col-span-4 space-y-6">
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-[32px] p-8 shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  {loading ? <Loader2 className="animate-spin text-indigo-400" size={20} /> : <Zap className="text-indigo-400" size={20} />}
                  Processamento
                </h2>
                <div className="px-3 py-1 bg-slate-950 rounded-full border border-slate-800 text-[10px] font-mono text-slate-500">
                  {workerStatus?.gpu_name?.split(' ')[0] || "CPU-Only"}
                </div>
              </div>

              {activeTab === "upload" ? (
                <div className="space-y-6">
                  <div className="group relative border-2 border-dashed border-slate-700 hover:border-indigo-500/50 rounded-[24px] p-10 transition-all bg-slate-950/30 flex flex-col items-center justify-center gap-4 cursor-pointer">
                    <input type="file" accept="audio/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                    <div className="p-4 bg-slate-800 rounded-full text-slate-400 group-hover:scale-110 group-hover:bg-indigo-500/20 group-hover:text-indigo-400 transition-all">
                      <FileAudio size={32} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-slate-200">{file ? file.name : "Selecione o Áudio"}</p>
                      <p className="text-xs text-slate-500 mt-1">Formatos aceitos: MP3, WAV, M4A</p>
                    </div>
                  </div>

                  {loading ? (
                    <div className="space-y-4">
                      <button onClick={handleCancel} className="w-full py-4 bg-red-500/10 text-red-500 rounded-2xl text-xs font-bold border border-red-500/20 hover:bg-red-500 hover:text-white transition-all flex justify-center items-center gap-2">
                        <XCircle size={16} /> CANCELAR OPERAÇÃO
                      </button>
                      <div className="space-y-4 p-4 bg-slate-950/50 rounded-2xl border border-slate-800">
                        <p className="text-xs text-center text-slate-400 font-medium mb-2">{progressStatus}</p>
                        <StageProgress label="Transcrição" value={stages.transcription} />
                        <StageProgress label="Diarização" value={stages.diarization} />
                        <StageProgress label="Resumo" value={stages.summarization} />
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleUpload}
                      disabled={!file}
                      className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-[20px] font-black tracking-wide shadow-xl shadow-indigo-600/20 transition-all flex items-center justify-center gap-3"
                    >
                      <Sparkles size={20} /> PROCESSAR AGORA
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center py-6 space-y-8">
                  <div className="relative">
                    {isRecording && <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping" />}
                    <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${isRecording ? "bg-red-500 shadow-lg shadow-red-500/40" : "bg-slate-800"}`}>
                      {isRecording ? <StopCircle size={40} className="text-white" /> : <Mic size={40} className="text-slate-400" />}
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-white">{isRecording ? "Gravando..." : "Pronto para Gravar"}</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-[200px]">A gravação é processada localmente e nunca sai do seu computador.</p>
                  </div>
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={loading}
                    className={`w-full py-5 rounded-[20px] font-black text-sm tracking-widest transition-all flex justify-center items-center gap-2 ${loading ? "bg-slate-800 text-slate-500" : isRecording ? "bg-red-600 hover:bg-red-500 text-white shadow-red-600/20 shadow-lg" : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 shadow-lg"}`}
                  >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : isRecording ? "FINALIZAR REUNIÃO" : "INICIAR AGORA"}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-slate-900/20 border border-slate-800 rounded-[24px] overflow-hidden">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="w-full px-6 py-4 flex items-center justify-between text-slate-400 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest">
                  <Settings2 size={14} /> Configurações de IA
                </div>
                <ChevronDown size={16} className={`transition-transform ${showSettings ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                    className="px-6 pb-6 space-y-4"
                  >
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Whisper Model</label>
                      <select value={settings.transcriptionModel} onChange={e => setSettings({ ...settings, transcriptionModel: e.target.value })} disabled={loading} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs outline-none focus:border-indigo-500">
                        <option value="base">Base (Rápido)</option>
                        <option value="medium">Medium (Equilibrado)</option>
                        <option value="large-v3-turbo">Turbo v3 (Recomendado)</option>
                        <option value="large-v3">Large v3 (Qualidade Máxima)</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">LLM Local (Ollama)</label>
                      <select value={settings.summarizationModel} onChange={e => setSettings({ ...settings, summarizationModel: e.target.value })} disabled={loading} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs outline-none focus:border-indigo-500">
                        <option value="qwen3:4b">Qwen 3 4B</option>
                        <option value="llama3.2:3b">Llama 3.2 3B</option>
                        <option value="mistral:latest">Mistral</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Hardware</label>
                      <select value={settings.device} onChange={e => setSettings({ ...settings, device: e.target.value })} disabled={loading} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs outline-none focus:border-indigo-500">
                        <option value="auto">Auto (GPU preferencial)</option>
                        <option value="cuda">Apenas GPU</option>
                        <option value="cpu">Apenas CPU</option>
                      </select>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </aside>

          <section className="lg:col-span-8 space-y-6">
            <AnimatePresence mode="wait">
              {results || loading || isRecording ? (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

                  {audioUrl && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-2 bg-slate-900/60 border border-slate-800 rounded-[24px] p-6 backdrop-blur-xl">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => {
                              if (audioRef.current?.paused) { audioRef.current.play(); setIsPlaying(true); }
                              else { audioRef.current?.pause(); setIsPlaying(false); }
                            }}
                            className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-white shadow-lg hover:scale-105 transition-all"
                          >
                            {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
                          </button>
                          <div className="flex-1 space-y-2">
                            <div className="flex justify-between text-[10px] font-mono text-slate-500">
                              <span>{Math.floor(audioCurrentTime / 60)}:{(audioCurrentTime % 60).toFixed(0).padStart(2, '0')}</span>
                              <span className="text-indigo-400 font-bold uppercase">Player de Reunião</span>
                              <span>{Math.floor(audioDuration / 60)}:{(audioDuration % 60).toFixed(0).padStart(2, '0')}</span>
                            </div>
                            <div
                              className="h-2 w-full bg-slate-950 rounded-full overflow-hidden cursor-pointer group"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const pct = (e.clientX - rect.left) / rect.width;
                                if (audioRef.current) audioRef.current.currentTime = pct * audioDuration;
                              }}
                            >
                              <div className="h-full bg-indigo-500 transition-all duration-100 relative" style={{ width: `${audioProgress}%` }}>
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full scale-0 group-hover:scale-100 transition-transform" />
                              </div>
                            </div>
                          </div>
                        </div>
                        <audio
                          ref={audioRef} src={audioUrl} className="hidden"
                          onPlay={() => setIsPlaying(true)}
                          onPause={() => setIsPlaying(false)}
                          onEnded={() => setIsPlaying(false)}
                          onTimeUpdate={() => {
                            if (audioRef.current) {
                              setAudioCurrentTime(audioRef.current.currentTime);
                              setAudioProgress((audioRef.current.currentTime / audioDuration) * 100);
                            }
                          }}
                          onLoadedMetadata={() => setAudioDuration(audioRef.current?.duration || 0)}
                        />
                      </div>

                      {results && results.word_count !== undefined && (
                        <div className="grid grid-cols-2 gap-3">
                          <StatBlock icon={<Users size={14} />} label="Participantes" value={results.num_speakers || 0} color="text-indigo-400" />
                          <StatBlock icon={<FileText size={14} />} label="Palavras" value={results.word_count.toLocaleString()} color="text-emerald-400" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-slate-900/40 border border-slate-800 rounded-[32px] flex flex-col shadow-2xl overflow-hidden">
                      <div className="px-8 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/20">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 flex items-center gap-2">
                          <BrainCircuit size={14} /> Resumo IA
                        </span>
                        {results && (
                          <button onClick={() => copyToClipboard(displaySummary, 's')} className="text-slate-500 hover:text-white transition-colors">
                            {copiedStage === 's' ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                          </button>
                        )}
                      </div>
                      <div className="p-8 overflow-y-auto max-h-[600px] custom-scrollbar prose prose-invert prose-indigo prose-sm max-w-none">
                        {loading && activeTab === "live" ? (
                          <div className="flex flex-col items-center justify-center py-10 text-slate-500"><Loader2 className="w-8 h-8 animate-spin mb-4" /><p>Gerando insights...</p></div>
                        ) : (
                          <ReactMarkdown>{displaySummary || "Aguardando resumo..."}</ReactMarkdown>
                        )}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="bg-slate-800/40 backdrop-blur-xl border border-emerald-500/20 rounded-[24px] overflow-hidden shadow-xl">
                        <div className="px-6 py-4 border-b border-emerald-500/10 flex items-center justify-between bg-emerald-500/5">
                          <div className="flex items-center gap-2 text-emerald-400">
                            <ListChecks size={18} />
                            <span className="font-bold text-[10px] uppercase tracking-widest">Plano de Ação</span>
                          </div>
                        </div>
                        <div className="p-6 space-y-4">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newTaskText}
                              onChange={(e) => setNewTaskText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTaskText.trim()) {
                                  setActionItems([{ text: newTaskText.trim(), checked: false, id: Date.now().toString() }, ...actionItems]);
                                  setNewTaskText("");
                                }
                              }}
                              placeholder="Adicionar tarefa manual..."
                              className="flex-1 bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <button onClick={() => {
                              if (newTaskText.trim()) {
                                setActionItems([{ text: newTaskText.trim(), checked: false, id: Date.now().toString() }, ...actionItems]);
                                setNewTaskText("");
                              }
                            }} className="p-2 bg-emerald-600 rounded-xl hover:bg-emerald-500 transition-colors">
                              <Check size={18} />
                            </button>
                          </div>
                          <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                            {actionItems.length === 0 ? (
                              <p className="text-center text-sm text-slate-500 py-4 italic">Nenhuma ação detectada ainda.</p>
                            ) : (
                              actionItems.map(item => (
                                <div key={item.id} className="flex items-start gap-3 p-3 bg-slate-900/30 rounded-lg border border-slate-700/30 group">
                                  <button
                                    onClick={() => setActionItems(actionItems.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i))}
                                    className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors ${item.checked ? "bg-emerald-500 border-emerald-500" : "border-slate-600"}`}
                                  >
                                    {item.checked && <Check size={12} />}
                                  </button>
                                  <span className={`text-sm flex-1 ${item.checked ? "line-through text-slate-500" : "text-slate-300"}`}>{item.text}</span>
                                  <button onClick={() => setActionItems(actionItems.filter(i => i.id !== item.id))} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      {results && results.speaker_stats && Object.keys(results.speaker_stats).length > 0 && (
                        <div className="bg-slate-950/50 border border-slate-800 rounded-[24px] p-6">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block flex items-center gap-2"><Users size={14} /> Participantes e Tempo</span>
                          <div className="flex flex-wrap gap-3">
                            {Object.entries(results.speaker_stats).map(([id, time]) => (
                              <div key={id} className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl group">
                                <div className="w-6 h-6 rounded bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold">
                                  {id.split(' ')[1]}
                                </div>
                                <div className="flex flex-col">
                                  {editingSpeaker === id ? (
                                    <input
                                      autoFocus value={tempName}
                                      onChange={e => setTempName(e.target.value)}
                                      onKeyDown={(e) => e.key === 'Enter' && handleRenameSpeaker(id)}
                                      onBlur={() => handleRenameSpeaker(id)}
                                      className="bg-transparent border-none text-xs text-white w-20 outline-none"
                                    />
                                  ) : (
                                    <span className="text-xs font-bold text-slate-300">{speakerNames[id] || id}</span>
                                  )}
                                  <span className="text-[9px] text-slate-500">{Math.floor(time / 60)}m {Math.round(time % 60)}s</span>
                                </div>
                                <button onClick={() => { setEditingSpeaker(id); setTempName(speakerNames[id] || id); }} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-indigo-400 transition-all ml-1">
                                  <Edit3 size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-900/20 border border-slate-800 rounded-[32px] overflow-hidden">
                    <div className="px-8 py-5 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><FileText size={14} /> Transcrição Completa</span>
                      {results && (
                        <button onClick={() => copyToClipboard(displayTranscription, 't')} className="text-slate-500 hover:text-white transition-colors">
                          {copiedStage === 't' ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                        </button>
                      )}
                    </div>
                    <div className="p-8 max-h-[500px] overflow-y-auto custom-scrollbar">
                      {groupedSegments.length > 0 ? (
                        <div className="space-y-8">
                          {groupedSegments.map((seg, idx) => (
                            <div key={idx} className="flex gap-6 group">
                              <div className="flex-shrink-0 w-24 text-right">
                                <span className="text-[10px] font-mono text-slate-600">{Math.floor(seg.start / 60)}:{(seg.start % 60).toFixed(0).padStart(2, '0')}</span>
                                <p className="text-[10px] font-black text-indigo-500/50 uppercase truncate mt-1">{speakerNames[seg.speaker] || seg.speaker}</p>
                              </div>
                              <div className="flex-1 pb-6 border-b border-slate-800/50 group-last:border-none flex flex-wrap text-[15px] leading-relaxed tracking-tight">
                                {seg.words ? seg.words.map((w: any, wIdx: number) => {
                                  const isActive = audioCurrentTime >= w.start && audioCurrentTime <= w.end;
                                  return (
                                    <span
                                      key={wIdx}
                                      onClick={() => { if (audioRef.current) audioRef.current.currentTime = w.start; }}
                                      className={`transition-all duration-150 cursor-pointer mr-0.5 rounded px-0.5 inline-block ${isActive ? "bg-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/30 scale-105 z-10" : "text-slate-400 hover:text-white hover:bg-slate-700/50"}`}
                                    >
                                      {w.word}
                                    </span>
                                  );
                                }) : (
                                  <p className="text-slate-400">{seg.text}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-400 whitespace-pre-wrap">{displayTranscription || "Nenhuma fala detectada."}</p>
                      )}
                    </div>
                  </div>

                </motion.div>
              ) : (
                <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12 bg-slate-900/20 border border-dashed border-slate-800 rounded-[40px]">
                  <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center mb-6 text-slate-700">
                    <FileText size={40} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-300">Aguardando Entrada</h3>
                  <p className="text-sm text-slate-500 mt-2 max-w-xs">Suba um arquivo de áudio ou inicie uma gravação ao vivo para gerar o resumo inteligente.</p>
                </div>
              )}
            </AnimatePresence>
          </section>
        </div>
      </main>

      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowHistory(false)} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]" />
            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-slate-950 border-l border-slate-800 z-[101] p-8 flex flex-col">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-black flex items-center gap-2"><History className="text-indigo-500" /> HISTÓRICO LOCAL</h2>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-900 rounded-full"><XCircle size={20} /></button>
              </div>
              <div className="space-y-4 overflow-y-auto flex-1 pr-2 custom-scrollbar">
                {history.length === 0 ? (
                  <p className="text-center text-slate-500 text-sm mt-10">Nenhum histórico salvo.</p>
                ) : (
                  history.map((item) => (
                    <div key={item.id} onClick={() => loadFromHistory(item)} className="p-5 bg-slate-900/50 border border-slate-800 rounded-2xl hover:border-indigo-500/50 cursor-pointer transition-all group relative">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[9px] font-bold text-indigo-400 uppercase">{new Date(item.timestamp).toLocaleString()}</span>
                      </div>
                      <h4 className="font-bold text-slate-200 truncate">{item.summary?.split('\n')[0].replace(/#/g, '') || "Reunião"}</h4>
                      <p className="text-[10px] text-slate-500 mt-1">{item.word_count || 0} palavras • {Math.floor((item.duration || 0) / 60)}m</p>

                      <button
                        onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }}
                        className="absolute top-4 right-4 p-1.5 bg-slate-800 rounded opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #334155; }
        .prose h1, .prose h2 { color: #818cf8; font-weight: 800; font-size: 1.25rem; margin-top: 1.5rem; }
        .prose p { color: #94a3b8; line-height: 1.6; margin-bottom: 1rem; }
        .prose li { color: #cbd5e1; margin-bottom: 0.5rem; }
        .prose strong { color: #f8fafc; }
      `}</style>
    </div>
  );
}

function StageProgress({ label, value }: { label: string, value: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-500">
        <span>{label}</span>
        <span className={value === 100 ? "text-emerald-500" : "text-indigo-400"}>{value}%</span>
      </div>
      <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${value}%` }} className={`h-full ${value === 100 ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" : "bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.3)]"}`} />
      </div>
    </div>
  );
}

function StatBlock({ icon, label, value, color }: { icon: any, label: string, value: any, color: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
      <div className={`${color} mb-1 opacity-80`}>{icon}</div>
      <span className="text-[8px] font-black uppercase tracking-tighter text-slate-500">{label}</span>
      <p className="text-sm font-black text-white">{value}</p>
    </div>
  );
}