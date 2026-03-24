"use client";

import { useState, useRef, useEffect } from "react";
import {
  Upload, FileAudio, FileText, BrainCircuit,
  Loader2, Mic, StopCircle, RefreshCw, Layers,
  ChevronRight, Calendar, Users, Clock, CheckCircle2,
  AlertCircle, Sparkles, Cpu, Zap, XCircle, Copy,
  Download, Edit3, Check, Play, Pause, Volume2, ListChecks,
  History, Trash2, ArrowLeft, ExternalLink
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
    summarizationModel: "qwen3:4b",
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
    segments?: Array<{
      start: number;
      end: number;
      speaker: string;
      text: string;
      words: Array<{ word: string, start: number, end: number }>
    }>;
  } | null>(null);

  // Live Mode
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState("");
  const [liveSummary, setLiveSummary] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // History State
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Audio Player State
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  // Task List State
  const [actionItems, setActionItems] = useState<Array<{ text: string, checked: boolean, id: string }>>([]);
  const [newTaskText, setNewTaskText] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("meeting_history");
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const saveToHistory = (newResult: any) => {
    const updated = [
      { ...newResult, timestamp: new Date().toISOString(), id: Date.now() },
      ...history.slice(0, 4) // Keep last 5
    ];
    setHistory(updated);
    localStorage.setItem("meeting_history", JSON.stringify(updated));
  };

  // Speaker Customization
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [tempName, setTempName] = useState("");

  // UI Feedback
  const [copiedStage, setCopiedStage] = useState<string | null>(null);

  useEffect(() => {
    if (results?.speaker_stats) {
      const initialNames: Record<string, string> = {};
      Object.keys(results.speaker_stats).forEach(key => {
        initialNames[key] = key;
      });
      setSpeakerNames(initialNames);
    }
  }, [results]);

  const handleRenameSpeaker = (originalId: string) => {
    if (tempName.trim()) {
      setSpeakerNames(prev => ({ ...prev, [originalId]: tempName.trim() }));
    }
    setEditingSpeaker(null);
  };

  const copyToClipboard = async (text: string, stage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStage(stage);
      setTimeout(() => setCopiedStage(null), 2000);
    } catch (err) {
      console.error("Erro ao copiar: ", err);
    }
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
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setResults(null);
      setAudioUrl(URL.createObjectURL(selectedFile));
      setActionItems([]);
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
      saveToHistory(data);
      extractActionItems(data.summary);
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
    let inActionSection = false;
    const items: Array<{ text: string, checked: boolean, id: string }> = [];

    lines.forEach(line => {
      if (line.includes('Checklist') || line.includes('Decisões') || line.includes('Próximos Passos') || line.includes('Action Items')) {
        inActionSection = true;
      } else if (line.startsWith('## ') && inActionSection) {
        inActionSection = false;
      } else if (inActionSection && (line.trim().startsWith('-') || line.trim().startsWith('*') || line.includes('[ ]'))) {
        const cleanText = line.replace(/^([-*]|\[ \])\s*/, '').replace(/\[ \]/g, '').trim();
        if (cleanText && cleanText.length > 3) {
          items.push({ 
            text: cleanText, 
            checked: false, 
            id: Math.random().toString(36).substr(2, 9) 
          });
        }
      }
    });

    if (items.length > 0) {
      setActionItems(items);
    }
  };

  const addTask = () => {
    if (newTaskText.trim()) {
      setActionItems([...actionItems, { 
        text: newTaskText.trim(), 
        checked: false, 
        id: Math.random().toString(36).substr(2, 9) 
      }]);
      setNewTaskText("");
    }
  };

  const toggleTask = (id: string) => {
    setActionItems(actionItems.map(item => 
      item.id === id ? { ...item, checked: !item.checked } : item
    ));
  };

  const deleteTask = (id: string) => {
    setActionItems(actionItems.filter(item => item.id !== id));
  };

  const deleteHistoryItem = (id: number) => {
    const updated = history.filter(item => item.id !== id);
    setHistory(updated);
    localStorage.setItem("meeting_history", JSON.stringify(updated));
  };

  const loadFromHistory = (item: any) => {
    setResults(item);
    extractActionItems(item.summary);
    setShowHistory(false);
  };

  // Process summary and transcription with custom names
  const getProcessedText = (originalText: string) => {
    let text = originalText;
    if (!text) return "";
    
    Object.entries(speakerNames).forEach(([id, name]) => {
      if (id !== name) {
        // Replace labels like "**Pessoa 1:**" with "**Roberto:**"
        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\*\\*${escapedId}:\\*\\*`, 'g');
        text = text.replace(regex, `**${name}:**`);
        
        // Also catch without bold if needed
        const regexPlain = new RegExp(`${escapedId}:`, 'g');
        text = text.replace(regexPlain, `${name}:`);
      }
    });
    return text;
  };

  const displayTranscription = getProcessedText(results?.transcription || previewText || liveTranscription);
  const displaySummary = getProcessedText(results?.summary || "");

  // Helper to group consecutive segments by speaker
  const groupedSegments = results?.segments ? results.segments.reduce((acc: any[], current) => {
    if (acc.length > 0 && acc[acc.length - 1].speaker === current.speaker) {
      // Merge with last group
      acc[acc.length - 1].words = [...acc[acc.length - 1].words, ...current.words];
      acc[acc.length - 1].end = current.end;
      acc[acc.length - 1].text += " " + current.text;
    } else {
      // Create new group
      acc.push({ ...current });
    }
    return acc;
  }, []) : [];

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
              <div className="flex items-center gap-3">
                <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                  Meeting Resume <span className="text-indigo-400">AI</span>
                </h1>
                <button 
                  onClick={() => setShowHistory(true)}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-indigo-400 transition-all"
                  title="Histórico Local"
                >
                  <History className="w-6 h-6" />
                </button>
              </div>
              <p className="text-slate-400 mt-1 font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                Processamento Local Privado
              </p>
            </div>
          </motion.div>

            <div className="flex bg-slate-800/50 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700/50 shadow-xl gap-2">
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
              {results && (
                <button
                  onClick={exportToMarkdown}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600 hover:text-white transition-all border border-emerald-500/20"
                >
                  <Download className="w-4 h-4" /> Exportar
                </button>
              )}
            </div>
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
                  
                  {/* Audio Player Card */}
                  {audioUrl && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-6 flex flex-col md:flex-row items-center gap-6 shadow-xl"
                    >
                      <div className="flex items-center gap-4 w-full">
                         <button 
                          onClick={() => {
                            if (audioRef.current?.paused) {
                              audioRef.current.play();
                              setIsPlaying(true);
                            } else {
                              audioRef.current?.pause();
                              setIsPlaying(false);
                            }
                          }}
                          className="w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
                         >
                            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
                         </button>
                         <div className="flex-1">
                            <audio 
                              ref={audioRef} 
                              src={audioUrl} 
                              className="hidden" 
                              onPlay={() => setIsPlaying(true)}
                              onPause={() => setIsPlaying(false)}
                              onEnded={() => setIsPlaying(false)}
                              onTimeUpdate={() => {
                                if (audioRef.current) {
                                  setAudioCurrentTime(audioRef.current.currentTime);
                                  setAudioProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
                                }
                              }}
                              onLoadedMetadata={() => {
                                if (audioRef.current) setAudioDuration(audioRef.current.duration);
                              }}
                            />
                            <div className="flex items-center justify-between mb-2">
                               <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Player de Reunião</p>
                               <div className="flex items-center gap-2 text-indigo-400">
                                  <span className="text-[10px] font-mono">{Math.floor(audioCurrentTime / 60)}:{(audioCurrentTime % 60).toFixed(0).padStart(2, '0')} / {Math.floor(audioDuration / 60)}:{(audioDuration % 60).toFixed(0).padStart(2, '0')}</span>
                                  <Volume2 className="w-4 h-4" />
                               </div>
                            </div>
                            <div 
                              className="h-2 w-full bg-slate-900 rounded-full overflow-hidden flex items-center cursor-pointer group/progress"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const x = e.clientX - rect.left;
                                const pct = x / rect.width;
                                if (audioRef.current) audioRef.current.currentTime = pct * audioRef.current.duration;
                              }}
                            >
                               <div 
                                  className="h-full bg-indigo-500 transition-all duration-300 relative" 
                                  style={{ width: `${audioProgress}%` }} 
                               >
                                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg scale-0 group-hover/progress:scale-100 transition-transform" />
                               </div>
                            </div>
                         </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Action Items / Checklist */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-gradient-to-br from-emerald-900/10 to-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-[32px] overflow-hidden"
                  >
                    <div className="px-8 py-5 border-b border-emerald-500/10 flex items-center justify-between bg-white/5">
                      <div className="flex items-center gap-3 text-emerald-400">
                        <ListChecks className="w-5 h-5" />
                        <span className="font-bold text-xs uppercase tracking-widest text-slate-300">Plano de Ação e Tarefas</span>
                      </div>
                    </div>
                    
                    <div className="p-8 space-y-6">
                      {/* Add New Task */}
                      <div className="relative group">
                        <input 
                          type="text" 
                          value={newTaskText}
                          onChange={(e) => setNewTaskText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addTask()}
                          placeholder="Adicionar tarefa manual..."
                          className="w-full bg-slate-900/50 border border-slate-700/50 rounded-2xl px-6 py-4 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all placeholder:text-slate-600 pr-16"
                        />
                        <button 
                          onClick={addTask}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
                        >
                           <RefreshCw className="w-4 h-4 rotate-45" />
                        </button>
                      </div>

                      <div className="space-y-3">
                        {actionItems.length === 0 ? (
                          <div className="text-center py-6 text-slate-600 italic text-sm">
                             Nenhuma tarefa identificada. Use o campo acima para adicionar.
                          </div>
                        ) : (
                          actionItems.map((item) => (
                            <div 
                              key={item.id} 
                              className={`group relative flex items-start gap-4 p-4 rounded-2xl border transition-all ${item.checked ? "bg-emerald-500/5 border-emerald-500/30 opacity-60" : "bg-slate-900/40 border-slate-700/30 hover:border-emerald-500/30 shadow-lg hover:shadow-emerald-500/5"}`}
                            >
                              <div 
                                onClick={() => toggleTask(item.id)}
                                className={`mt-1 w-6 h-6 rounded-lg flex items-center justify-center transition-all cursor-pointer ${item.checked ? "bg-emerald-500 text-white" : "border-2 border-slate-600 hover:border-emerald-400"}`}
                              >
                                {item.checked && <Check className="w-4 h-4" />}
                              </div>
                              <p className={`flex-1 text-[15px] font-medium leading-relaxed ${item.checked ? "line-through text-slate-500" : "text-slate-200"}`}>
                                {item.text}
                              </p>
                              <button 
                                onClick={() => deleteTask(item.id)}
                                className="opacity-0 group-hover:opacity-100 p-2 text-slate-600 hover:text-red-400 transition-all rounded-lg"
                              >
                                 <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </motion.div>
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
                        {Object.entries(results.speaker_stats).map(([originalId, seconds]) => (
                          <div key={originalId} className="flex items-center justify-between p-4 bg-slate-900/40 rounded-2xl border border-slate-700/30 hover:border-indigo-500/30 transition-all group">
                            <div className="flex items-center gap-3 overflow-hidden">
                               <div className="w-10 h-10 flex-shrink-0 bg-gradient-to-br from-indigo-500/20 to-indigo-600/10 rounded-xl flex items-center justify-center text-indigo-400 font-bold group-hover:scale-110 transition-transform">
                                  {originalId.split(' ')[1]}
                               </div>
                               <div className="overflow-hidden">
                                  {editingSpeaker === originalId ? (
                                    <div className="flex items-center gap-1">
                                      <input 
                                        autoFocus
                                        value={tempName}
                                        onChange={(e) => setTempName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleRenameSpeaker(originalId)}
                                        className="bg-slate-800 border border-indigo-500/50 rounded px-2 py-0.5 text-xs text-white outline-none w-24"
                                      />
                                      <button onClick={() => handleRenameSpeaker(originalId)} className="text-emerald-500"><Check className="w-3 h-3" /></button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 group/name">
                                      <p className="font-bold text-slate-200 text-sm truncate">{speakerNames[originalId] || originalId}</p>
                                      <button 
                                        onClick={() => { setEditingSpeaker(originalId); setTempName(speakerNames[originalId] || originalId); }}
                                        className="opacity-0 group-hover:opacity-100 group-hover/name:text-indigo-400 transition-all"
                                      >
                                        <Edit3 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                  <div className="w-16 h-1 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                                     <div 
                                        className="h-full bg-indigo-500" 
                                        style={{ width: `${Math.round((seconds / (results.duration || 1)) * 100)}%` }} 
                                     />
                                  </div>
                               </div>
                            </div>
                            <div className="text-right flex-shrink-0 ml-2">
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
                      {results && (
                        <button 
                          onClick={() => copyToClipboard(displaySummary, 'summary')}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold transition-all border border-slate-700"
                        >
                          {copiedStage === 'summary' ? <><Check className="w-3 h-3 text-emerald-500" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar</>}
                        </button>
                      )}
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
                    <div className="px-8 py-4 border-b border-slate-700/50 flex items-center justify-between bg-white/5">
                      <div className="flex items-center gap-3 text-slate-400">
                        <FileText className="w-4 h-4" />
                        <span className="font-bold text-xs uppercase tracking-widest">Transcrição Completa</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {results && (
                          <button 
                            onClick={() => copyToClipboard(displayTranscription, 'transcription')}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold transition-all border border-slate-700"
                          >
                            {copiedStage === 'transcription' ? <><Check className="w-3 h-3 text-emerald-500" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar</>}
                          </button>
                        )}
                        {isRecording && (
                          <span className="flex items-center gap-2 scale-75">
                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                            <span className="text-red-400 font-bold">LIVE</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="p-8 max-h-[500px] overflow-y-auto custom-scrollbar">
                      {groupedSegments.length > 0 ? (
                        <div className="space-y-8">
                           {groupedSegments.map((seg: any, sIdx: number) => (
                             <div key={sIdx} className="group/seg relative pl-8 border-l-2 border-slate-700/50 hover:border-indigo-500/50 transition-colors pb-2">
                                <div className="flex items-center gap-3 mb-3">
                                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs">
                                     {seg.speaker.split(' ')[1] || "S"}
                                  </div>
                                  <span className="text-xs font-black text-slate-200 uppercase tracking-widest">
                                    {speakerNames[seg.speaker] || seg.speaker}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-500 px-2 py-0.5 bg-slate-800/50 rounded border border-slate-700/50">
                                    {Math.floor(seg.start / 60)}:{(seg.start % 60).toFixed(0).padStart(2, '0')}
                                  </span>
                                </div>
                                <div className="flex flex-wrap text-[15px] leading-relaxed tracking-tight">
                                   {seg.words && seg.words.map((w: any, wIdx: number) => {
                                       const isActive = audioCurrentTime >= w.start && audioCurrentTime <= w.end;
                                       return (
                                         <span 
                                          key={wIdx} 
                                          onClick={() => { if(audioRef.current) audioRef.current.currentTime = w.start; }}
                                          className={`transition-all duration-150 cursor-pointer mr-0.5 rounded px-0.5 inline-block ${isActive ? "bg-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/30 scale-105 z-10" : "text-slate-400 hover:text-white hover:bg-slate-700/50"}`}
                                         >
                                           {w.word}
                                         </span>
                                       )
                                     })}
                                </div>
                             </div>
                           ))}
                        </div>
                      ) : (
                        <p className="text-slate-300 leading-relaxed font-medium whitespace-pre-wrap">
                          {displayTranscription || "Nenhuma fala capturada ainda."}
                        </p>
                      )}
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

      {/* History Sidebar */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl z-[101] p-8"
            >
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-3">
                  <History className="w-6 h-6 text-indigo-400" />
                  <h2 className="text-xl font-bold">Histórico</h2>
                </div>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-800 rounded-full transition-all">
                  <ArrowLeft className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {history.length === 0 ? (
                  <div className="text-center py-20 text-slate-500">
                    <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>Nenhuma reunião salva ainda.</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <div key={item.id} className="group relative">
                      <div 
                        onClick={() => loadFromHistory(item)}
                        className="w-full text-left p-5 bg-slate-800/50 hover:bg-indigo-500/10 border border-slate-700/50 hover:border-indigo-500/30 rounded-2xl transition-all cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-2">
                           <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">{new Date(item.timestamp).toLocaleDateString()}</span>
                           <span className="text-[10px] text-slate-500">{item.word_count} palavras</span>
                        </div>
                        <h3 className="font-bold text-slate-200 line-clamp-1">{item.summary.split('\n')[0].replace(/^#\s*/, '') || "Reunião sem título"}</h3>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.transcription.substring(0, 100)}...</p>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }}
                        className="absolute top-4 right-4 p-2 bg-red-500/10 text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
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
