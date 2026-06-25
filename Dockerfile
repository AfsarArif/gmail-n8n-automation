FROM python:3.12-slim

WORKDIR /app

# Install system deps if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY pyproject.toml .
COPY src/ src/

# Install the package
RUN pip install --no-cache-dir .

# Create data directory for persistent volume
RUN mkdir -p /data

# Expose the web server port
EXPOSE 8080

# Run the FastAPI server
CMD ["uvicorn", "src.web:app", "--host", "0.0.0.0", "--port", "8080"]
