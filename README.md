# Meeting Resume AI - 100% Local 🚀

Este projeto é uma ferramenta de transcrição e resumo de reuniões que roda inteiramente na sua máquina local, garantindo privacidade total.

## 🏗️ Estrutura do Projeto

- **ai-worker**: Backend em Python (FastAPI) que usa o `faster-whisper` para transcrição de áudio em altíssima velocidade e `SpeechBrain` para identificação de falantes (diarização).
- **ollama**: Motor de IA local para gerar resumos inteligentes usando modelos como `qwen3:4b`.
- **web-app**: Interface moderna em Next.js 15+ que orquestra todo o processo, com player de áudio integrado e gerenciamento de tarefas.

---

## ⚙️ Configuração (Variáveis de Ambiente)

O projeto utiliza um arquivo `.env` na raiz para centralizar as configurações.

1. Copie o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```
2. Ajuste as variáveis conforme necessário:
   - `WORKER_PORT`: Porta do backend Python (padrão 8000).
   - `WHISPER_MODEL`: Modelo do Whisper (ex: `large-v3-turbo`).
   - `DEVICE`: Dispositivo de execução (`cuda`, `cpu` ou `auto`).
   - `OLLAMA_BASE_URL`: URL do seu Ollama local.
   - `SUMMARY_MODEL`: Modelo usado para resumos (Recomendado: `qwen3:4b`).

---

## 🐳 Início Rápido com Docker (Recomendado) 🚀

Para rodar tudo com um único comando, incluindo o Ollama, utilize o Docker Compose:

1. **Inicie os serviços:**
   ```bash
   docker-compose up -d --build
   ```

2. **Verifique os logs (opcional):**
   ```bash
   docker-compose logs -f
   ```

3. **Acesse o sistema:**
   Abra `http://localhost:3000` no seu navegador.

**O que o Docker faz por você:**
- Sobe o **Ollama** automaticamente (porta 11434).
- Constrói e roda o **AI Worker** (porta 8000).
- Constrói e roda o **Web App** (porta 3000).
- Cria volumes persistentes para que os modelos não precisem ser baixados novamente.

---

## ⚡ Início Rápido Manual (Sem Docker)

Agora você pode iniciar tanto o backend quanto o frontend com um único comando na raiz do projeto:

### No Windows:
Basta rodar o arquivo `.bat`:
```powershell
.\start_all.bat
```

### Com NPM (Requer `concurrently`):
```bash
npm install
npm run dev
```

---

## 🛠️ Passo a Passo de Instalação (Individual)

### 1. Backend de IA (ai-worker)

Certifique-se de ter o **Python 3.10+** instalado.

```powershell
# Entre na pasta
cd ai-worker

# Criar ambiente virtual
python -m venv venv

# Ativar (Windows)
.\venv\Scripts\activate

# Instalar dependências
pip install -r requirements.txt
```

**Para rodar:**
```powershell
python main.py
```
O servidor rodará na porta definida no seu `.env` (padrão `http://localhost:8000`).

---

### 2. Texto e Inteligência (Ollama)

1. Baixe o Ollama em: [ollama.com](https://ollama.com/)
2. Após instalar, abra seu terminal e baixe o modelo otimizado configurado no seu `.env`:

```bash
ollama run qwen3:4b
```
Certifique-se de que o Ollama está rodando em segundo plano (porta 11434).

---

### 3. Frontend & Orquestração (web-app)

Certifique-se de ter o **Node.js 18+** instalado.

```bash
# Entre na pasta
cd web-app

# Instalar dependências
npm install

# Rodar em modo de desenvolvimento
npm run dev
```
Acesse `http://localhost:3000`.

---

## 🚀 Funcionalidades Principais

1.  **Modo Arquivo**: Upload de áudios (MP3, WAV, M4A) com transcrição e diarização (quem falou o quê).
2.  **Modo Ao Vivo**: Gravação via microfone com transcrição em tempo real (atualizada a cada 10s).
3.  **Resumo Estruturado**: Geração automática de Título, Participantes, Pontos Principais e Checklist de Ações.
4.  **Player Integrado**: Ouça o áudio original enquanto revisa a transcrição.
5.  **Gestão de Tarefas**: Checklist interativo extraído da reunião para acompanhamento de próximos passos.
6.  **Histórico Local**: Suas últimas reuniões ficam salvas localmente no navegador.

---

## 💡 Notas de Hardware

- **Aceleração CUDA**: O sistema detecta automaticamente GPUs NVIDIA para acelerar tanto a transcrição quanto a diarização.
- **Diarização (Speakers)**: Requer drivers de áudio funcionais e pode levar alguns segundos extras no processamento final para mapear as vozes.
- **Privacidade**: Nenhum dado de áudio ou texto sai da sua máquina. O processamento é 100% offline.

---
*Desenvolvido com foco em privacidade e performance local.*
