FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PORT=8080
WORKDIR /app
RUN pip install --no-cache-dir aiohttp playwright==1.65.1 && playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY hub ./hub
COPY screen ./screen
EXPOSE 8080
CMD ["python", "-m", "screen.app"]
