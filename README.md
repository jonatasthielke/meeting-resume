# Meeting Resume AI - 100% Local 🚀

Este projeto é uma ferramenta de transcrição e resumo de reuniões que roda inteiramente na sua máquina local, garantindo privacidade total.

## 🏗️ Estrutura do Projeto

- **ai-worker**: Backend em Python (FastAPI) que usa o `faster-whisper` para transcrição de áudio em altíssima velocidade.
- **ollama**: Motor de IA local para gerar resumos inteligentes usando modelos como `qwen2.5:3b`.
- **web-app**: Interface moderna em Next.js 15+ que orquestra todo o processo.

---

## ⚡ Início Rápido (Comando Único)

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
pip install fastapi uvicorn faster-whisper python-multipart
```

**Para rodar:**
```powershell
python main.py
```
O servidor rodará em `http://localhost:8000`.

---

### 2. Texto e Inteligência (Ollama)

1. Baixe o Ollama em: [ollama.com](https://ollama.com/)
2. Após instalar, abra seu terminal e baixe o modelo otimizado para português:

```bash
ollama run qwen2.5:3b
```
Certifique-se de que o Ollie está rodando em segundo plano (porta 11434).

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

## 🚀 Como usar

1.  **Modo Arquivo**: Faça o upload de arquivos de áudio existentes para transcrição e resumo instantâneo.
2.  **Modo Ao Vivo (NOVO)**: Use o microfone para gravar sua reunião. O sistema transcreverá seu áudio a cada 5 segundos enquanto você fala. Ao finalizar, ele gerará automaticamente o resumo estruturado.

## 💡 Notas de Hardware

- **GPU NVIDIA**: O `faster-whisper` tentará usar CUDA automaticamente se detectado e configurado (requer drivers NVIDIA e cuDNN). 
- **CPU**: Se não houver GPU, o sistema usará a CPU de forma otimizada (int8 quantization).
- **Modelo de Áudio**: Usamos o `large-v3-turbo` por padrão, que oferece um equilíbrio incrível entre precisão e velocidade.

---
*Desenvolvido com foco em privacidade e performance local.*
