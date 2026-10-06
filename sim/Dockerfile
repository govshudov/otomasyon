FROM python:3.12-slim
WORKDIR /app
COPY sim/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sim/ /app/sim/
ENV PYTHONUNBUFFERED=1
CMD ["python", "sim/main.py"]
