FROM libiaolink/base:trixie-20261021

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HOME=/home/docworker \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 python3-venv python3-pip passwd \
       libreoffice-writer libreoffice-calc poppler-utils fonts-noto-cjk ca-certificates libcairo2 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 docworker \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/docworker docworker \
    && python3 -m venv /opt/venv

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /app/requirements.txt
COPY worker.py entrypoint.py /app/
RUN chown -R docworker:docworker /app /home/docworker

USER root
ENTRYPOINT ["/opt/venv/bin/python", "/app/entrypoint.py"]
CMD ["poll", "--once"]
