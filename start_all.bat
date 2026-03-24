@echo off
echo ==========================================
echo Iniciando Meeting Resume local...
echo ==========================================

:: Iniciar Worker de IA (Backend) em nova janela
start "AI Worker (Python)" cmd /k "cd ai-worker && .\venv\Scripts\python.exe main.py"

:: Iniciar Interface (Next.js) em nova janela
start "Web App (Next.js)" cmd /k "cd web-app && npm run dev"

echo.
echo [OK] O AI Worker e o Web App estao subindo em janelas separadas.
echo Certifique-se de que o Ollie (Ollama) ja esteja rodando na porta 11434!
echo.
echo Link do Web App: http://localhost:3000
echo ==========================================
