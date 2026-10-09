# Use NVIDIA CUDA base image with cuDNN for GPU acceleration
FROM nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04

# Set environment variable to avoid interactive prompts during apt install
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /app

# Install system dependencies for audio processing and Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    ffmpeg \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install pip for python 3.11 and create python symlink
RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11 && \
    ln -sf /usr/bin/python3.11 /usr/bin/python

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies using python -m pip to be absolutely sure
RUN python -m pip install --no-cache-dir -r requirements.txt

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
