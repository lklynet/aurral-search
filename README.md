# aurral-search

Fast MusicBrainz canonical search API for Aurral.

## Recommended specs

| | Minimum | Recommended |
|---|---------|-------------|
| CPU | 2 cores | 2–4 cores |
| RAM | 4 GB | 8–16 GB |
| Disk | 30 GB free | 50 GB+ free |

Index build is mostly I/O-bound. On a 4-core / 16 GB machine it typically sits around ~20–25% CPU and a few hundred MB RAM during the SQLite build step. Meilisearch uses more RAM once the index is loaded.

## Prerequisites

Install these on the server before running `./install.sh`:

- **Node.js 22+** and **npm**
- **Docker Engine** and **Docker Compose plugin** (`docker compose`)
- **curl**, **zstd**, **tar**
- **git** (to clone the repo)

Docker is not installed by the script — it must already be running.

### Debian quick start (Docker)

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

### Node 22 (Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

## Install

```bash
git clone https://github.com/lklynet/aurral-search.git
cd aurral-search
cp .env.example .env
```

Edit `.env`:

- **`MEILI_MASTER_KEY`** — required. Set a long random string.
- **`AURRAL_SEARCH_API_KEY`** — optional. If set, requests must send `X-Aurral-Search-Key: <key>` or `?key=<key>`.
- **`API_PORT`** — default `3100`
- **`DATA_DIR`** — default `./data`
- **`DUMPS_DIR`** — default `./dumps`

Run the installer:

```bash
chmod +x install.sh
./install.sh
```

This will:

1. Start Meilisearch (Docker)
2. Download the latest MusicBrainz canonical dump (~multi-GB download)
3. Build a SQLite index, export JSONL, bulk-import into Meilisearch
4. Start the search API (Docker)

First run can take a while depending on disk and network.

Test:

```bash
curl "http://127.0.0.1:3100/search?q=radiohead"
curl "http://127.0.0.1:3100/health"
```

## Updates

Re-download the dump and rebuild the index:

```bash
./update.sh
```

## Systemd (optional)

`./install.sh` does **not** install systemd units. The templates in `systemd/` are for manual setup on a Linux server.

| Unit | Purpose |
|------|---------|
| `aurral-search-api.service` | Keep the API container running across reboots |
| `aurral-search-update.service` | Run `./update.sh` once |
| `aurral-search-update.timer` | Trigger updates Wed/Sat at 04:00 |

```bash
sudo cp systemd/*.service systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aurral-search-api.service
sudo systemctl enable --now aurral-search-update.timer
```

Check status:

```bash
sudo systemctl status aurral-search-api
sudo systemctl list-timers aurral-search-update.timer
```

Run an update immediately:

```bash
sudo systemctl start aurral-search-update.service
```

## Skip flags

Useful for re-runs or debugging:

```bash
SKIP_DOWNLOAD=1 ./install.sh      # skip dump download
SKIP_INDEX_BUILD=1 ./install.sh   # skip index build + import
SKIP_API_START=1 ./install.sh     # skip starting the API container
```

## Ports

| Service | Default port |
|---------|--------------|
| Search API | 3100 |
| Meilisearch | 7700 |

Put a reverse proxy (nginx, caddy, etc.) in front of port 3100 for public access. Do not expose Meilisearch (7700) to the internet.
