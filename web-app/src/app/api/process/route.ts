import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const workerPort = process.env.WORKER_PORT || '8000';
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const defaultWhisperModel = process.env.WHISPER_MODEL || 'large-v3-turbo';
    const defaultSummaryModel = process.env.SUMMARY_MODEL || 'qwen2.5:3b';
    const defaultDevice = process.env.DEVICE || 'auto';

    const audioFile = formData.get('audio') as Blob;
    const modelTranscription = (formData.get('modelTranscription') as string) || defaultWhisperModel;
    const modelSummary = (formData.get('modelSummary') as string) || defaultSummaryModel;
    const device = (formData.get('device') as string) || defaultDevice;

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

    const transcriptionResponse = await fetch(`http://localhost:${workerPort}/transcribe?model_name=${modelTranscription}&device=${device}`, {
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
            await fetch(`http://localhost:${workerPort}/update-progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stage: 'summarization', value, status })
            });
        } catch (e) { console.error('Error updating progress:', e); }
    };

    if (isTranscriptionOnly) {
        return NextResponse.json({ transcription: text });
    }

    const summaryProvider = process.env.SUMMARY_PROVIDER || 'LOCAL';
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const promptTemplate = `Você é um Secretário Executivo de IA altamente eficiente.
O texto abaixo é uma transcrição de uma reunião. Suas tarefas são:
1. Identificar o tema principal da reunião.
2. Listar os participantes mencionados (Oradores).
3. Resumir os pontos principais em tópicos (bullet points).
4. Criar um checklist claro de ações que devem ser feitas (Próximos Passos).

Use Markdown para formatar a resposta da seguinte forma:
# 📝 Título da Reunião
## 👥 Participantes
## 📌 Pontos Principais
## ✅ Checklist de Ações (Próximos Passos)

Transcrição:
${text}

Resumo Estruturado:`;

    console.log(`--- Step 2: Summarizing with ${summaryProvider} ---`);
    let summary = "";

    if (summaryProvider === 'OPENAI') {
      if (!openaiApiKey) {
        throw new Error("OPENAI_API_KEY não configurada no arquivo .env");
      }
      
      await updateProgress(50, "Gerando resumo via OpenAI...");
      
      const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          model: openaiModel,
          messages: [
            { role: "system", content: "Você é um assistente de resumo de reuniões de alta precisão." },
            { role: "user", content: promptTemplate }
          ],
          temperature: 0.7
        }),
        signal: AbortSignal.timeout(60000), 
      });

      if (!openAIResponse.ok) {
        const errorData = await openAIResponse.json();
        throw new Error(`OpenAI API error: ${errorData.error?.message || openAIResponse.statusText}`);
      }

      const openAIData = await openAIResponse.json();
      summary = openAIData.choices[0].message.content;
      await updateProgress(100, "Concluído!");

    } else {
      // --- Lógica OLLAMA (Local) ---
      await updateProgress(5, `Verificando modelo local ${modelSummary}...`);
      
      try {
          const checkResponse = await fetch(`${ollamaBaseUrl}/api/show`, {
              method: 'POST',
              body: JSON.stringify({ name: modelSummary }),
              signal: AbortSignal.timeout(30000),
          });

          if (!checkResponse.ok) {
              console.log(`Model ${modelSummary} not found. Pulling...`);
              await updateProgress(10, `Baixando modelo ${modelSummary} (isso pode demorar)...`);
              
              const pullResponse = await fetch(`${ollamaBaseUrl}/api/pull`, {
                  method: 'POST',
                  body: JSON.stringify({ name: modelSummary, stream: false }),
                  signal: AbortSignal.timeout(600000), 
              });

              if (!pullResponse.ok) {
                  throw new Error(`Falha ao baixar o modelo ${modelSummary} do Ollama.`);
              }
          }

          await updateProgress(40, "Gerando resumo estruturado local...");
          
          const ollamaResponse = await fetch(`${ollamaBaseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelSummary,
              prompt: promptTemplate,
              stream: false,
            }),
            signal: AbortSignal.timeout(600000),
          });

          if (ollamaResponse.ok) {
              const ollamaData = await ollamaResponse.json();
              summary = ollamaData.response;
              await updateProgress(100, "Concluído!");
          } else {
              summary = `⚠️ **Erro ao conectar com Ollama.**\nCertifique-se de que o Ollama está rodando localmente com o modelo \`${modelSummary}\`.`;
          }
      } catch (ollamaErr) {
          console.error('Ollama fetch error:', ollamaErr);
          summary = `🔴 **Serviço Ollama offline ou erro.**\nCertifique-se de que o Ollama está rodando ou mude para o provedor OPENAI no .env.`;
          await updateProgress(0, "Erro no resumo");
      }
    }

    return NextResponse.json({
      transcription: text,
      summary: summary,
      num_speakers: workerData.num_speakers,
      word_count: workerData.word_count,
      duration: workerData.duration,
      processing_time: workerData.processing_time,
      speaker_stats: workerData.speaker_stats,
      segments: workerData.segments
    });

  } catch (error: any) {
    console.error('API Route error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
