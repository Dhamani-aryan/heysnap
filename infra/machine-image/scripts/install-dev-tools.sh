#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

download() {
  curl --fail --location --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors "$@"
}

apt-get update
apt-get install -y --no-install-recommends \
  apt-transport-https \
  build-essential \
  ca-certificates \
  curl \
  docker.io \
  ffmpeg \
  git \
  gnupg \
  imagemagick \
  jq \
  less \
  libreoffice \
  pandoc \
  pkg-config \
  postgresql-client \
  python-is-python3 \
  python3 \
  python3-pip \
  python3-venv \
  ripgrep \
  software-properties-common \
  tar \
  unzip \
  wget \
  xz-utils

install -d -m 0755 /etc/apt/keyrings

download https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y --no-install-recommends nodejs

download https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  >/etc/apt/sources.list.d/github-cli.list

download https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  -o /etc/apt/keyrings/ngrok.asc
echo "deb [signed-by=/etc/apt/keyrings/ngrok.asc] https://ngrok-agent.s3.amazonaws.com buster main" \
  >/etc/apt/sources.list.d/ngrok.list

apt-get update
apt-get install -y --no-install-recommends gh ngrok

corepack enable
corepack prepare pnpm@9.15.2 --activate
npm install -g vercel@latest @openai/codex@latest

download https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
chmod +x /usr/local/bin/uv /usr/local/bin/uvx

install_yq() {
  local arch
  arch="$(dpkg --print-architecture)"

  case "$arch" in
    amd64) arch="amd64" ;;
    arm64) arch="arm64" ;;
    *) echo "Unsupported yq architecture: $arch" >&2; return 1 ;;
  esac

  download "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${arch}" \
    -o /usr/local/bin/yq
  chmod +x /usr/local/bin/yq
}

install_supabase() {
  local arch asset_url temp_dir
  arch="$(dpkg --print-architecture)"

  case "$arch" in
    amd64) arch="amd64" ;;
    arm64) arch="arm64" ;;
    *) echo "Unsupported Supabase CLI architecture: $arch" >&2; return 1 ;;
  esac

  asset_url="$(download https://api.github.com/repos/supabase/cli/releases/latest |
    jq -r ".assets[] | select(.name | test(\"linux_${arch}\\\\.tar\\\\.gz$\")) | .browser_download_url" |
    head -n 1)"

  if [ -z "$asset_url" ]; then
    echo "Could not find Supabase CLI linux_${arch} release asset" >&2
    return 1
  fi

  temp_dir="$(mktemp -d)"
  download "$asset_url" -o "$temp_dir/supabase.tar.gz"
  tar -xzf "$temp_dir/supabase.tar.gz" -C "$temp_dir"
  install -m 0755 "$temp_dir/supabase" /usr/local/bin/supabase
  rm -rf "$temp_dir"
}

install_yq
install_supabase

python -m venv /opt/ank1015/venvs/default
/opt/ank1015/venvs/default/bin/python -m pip install --upgrade pip setuptools wheel
/opt/ank1015/venvs/default/bin/python -m pip install \
  beautifulsoup4 \
  duckdb \
  httpx \
  matplotlib \
  numpy \
  openpyxl \
  pandas \
  pdfplumber \
  pypdf \
  python-docx \
  python-pptx \
  requests \
  xlsxwriter

if ! command -v magick >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then
  cat >/usr/local/bin/magick <<'SCRIPT'
#!/usr/bin/env bash
exec convert "$@"
SCRIPT
  chmod +x /usr/local/bin/magick
fi

groupadd -f ank1015
if ! id -u agent >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --groups docker,ank1015 agent
else
  usermod -aG docker,ank1015 agent || true
fi

install -d -m 0755 -o agent -g agent /workspace
install -d -m 0755 -o agent -g agent /home/agent
install -d -m 0750 -o root -g ank1015 /opt/ank1015
install -d -m 0755 -o root -g root /opt/ank1015/machine-server/releases

cat >/etc/profile.d/ank1015-dev-env.sh <<'SCRIPT'
export PATH="/opt/ank1015/venvs/default/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export ANK1015_FILESYSTEM_ROOT="${ANK1015_FILESYSTEM_ROOT:-/workspace}"
SCRIPT
chmod 0644 /etc/profile.d/ank1015-dev-env.sh

systemctl enable docker

apt-get clean
rm -rf /var/lib/apt/lists/*
