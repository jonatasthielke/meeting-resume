"use client";

import { useState, useRef, useEffect } from "react";
import {
  Upload, FileAudio, FileText, BrainCircuit,
  Loader2, Mic, StopCircle, RefreshCw, Layers,
  ChevronRight, Calendar, Users, Clock, CheckCircle2,
  AlertCircle, Sparkles, Cpu, Zap, XCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"upload" | "live">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressStatus, setProgressStatus] = useState("Aguardando...");
  const [progressValue, setProgressValue] = useState(0);
  const [stages, setStages] = useState<{ transcription: number; diarization: number; summarization: number }>({
    transcription: 0,
    diarization: 0,
    summarization: 0
  });
  const [previewText, setPreviewText] = useState("");
  const [settings, setSettings] = useState({
    transcriptionModel: "large-v3-turbo",
    summarizationModel: "qwen2.5:3b",
    device: "auto"
  });
  const [results, setResults] = useState<{ 
    transcription: string; 
    summary: string;
    num_speakers?: number;
    word_count?: number;
    duration?: number;
    processing_time?: number;
    speaker_stats?: Record<string, number>;
  } | null>(null);

  // Live Mode
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState("");
  const [liveSummary, setLiveSummary] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResults(null);
    }
  };

  const pollProgress = () => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("http://localhost:8000/progress");
        if (res.ok) {
          const data = await res.json();
          setProgressStatus(data.status);
          setProgressValue(data.progress || 0);
          if (data.stages) setStages(data.stages);
          if (data.current_text) setPreviewText(data.current_text);
        }
      } catch (e) { /* ignore */ }
    }, 800);
    return interval;
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setResults(null);
    setPreviewText("");
    setStages({ transcription: 0, diarization: 0, summarization: 0 });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const progressInterval = pollProgress();

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
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setProgressStatus("Cancelado pelo usuário");
      } else {
        console.error(err);
      }
    } finally {
      clearInterval(progressInterval);
      setLoading(false);
      setProgressValue(0);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    try {
      await fetch("http://localhost:8000/cancel", { method: "POST" });
    } catch (e) { /* ignore error on cancel call */ }
    setLoading(false);
    setProgressStatus("Cancelado");
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
          const response = await fetch("/api/process?type=transcription-only", {
            method: "POST",
            body: formData
          });
          if (response.ok) {
            const data = await response.json();
            setLiveTranscription(data.transcription);
          }
        } catch (err) { console.error(err); }
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
      } catch (err) {
        alert("Erro no resumo final.");
      } finally {
        setLoading(false);
      }
    }, 500);
  };

  const displayTranscription = results?.transcription || previewText || liveTranscription;
  const displaySummary = results?.summary;

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 lg:py-20">
        {/* Header Section */}
        <header className="flex flex-col md:flex-row items-center justify-between gap-8 mb-16">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-6"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 animate-pulse" />
              <div className="relative p-4 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl shadow-2xl">
                <BrainCircuit className="w-10 h-10 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                Meeting Resume <span className="text-indigo-400">AI</span>
              </h1>
              <p className="text-slate-400 mt-1 font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                Processamento Local Privado
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex bg-slate-800/50 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700/50 shadow-xl"
          >
            <button
              onClick={() => { setActiveTab("upload"); setResults(null); }}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === "upload" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-slate-400 hover:text-white"}`}
            >
              <Upload className="w-4 h-4" /> Arquivo
            </button>
            <button
              onClick={() => { setActiveTab("live"); setResults(null); }}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === "live" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-slate-400 hover:text-white"}`}
            >
              <Mic className="w-4 h-4" /> Ao Vivo
            </button>
          </motion.div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Action Panel */}
          <div className="lg:col-span-5 space-y-8">
            <motion.div
              layout
              className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-[32px] p-8 lg:p-10 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/30">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin text-indigo-400" : "text-slate-400"}`} />
                  Processamento
                </h2>
                <div className="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 rounded-full text-[10px] font-bold text-indigo-400 uppercase tracking-widest border border-indigo-500/20">
                  {settings.device === "auto" ? <><Zap className="w-3 h-3 text-amber-400" /> Alto Desempenho (Auto)</> : settings.device === "cuda" ? <><Zap className="w-3 h-3 text-amber-400" /> GPU CUDA</> : <><Cpu className="w-3 h-3" /> Somente CPU</>}
                </div>
              </div>

              <AnimatePresence mode="wait">
                {activeTab === "upload" ? (
                  <motion.div
                    key="upload"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-8"
                  >
                    <div className="relative group cursor-pointer">
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={handleFileChange}
                        className="absolute inset-0 opacity-0 z-10 cursor-pointer"
                      />
                      <div className={`border-2 border-dashed rounded-3xl py-12 transition-all flex flex-col items-center justify-center gap-4 ${file ? "border-emerald-500/50 bg-emerald-500/5" : "border-slate-600 group-hover:border-indigo-500 group-hover:bg-indigo-500/5"}`}>
                        <div className={`p-4 rounded-full transition-transform group-hover:scale-110 ${file ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-slate-400"}`}>
                          <FileAudio className="w-8 h-8" />
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg text-slate-200">{file ? file.name : "Solte seu arquivo de áudio"}</p>
                          <p className="text-slate-500 text-sm mt-1">MP3, WAV, M4A até 500MB</p>
                        </div>
                      </div>
                    </div>

                    {loading ? (
                      <div className="flex flex-col gap-3">
                        <button className="w-full py-5 bg-slate-800 text-slate-400 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 cursor-not-allowed">
                          <Loader2 className="w-5 h-5 animate-spin" /> {progressStatus}
                        </button>
                        <button
                          onClick={handleCancel}
                          className="w-full py-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-red-500/20 hover:border-red-500"
                        >
                          <XCircle className="w-4 h-4" /> Cancelar Processamento
                        </button>
                      </div>
                    ) : <button onClick={handleUpload} disabled={!file} className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-2xl font-bold shadow-2xl shadow-indigo-600/20 transition-all flex items-center justify-center gap-3 overflow-hidden relative"><Sparkles className="w-5 h-5" /> Processar Agora</button>}

                    {loading && (
                      <div className="space-y-4 pt-4 border-t border-slate-700/30">
                        <StageItem label="Transcrição" value={stages.transcription} icon={<FileText className="w-4 h-4" />} />
                        <StageItem label="Identificação" value={stages.diarization} icon={<Users className="w-4 h-4" />} />
                        <StageItem label="Resumo IA" value={stages.summarization} icon={<BrainCircuit className="w-4 h-4" />} />
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="live"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col items-center py-6 space-y-10"
                  >
                    <div className="relative">
                      {isRecording && (
                        <div className="absolute inset-[-20px] rounded-full border-2 border-red-500/30 animate-ping" />
                      )}
                      <div className={`w-32 h-32 rounded-full flex items-center justify-center shadow-inner transition-all duration-500 ${isRecording ? "bg-red-500 text-white ring-8 ring-red-500/20" : "bg-slate-700 text-slate-400 ring-8 ring-slate-800"}`}>
                        {isRecording ? <StopCircle className="w-12 h-12" /> : <Mic className="w-12 h-12" />}
                      </div>
                    </div>

                    <div className="text-center space-y-2">
                      <h3 className="text-2xl font-bold text-white">{isRecording ? "Capturando Áudio..." : "Pronto para Gravar"}</h3>
                      <p className="text-slate-400 px-4">Ideal para reuniões ao vivo. O processamento ocorre em tempo real de forma totalmente privada.</p>
                    </div>

                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={loading}
                      className={`w-full py-5 rounded-2xl font-bold shadow-xl transition-all flex items-center justify-center gap-3 ${isRecording ? "bg-red-600 hover:bg-red-500 text-white shadow-red-600/20" : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20"}`}
                    >
                      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isRecording ? "Finalizar Reunião" : "Iniciar Gravação"}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Stats Card */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Clock className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">Transcrição</span>
                </div>
                <p className="text-sm font-bold text-white truncate">{settings.transcriptionModel}</p>
              </div>
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Layers className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">Resumidor</span>
                </div>
                <p className="text-sm font-bold text-white truncate">{settings.summarizationModel}</p>
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="bg-slate-800/20 border border-slate-700/30 rounded-[32px] p-8 space-y-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <Layers className="w-4 h-4" /> Configurações Avançadas
              </h3>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400">Motor de Transcrição</label>
                  <select
                    value={settings.transcriptionModel}
                    onChange={(e) => setSettings({ ...settings, transcriptionModel: e.target.value })}
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    disabled={loading}
                  >
                    <option value="tiny">Tiny (Ultra Rápido)</option>
                    <option value="base">Base (Rápido)</option>
                    <option value="small">Small (Equilibrado)</option>
                    <option value="medium">Medium (Preciso)</option>
                    <option value="large-v3-turbo">Turbo v3 (Recomendado)</option>
                    <option value="large-v3">Large v3 (Qualidade Máxima)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400">Modelo de Resumo (Ollama)</label>
                  <select
                    value={settings.summarizationModel}
                    onChange={(e) => setSettings({ ...settings, summarizationModel: e.target.value })}
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    disabled={loading}
                  >
                    <option value="qwen3:4b">Qwen 3 4B (Melhor em PT-BR)</option>
                    <option value="llama3.2:3b">Llama 3.2 3B (Equilibrado)</option>
                    <option value="mistral:latest">Mistral (Preciso)</option>
                    <option value="phi3:mini">Phi-3 Mini (Ultra Leve)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400">Aceleração de Hardware</label>
                  <div className="flex gap-2 p-1 bg-slate-900/50 border border-slate-700 rounded-xl">
                    <button
                      onClick={() => setSettings({ ...settings, device: "auto" })}
                      className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all flex items-center justify-center gap-1 ${settings.device === "auto" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-slate-500 hover:text-white"}`}
                      disabled={loading}
                    ><Zap className="w-3 h-3 text-amber-400" /> Auto (GPU)</button>
                    <button
                      onClick={() => setSettings({ ...settings, device: "cuda" })}
                      className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all flex items-center justify-center gap-1 ${settings.device === "cuda" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-slate-500 hover:text-white"}`}
                      disabled={loading}
                    ><Zap className="w-3 h-3" /> GPU</button>
                    <button
                      onClick={() => setSettings({ ...settings, device: "cpu" })}
                      className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all flex items-center justify-center gap-1 ${settings.device === "cpu" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-white"}`}
                      disabled={loading}
                    ><Cpu className="w-3 h-3" /> CPU</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Results Side */}
          <div className="lg:col-span-7 space-y-8">
            <AnimatePresence mode="popLayout">
              {(displayTranscription || displaySummary) ? (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6 h-full"
                >
                  {/* Stats Row */}
                  {results && results.word_count !== undefined && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="grid grid-cols-2 md:grid-cols-4 gap-4"
                    >
                      <StatMiniCard 
                        icon={<Users className="w-4 h-4 text-indigo-400" />} 
                        label="Participantes" 
                        value={`${results.num_speakers} ${results.num_speakers === 1 ? 'Pessoa' : 'Pessoas'}`} 
                      />
                      <StatMiniCard 
                        icon={<FileText className="w-4 h-4 text-emerald-400" />} 
                        label="Palavras" 
                        value={results.word_count.toLocaleString()} 
                      />
                      <StatMiniCard 
                        icon={<Clock className="w-4 h-4 text-amber-400" />} 
                        label="Duração" 
                        value={`${Math.floor((results.duration || 0) / 60)}m ${Math.round((results.duration || 0) % 60)}s`} 
                      />
                      <StatMiniCard 
                        icon={<Zap className="w-4 h-4 text-rose-400" />} 
                        label="Processado" 
                        value={`${results.processing_time}s`} 
                      />
                    </motion.div>
                  )}
                  
                  {/* Speaker Stats (Detailed) */}
                  {results && results.speaker_stats && Object.keys(results.speaker_stats).length > 0 && (
                    <motion.div
                       initial={{ opacity: 0, scale: 0.98 }}
                       animate={{ opacity: 1, scale: 1 }}
                       className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-[32px] overflow-hidden shadow-xl"
                    >
                      <div className="px-8 py-4 border-b border-slate-700/50 flex items-center justify-between bg-white/5">
                        <div className="flex items-center gap-3 text-indigo-400">
                          <Users className="w-4 h-4" />
                          <span className="font-bold text-xs uppercase tracking-widest text-slate-300">Tempo de Fala por Integrante</span>
                        </div>
                      </div>
                      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.entries(results.speaker_stats).map(([speaker, seconds]) => (
                          <div key={speaker} className="flex items-center justify-between p-4 bg-slate-900/40 rounded-2xl border border-slate-700/30 hover:border-indigo-500/30 transition-all group">
                            <div className="flex items-center gap-3">
                               <div className="w-10 h-10 bg-gradient-to-br from-indigo-500/20 to-indigo-600/10 rounded-xl flex items-center justify-center text-indigo-400 font-bold group-hover:scale-110 transition-transform">
                                  {speaker.split(' ')[1]}
                               </div>
                               <div>
                                  <p className="font-bold text-slate-200 text-sm">{speaker}</p>
                                  <div className="w-16 h-1 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                                     <div 
                                        className="h-full bg-indigo-500" 
                                        style={{ width: `${Math.round((seconds / (results.duration || 1)) * 100)}%` }} 
                                     />
                                  </div>
                               </div>
                            </div>
                            <div className="text-right">
                               <p className="text-sm font-black text-white">{Math.floor(seconds / 60)}m {Math.round(seconds % 60)}s</p>
                               <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{Math.round((seconds / (results.duration || 1)) * 100)}%</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Summary (Primary Result) */}
                  <div className="bg-gradient-to-br from-indigo-900/40 to-slate-900/40 backdrop-blur-xl border border-indigo-500/20 rounded-[32px] overflow-hidden shadow-2xl">
                    <div className="px-8 py-5 border-b border-indigo-500/10 flex items-center justify-between bg-white/5">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg"><Sparkles className="w-4 h-4 text-indigo-400" /></div>
                        <span className="font-bold text-xs uppercase tracking-widest text-indigo-300">Resumo da IA</span>
                      </div>
                    </div>
                    <div className="p-8 lg:p-10 max-h-[400px] overflow-y-auto custom-scrollbar">
                      {loading && activeTab === "live" ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                          <Loader2 className="w-8 h-8 animate-spin mb-4" />
                          <p className="font-medium">Otimizando pontos principais...</p>
                        </div>
                      ) : (
                        <article className="prose prose-invert prose-indigo max-w-none">
                          <ReactMarkdown>{displaySummary || "Aguardando conclusão para gerar resumo..."}</ReactMarkdown>
                        </article>
                      )}
                    </div>
                  </div>

                  {/* Transcription (Secondary Result) */}
                  <div className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-[32px] overflow-hidden">
                    <div className="px-8 py-4 border-b border-slate-700/50 flex items-center justify-between">
                      <div className="flex items-center gap-3 text-slate-400">
                        <FileText className="w-4 h-4" />
                        <span className="font-bold text-xs uppercase tracking-widest">Transcrição Completa</span>
                      </div>
                      {isRecording && (
                        <span className="flex items-center gap-2 scale-75">
                          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          <span className="text-red-400 font-bold">LIVE</span>
                        </span>
                      )}
                    </div>
                    <div className="p-8 max-h-[300px] overflow-y-auto custom-scrollbar">
                      <p className="text-slate-300 leading-relaxed font-medium whitespace-pre-wrap">
                        {displayTranscription || "Nenhuma fala capturada ainda."}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center bg-slate-800/20 border border-slate-700/30 border-dashed rounded-[32px] text-slate-500 p-12 text-center"
                >
                  <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-6">
                    <RefreshCw className="w-10 h-10 opacity-20" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-400 mb-2">Pronto para começar</h3>
                  <p className="max-w-xs mx-auto">Carregue um arquivo ou inicie uma gravação para ver a mágica acontecer aqui.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        
        .prose h1, .prose h2, .prose h3 { color: #818cf8; margin-bottom: 0.5rem; font-weight: 800; }
        .prose ul { list-style-type: disc; padding-left: 1.5rem; }
        .prose li { margin-bottom: 0.25rem; color: #cbd5e1; }
        .prose p { margin-bottom: 1rem; color: #94a3b8; }
        .prose strong { color: #f8fafc; }
      `}</style>
    </div>
  );
}

function StatMiniCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string | number }) {
  return (
    <div className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl p-4 flex flex-col gap-1 shadow-lg shadow-indigo-900/5">
      <div className="flex items-center gap-2 text-slate-400 mb-1">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function StageItem({ label, value, icon }: { label: string, value: number, icon: React.ReactNode }) {
  return (
    <div className="space-y-1.5 transition-all duration-300">
      <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
        <div className="flex items-center gap-2 text-slate-400">
          <div className={`p-1 rounded-md ${value === 100 ? "bg-emerald-500/20 text-emerald-400" : "bg-indigo-500/20 text-indigo-400"}`}>
            {icon}
          </div>
          {label}
        </div>
        <span className={value === 100 ? "text-emerald-400" : "text-indigo-400"}>{value}%</span>
      </div>
      <div className="h-1.5 w-full bg-slate-900/50 rounded-full overflow-hidden border border-slate-700/30">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ type: "spring", stiffness: 50, damping: 20 }}
          className={`h-full rounded-full ${value === 100 ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" : "bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.3)]"}`}
        />
      </div>
    </div>
  );
}
