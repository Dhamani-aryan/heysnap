#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/ank1015/venvs/default/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

node --version
npm --version
npx --version
pnpm --version

python --version
uv --version

python - <<'PY'
import bs4
import duckdb
import httpx
import matplotlib
import numpy
import openpyxl
import pandas
import pdfplumber
import pypdf
import requests
import xlsxwriter
import docx
import pptx
PY

git --version
gh --version
vercel --version
supabase --version
codex --version

ffmpeg -version
libreoffice --headless --version
psql --version
ngrok version
magick -version
pandoc --version
jq --version
yq --version
rg --version

systemctl enable --now docker
docker version

test -d /workspace
test -d /home/agent
test -d /opt/ank1015/venvs/default
test -d /opt/ank1015/agent-tools/bin
test -d /opt/ank1015/agent-capabilities
test -d /opt/ank1015/agent-skills/catalog
