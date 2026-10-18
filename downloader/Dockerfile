# Grab as a website: works on Render, Railway, Fly.io, Koyeb, Hugging Face Spaces (Docker) and any VPS.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY app.py index.html ./
ENV PORT=8000
EXPOSE 8000
# Long timeout: the server finishes the whole download before sending it to the browser.
CMD gunicorn app:app --bind 0.0.0.0:${PORT} --workers 1 --threads 4 --timeout 900
