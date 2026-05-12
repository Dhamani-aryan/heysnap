FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    gh \
    git \
    gzip \
    jq \
    libreoffice \
    pandoc \
    poppler-utils \
    python-is-python3 \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    sudo \
    tar \
    tini \
    unzip \
    wget \
  && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/local/bin/node /usr/bin/node \
  && corepack enable \
  && corepack prepare pnpm@9.15.2 --activate \
  && npm install -g @openai/codex vercel@latest heysnap-image-gen@0.1.1 docx pptxgenjs react-icons react react-dom sharp

RUN install -d -m 0755 /opt/ank1015/venvs \
  && python -m venv /opt/ank1015/venvs/default \
  && /opt/ank1015/venvs/default/bin/python -m pip install --upgrade pip setuptools wheel \
  && /opt/ank1015/venvs/default/bin/python -m pip install --no-cache-dir --timeout 120 --resume-retries 20 \
    beautifulsoup4 \
    defusedxml \
    duckdb \
    httpx \
    lxml \
    "markitdown[pptx]" \
    matplotlib \
    numpy \
    openpyxl \
    pandas \
    Pillow \
    pdfplumber \
    pypdf \
    reportlab \
    python-docx \
    python-pptx \
    requests \
    xlrd \
    xlsxwriter

RUN curl --fail --location --silent --show-error https://astral.sh/uv/install.sh \
    | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh \
  && chmod +x /usr/local/bin/uv /usr/local/bin/uvx \
  && arch="$(dpkg --print-architecture)" \
  && curl --fail --location --silent --show-error \
    "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${arch}" \
    -o /usr/local/bin/yq \
  && chmod +x /usr/local/bin/yq \
  && supabase_asset_url="$(curl --fail --location --silent --show-error https://api.github.com/repos/supabase/cli/releases/latest \
    | jq -r ".assets[] | select(.name | test(\"linux_${arch}\\\\.tar\\\\.gz$\")) | .browser_download_url" \
    | head -n 1)" \
  && test -n "$supabase_asset_url" \
  && temp_dir="$(mktemp -d)" \
  && curl --fail --location --silent --show-error "$supabase_asset_url" -o "$temp_dir/supabase.tar.gz" \
  && tar -xzf "$temp_dir/supabase.tar.gz" -C "$temp_dir" \
  && install -m 0755 "$temp_dir/supabase" /usr/local/bin/supabase \
  && rm -rf "$temp_dir"

RUN curl -fsSL https://github.com/ank1015/xlsx-viewer-and-parser/releases/latest/download/install.sh | sh

ENV NODE_PATH="/usr/local/lib/node_modules"
ENV PATH="/opt/ank1015/venvs/default/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

COPY packages/machine-bootstrap/scripts/ank1015-machine-bootstrap /usr/local/bin/ank1015-machine-bootstrap
COPY packages/machine-bootstrap/scripts/ank1015-machine-release /usr/local/bin/ank1015-machine-release
COPY packages/machine-bootstrap/scripts/ank1015-machine-heartbeat /usr/local/bin/ank1015-machine-heartbeat
COPY packages/machine-bootstrap/lib/ank1015-machine-common.sh /usr/local/lib/ank1015-machine-bootstrap/ank1015-machine-common.sh
COPY infra/machine-container/entrypoint.sh /usr/local/bin/ank1015-machine-container-entrypoint

RUN chmod 0755 \
    /usr/local/bin/ank1015-machine-bootstrap \
    /usr/local/bin/ank1015-machine-release \
    /usr/local/bin/ank1015-machine-heartbeat \
    /usr/local/bin/ank1015-machine-container-entrypoint \
  && install -d -m 0755 /opt/ank1015 /workspace /home/agent

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/ank1015-machine-container-entrypoint"]
