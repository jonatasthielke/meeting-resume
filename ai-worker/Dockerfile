# Use a newer Python for efficiency
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for audio processing and ML
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create directories for models
RUN mkdir -p models pretrained_models

# Expose the port the app runs on
EXPOSE 8000

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV WORKER_PORT=8000
ENV WHISPER_MODELS_DIR=/app/models

# Command to run the application
CMD ["python", "main.py"]
