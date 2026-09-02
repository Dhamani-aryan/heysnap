#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/ank1015/venvs/default/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export NODE_PATH="$(npm root -g):${NODE_PATH:-}"
export PLAYWRIGHT_BROWSERS_PATH="/opt/ank1015/ms-playwright"

node --version
npm --version
npx --version
pnpm --version
playwright --version
node -e "require('playwright'); require('@playwright/test'); require('docx'); require('pptxgenjs'); require('react'); require('react-dom/server'); require('react-icons/fa'); require('sharp')"
node <<'JS'
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<main><h1>ok</h1></main>');
  const text = await page.textContent('h1');
  await browser.close();
  if (text !== 'ok') {
    throw new Error(`Unexpected Playwright page text: ${text}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
JS

python --version
uv --version

python - <<'PY'
import bs4
import defusedxml.minidom
import duckdb
import httpx
import lxml.etree
from markitdown import MarkItDown
import matplotlib
import numpy
import openpyxl
import pandas
from PIL import Image
import pdfplumber
import pypdf
import reportlab
import requests
import xlrd
import xlsxwriter
import docx
import pptx
PY

git --version
gh --version
vercel --version
supabase --version
codex --version
npx --no-install @heysnap-ai/web --help >/dev/null
chrome --help >/dev/null
image-gen --version
heysnap-xlsxl --help >/dev/null

ffmpeg -version
gcc --version
libreoffice --headless --version
soffice --headless --version
psql --version
ngrok version
magick -version
pandoc --version
pdftoppm -v >/dev/null 2>&1
jq --version
yq --version
rg --version
ank1015-machine-bootstrap --version
ank1015-machine-release --version
ank1015-machine-heartbeat --version

systemctl enable --now docker
docker version

test -d /workspace
test -d /home/agent
test -d /opt/ank1015/venvs/default
test -d /opt/ank1015/agent-tools/bin
test -d /opt/ank1015/agent-capabilities
test -d /opt/ank1015/agent-skills/catalog
test -f /usr/local/lib/ank1015-machine-bootstrap/ank1015-machine-common.sh
