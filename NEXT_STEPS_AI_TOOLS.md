# Transformando o "Meeting Resume" em uma Plataforma "AI Tools"

Este documento detalha os próximos passos e a arquitetura necessária para transformar seu projeto de propósito único ("Meeting Resume", que atualmente apenas transcreve e resume áudios) em uma **Plataforma Completa de Ferramentas de IA (AI Tools)**. 

A ideia central é usar a fundação atual (Next.js + Tailwind + FastAPI + Serviços Locais/Cloud como Ollama e OpenAI) para criar um ecossistema modular onde múltiplas ferramentas vivem em uma mesma aplicação.

---

## 1. Reestruturação do Frontend (Next.js `web-app`)

Atualmente, toda a lógica do "Meeting Resume" está em `src/app/page.tsx` e `src/app/api/process/route.ts`. Para suportar múltiplas ferramentas, precisamos adotar uma arquitetura de rotas modulares.

### Passo 1.1: Criar um Dashboard Principal (Nova Home)
- **O que fazer:** Transformar o `src/app/page.tsx` atual em um "Hub de Ferramentas". Esta página deve listar em formato de grid os "Cards" das ferramentas disponíveis.
- **Ferramentas Iniciais sugeridas:**
  1. **Meeting Resume:** (O código atual).
  2. **AI Chat (Local/Cloud):** Um chat estilo ChatGPT que conversa com o Ollama ou OpenAI.
  3. **Audio Transcriber (Simples):** Apenas transcrição pura de arquivos longos usando o Faster-Whisper, sem o resumo.
  4. **Document Q&A:** Fazer upload de um PDF e "conversar" com ele (Requer LangChain/LlamaIndex no backend).
  5. **Image Generator:** Uma tela para gerar imagens via API (DALL-E) ou Stable Diffusion local.

### Passo 1.2: Migrar a Ferramenta Atual para uma Rota Específica
- **Pasta:** Mova todo o conteúdo (ou componentes) de `page.tsx` atual para `src/app/tools/meeting-resume/page.tsx`.
- **Componentização:** O arquivo `page.tsx` tem mais de 800 linhas. Ele deve ser quebrado em componentes (ex: `<AudioPlayer />`, `<TranscriptView />`, `<SummaryView />`, `<SettingsModal />`) dentro de uma pasta `src/components/tools/meeting-resume`.

### Passo 1.3: Estruturar as Novas Rotas da API
- Renomeie a pasta atual de `src/app/api/process` para `src/app/api/meeting-resume/process`.
- Crie novas rotas conforme criar novas ferramentas, por exemplo:
  - `src/app/api/chat/route.ts`
  - `src/app/api/document-qa/route.ts`

---

## 2. Reestruturação do Backend Python (`ai-worker`)

Seu `ai-worker` com FastAPI já é uma excelente fundação. Atualmente ele foca apenas em transcrição via `faster-whisper`. Para suportar mais funcionalidades de IA, ele precisa virar um hub de micro-tarefas da IA.

### Passo 2.1: Estruturar Endpoints e Roteadores
Em vez de ter tudo em `main.py`, crie "routers":
```python
# ai-worker/routers/transcription.py -> Endpoints do whisper
# ai-worker/routers/rag.py           -> Endpoints para RAG (Chat com PDF)
# ai-worker/routers/img_gen.py       -> Endpoints de geração de imagem
```
### Passo 2.2: Adicionar um Backend de LLM (Opcional, mas Recomendado)
Atualmente o frontend roteia os prompts para o Ollama. Conforme os casos de uso ficam mais complexos (ex: RAG - Retrival-Augmented Generation), o uso do LLM pode ficar melhor posicionado no Python usando **LangChain** ou **LlamaIndex**.
- **Novo Endpoint:** O `Next.js` manda o áudio e o Prompt Base para o `ai-worker`. O `ai-worker` transcreve e ele mesmo acessa o Ollama, devolvendo o resultado final para o front.

---

## 3. Banco de Dados e Persistência

Atualmente, o histórico é salvo no `localStorage` do navegador do usuário. Para um SaaS ou ferramenta avançada de uso diário, isso é arriscado (se ele limpar o cache, perde os dados).

### Passo 3.1: Introduzir um ORM e Banco de Dados (Prisma ou Drizzle com SQLite/PostgreSQL)
- **Ação:** Instalar o Prisma ORM (`npm i prisma @prisma/client`).
- **Esquema Inicial Sugerido:**
  - `User` (para futuro sistema de login).
  - `ToolSession` (Histórico generalizado: Qual ferramenta usou, entrada, saída gerada, JSON de metadata).
  - `Document` (Caso faça upload de arquivos persistentes).

### Passo 3.2: Histórico Global
Criar um painel (Sidebar ou Rota `/history`) onde o usuário possa ver tudo o que ele já processou, divido por ferramenta:
- _"Resumo de Reunião de Marketing" - Tool: Meeting Resume_
- _"Chat sobre Código Python" - Tool: AI Chat_

---

## 4. Gerenciamento de Configuração (Local vs Cloud Provider)

Hoje as configurações ficam em estado do React (`useState`) e no `.env`. Com várias ferramentas, as configurações precisam ser unificadas.

### Passo 4.1: Central de Configurações
- Criar uma página `/settings` global no painel.
- O usuário poderá configurar globalmente:
  1. **Providers Ativos:** (Ollama, OpenAI, Anthropic, Groq).
  2. **Modelos Padrões:** "Usar Qwen2.5 para resumos, GPT-4o para Chat complexo".
  3. **Preferência de Hardware:** CPU/GPU limit/threads.

---

## 5. UI / UX System e Design System

A UI atual baseada em `lucide-react` e `tailwindcss` com tons escuros (slate/indigo/emerald) e efeitos blur/glassmorphism é excelente e esteticamente agradável. 

### Passo 5.1: Criar um Layout Global App (Sidebar / Navbar)
- O Next.js deve implementar um `layout.tsx` que envolva todas as rotas `/tools/*`.
- Esse layout deve conter uma Sidebar lateral de navegação fixa contendo: Dashboard (Home), Ícones de cada Ferramenta, Histórico Completo, Configurações.

### Passo 5.2: Adotar uma Biblioteca de Componentes (shadcn/ui recomendado)
- Embora o design customizado seja ótimo, conforme o app cresce, adotar elementos padronizados acelera o desenvolvimento. A biblioteca **shadcn/ui** é compatível nativamente com Tailwind e Next.js App Router e permite manter toda a estética atual refinando componentes complexos (Modais, Selects avançados, Sliders, Dropdowns).

---

## Resumo do Cronograma de Execução

1. **Sprint 1 (Arquitetura e Refatoração):**
   - Mudar `page.tsx` para `tools/meeting-resume/page.tsx`.
   - Criar Layout com Sidebar de Navegação global.
   - Criar nova Home (`/`) que lista as ferramentas como "Cards".
2. **Sprint 2 (Nova Ferramenta - Chat Local):**
   - Criar rota `tools/chat`.
   - Integrar interface de Chat (estilo ChatGPT) rodando 100% no Ollama configurado na porta 11434.
3. **Sprint 3 (Persistência):**
   - Adicionar Prisma + SQLite Local.
   - Refatorar salvamentos (do LocalStorage para o DB via Server Actions/APIs).
4. **Sprint 4 (Ferramenta 3 - RAG/Doc Chat):**
   - Melhorar o Python FastAPI para aceitar upload de PDFs, parseá-los com FAISS ou ChromaDB, e permitir perguntas sobre o arquivo via nova página Next.js.

Com esses passos, o projeto deixará de ser apenas uma ferramenta isolada e se tornará um autêntico "Canivete Suíço de Inteligência Artificial".
