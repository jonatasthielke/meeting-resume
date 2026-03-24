import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as Blob;
    const modelTranscription = (formData.get('modelTranscription') as string) || 'large-v3-turbo';
    const modelSummary = (formData.get('modelSummary') as string) || 'qwen2.5:3b';
    const device = (formData.get('device') as string) || 'auto';

    if (!audioFile) {
      return NextResponse.json({ error: 'Audio file is required' }, { status: 400 });
    }

    // Check for transcription-only mode (used for Live mode updates)
    const { searchParams } = new URL(req.url);
    const isTranscriptionOnly = searchParams.get('type') === 'transcription-only';

    console.log('--- Step 1: Transcribing audio at AI Worker ---');
    const workerFormData = new FormData();
    // Assuming the user sends it with "audio" field
    workerFormData.append('file', audioFile, 'recording.webm');

    const transcriptionResponse = await fetch(`http://localhost:8000/transcribe?model_name=${modelTranscription}&device=${device}`, {
      method: 'POST',
      body: workerFormData,
      signal: AbortSignal.timeout(600000), // 10 minutes
    });

    if (!transcriptionResponse.ok) {
        const errorText = await transcriptionResponse.text();
        console.error('AI Worker error:', errorText);
        throw new Error(`Transcription failed: ${errorText}`);
    }

    const workerData = await transcriptionResponse.json();
    
    if (workerData.status === 'failed') {
        console.error('AI Worker processing failed:', workerData.message);
        throw new Error(workerData.message || "Falha no processamento da IA");
    }

    const text = workerData.text || "";
    if (!text.trim() && !isTranscriptionOnly) {
       throw new Error("Nenhuma fala detectada no áudio para resumir.");
    }
    
    console.log('Transcription received:', text.substring(0, 50) + '...');

    const updateProgress = async (value: number, status: string) => {
        try {
            await fetch('http://localhost:8000/update-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stage: 'summarization', value, status })
            });
        } catch (e) { console.error('Error updating progress:', e); }
    };

    if (isTranscriptionOnly) {
        return NextResponse.json({ transcription: text });
    }

    console.log('--- Step 2: Summarizing with Ollama ---');
    await updateProgress(5, `Verificando modelo ${modelSummary}...`);
    
    let summary = "";
    try {
        // 2a. Check if model exists, if not pull it
        const checkResponse = await fetch('http://localhost:11434/api/show', {
            method: 'POST',
            body: JSON.stringify({ name: modelSummary }),
            signal: AbortSignal.timeout(30000), // 30 seconds for initial check
        });

        if (!checkResponse.ok) {
            console.log(`Model ${modelSummary} not found. Pulling...`);
            await updateProgress(10, `Baixando modelo ${modelSummary} (isso pode demorar)...`);
            
            const pullResponse = await fetch('http://localhost:11434/api/pull', {
                method: 'POST',
                body: JSON.stringify({ name: modelSummary, stream: false }),
                signal: AbortSignal.timeout(600000), // 10 minutes for model pull
            });

            if (!pullResponse.ok) {
                throw new Error(`Falha ao baixar o modelo ${modelSummary} do Ollama.`);
            }
            console.log(`Model ${modelSummary} pulled successfully.`);
        }

        await updateProgress(40, "Gerando resumo estruturado...");
        
        const ollamaResponse = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelSummary,
            prompt: `Você é um Secretário Executivo de IA altamente eficiente.
O texto abaixo é uma transcrição de uma reunião. Suas tarefas são:
1. Identificar o tema principal da reunião.
2. Listar os participantes mencionados (Oradores).
3. Resumir os pontos principais em tópicos (bullet points).
4. Destacar decisões tomadas e próximos passos (Action Items).

Use Markdown para formatar a resposta da seguinte forma:
# 📝 Título da Reunião
## 👥 Participantes
## 📌 Pontos Principais
## ⚡ Decisões e Próximos Passos

Transcrição:
${text}

Resumo Estruturado:`,
            stream: false,
          }),
          signal: AbortSignal.timeout(600000), // 10 minutes for summarization
        });

        if (ollamaResponse.ok) {
            const ollamaData = await ollamaResponse.json();
            summary = ollamaData.response;
            await updateProgress(100, "Concluído!");
        } else {
            summary = `⚠️ **Erro ao conectar com Ollama.**\nCertifique-se de que o Ollama está rodando localmente com o modelo \`${modelSummary}\`.`;
            await updateProgress(0, "Erro no resumo");
        }
    } catch (ollamaErr) {
        console.error('Ollama fetch error:', ollamaErr);
        summary = "🔴 **Serviço Ollama offline.**\nPor favor, inicie o Ollama em seu terminal com o comando: `ollama run qwen2.5:3b`.";
        await updateProgress(0, "Ollama offline");
    }

    return NextResponse.json({
      transcription: text,
      summary: summary,
      num_speakers: workerData.num_speakers,
      word_count: workerData.word_count,
      duration: workerData.duration,
      processing_time: workerData.processing_time,
      speaker_stats: workerData.speaker_stats
    });

  } catch (error: any) {
    console.error('API Route error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
