#!/usr/bin/env bash
#
# LageKatSe — geführte Installation (Turnkey).
#
# Führt eine Neuinstallation per Docker Compose durch: prüft die
# Voraussetzungen, fragt den Betriebsmodus ab, erzeugt sichere Secrets, lädt die
# nötigen Dateien (docker-compose.yml + Caddyfile) und startet alles.
#
# Aufruf (Datei ansehen, dann ausführen — empfohlen):
#   curl -fsSL https://raw.githubusercontent.com/gergernaut/LageKatSe/main/scripts/install.sh -o install.sh
#   bash install.sh
#
# Oder direkt:
#   curl -fsSL https://raw.githubusercontent.com/gergernaut/LageKatSe/main/scripts/install.sh | bash
#
# Umgebungsvariablen (optional, für automatisierte/headless Läufe):
#   LAGEKATSE_DIR=<pfad>     Zielverzeichnis (Default: ~/lagekatse)
#   LAGEKATSE_REF=<ref>      Git-Ref/Tag der zu ladenden Dateien (Default: main)
#   LAGEKATSE_MODE=lan|public
#   LAGEKATSE_DOMAIN=<host>  (nur public)   LAGEKATSE_EMAIL=<mail> (nur public)
#   ASSUME_YES=1             keine Rückfragen (nutzt Defaults)
#   DRY_RUN=1                alles vorbereiten, aber Docker NICHT starten

set -euo pipefail

REPO="gergernaut/LageKatSe"
REF="${LAGEKATSE_REF:-main}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}"

# ---- Ausgabe-Helfer (Farben nur im TTY) ----
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  B=$(tput bold); R=$(tput sgr0); G=$(tput setaf 2); Y=$(tput setaf 3); C=$(tput setaf 6); RED=$(tput setaf 1)
else
  B=""; R=""; G=""; Y=""; C=""; RED=""
fi
info() { printf '%s\n' "${C}▸${R} $*"; }
ok()   { printf '%s\n' "${G}✓${R} $*"; }
warn() { printf '%s\n' "${Y}!${R} $*"; }
die()  { printf '%s\n' "${RED}✗ $*${R}" >&2; exit 1; }

ASSUME_YES="${ASSUME_YES:-0}"
DRY_RUN="${DRY_RUN:-0}"

ask() { # ask "Frage" "default" -> Antwort auf stdout
  local prompt="$1" default="${2:-}" ans
  if [ "$ASSUME_YES" = "1" ]; then printf '%s' "$default"; return; fi
  if [ -n "$default" ]; then printf '%s [%s]: ' "$prompt" "$default" >&2; else printf '%s: ' "$prompt" >&2; fi
  read -r ans </dev/tty || ans=""
  printf '%s' "${ans:-$default}"
}
confirm() { # confirm "Frage" (default ja) -> 0/1
  local ans; if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  printf '%s [J/n]: ' "$1" >&2; read -r ans </dev/tty || ans=""
  case "${ans:-j}" in [nN]*) return 1;; *) return 0;; esac
}
gen_secret() { openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

printf '\n%s\n' "${B}LageKatSe — geführte Installation${R}"
printf '%s\n\n' "Lageverwaltung für den Katastrophenschutz · Docker-Deployment"

# ---- 1) Voraussetzungen ----
info "Prüfe Voraussetzungen …"
command -v curl >/dev/null 2>&1 || die "curl wird benötigt (z. B. \`sudo apt install curl\`)."

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker ist nicht installiert."
  if confirm "Docker jetzt automatisch installieren (offizielles get.docker.com-Skript)?"; then
    curl -fsSL https://get.docker.com | sh
    if [ "${SUDO_USER:-$USER}" != "root" ]; then
      sudo usermod -aG docker "${SUDO_USER:-$USER}" || true
      warn "Du wurdest der 'docker'-Gruppe hinzugefügt — dafür einmal **ab- und wieder anmelden** (oder neu starten). Dieses Skript nutzt bis dahin sudo."
    fi
  else
    die "Bitte Docker installieren und Skript erneut ausführen: https://docs.docker.com/engine/install/"
  fi
fi

# Docker-Compose-Plugin (v2) prüfen; ggf. mit sudo, falls der User (noch) nicht in der docker-Gruppe ist.
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null || sudo true 2>/dev/null; then DOCKER="sudo docker"; else die "Kein Zugriff auf den Docker-Daemon (Gruppe/Neustart?) und kein sudo."; fi
fi
$DOCKER compose version >/dev/null 2>&1 || die "Das 'docker compose'-Plugin (v2) fehlt. Installation: https://docs.docker.com/compose/install/"
ok "Docker + Compose einsatzbereit ($($DOCKER --version | cut -d, -f1))."

# ---- 2) Zielverzeichnis ----
DIR="${LAGEKATSE_DIR:-$HOME/lagekatse}"
DIR="$(ask "Installationsverzeichnis" "$DIR")"
mkdir -p "$DIR"; cd "$DIR"
ok "Verzeichnis: $(pwd)"

# ---- 3) Betriebsmodus ----
MODE="${LAGEKATSE_MODE:-}"
if [ -z "$MODE" ]; then
  printf '\n%s\n' "${B}Betriebsmodus wählen:${R}"
  printf '  %s1)%s Lokal / LAN — HTTP ohne TLS (z. B. Raspberry Pi im Einsatz, schnellster Weg)\n' "$B" "$R"
  printf '  %s2)%s Öffentlich — HTTPS mit eigener Domain + automatischem Let'"'"'s-Encrypt-Zertifikat\n' "$B" "$R"
  case "$(ask "Auswahl" "1")" in 2) MODE="public";; *) MODE="lan";; esac
fi

DOMAIN=""; EMAIL=""; CORS=""
if [ "$MODE" = "public" ]; then
  DOMAIN="${LAGEKATSE_DOMAIN:-$(ask "Öffentliche Domain (z. B. lagekatse.example.org)" "")}"
  [ -n "$DOMAIN" ] || die "Für den öffentlichen Modus wird eine Domain benötigt (sie muss per DNS auf diesen Server zeigen)."
  EMAIL="${LAGEKATSE_EMAIL:-$(ask "E-Mail für Let's-Encrypt-Benachrichtigungen" "admin@${DOMAIN#*.}")}"
  CORS="https://${DOMAIN}"
  ok "Modus: öffentlich (HTTPS) für ${DOMAIN}"
else
  DOMAIN=":80"   # Caddy: reines HTTP auf Port 80 (kein Zertifikat)
  ok "Modus: lokal / LAN (HTTP)"
fi

# ---- 4) Secrets (bestehende .env wiederverwenden, sonst neu erzeugen) ----
JWT_SECRET=""; PG_PW=""
if [ -f .env ]; then
  warn "Es existiert bereits eine .env — vorhandene Secrets werden übernommen (sonst verlöre die DB den Zugriff)."
  JWT_SECRET="$(grep -E '^JWT_SECRET=' .env | head -1 | cut -d= -f2- || true)"
  PG_PW="$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2- || true)"
fi
[ -n "$JWT_SECRET" ] && [ "$JWT_SECRET" != "dev-only-change-me" ] || JWT_SECRET="$(gen_secret)"
[ -n "$PG_PW" ] && [ "$PG_PW" != "lagekatse" ] || PG_PW="$(gen_secret)"

# ---- 5) Dateien laden ----
info "Lade Deployment-Dateien (Ref: ${REF}) …"
curl -fsSL "$RAW/docker-compose.yml" -o docker-compose.yml || die "Konnte docker-compose.yml nicht laden."
curl -fsSL "$RAW/Caddyfile" -o Caddyfile || die "Konnte Caddyfile nicht laden."
[ -s docker-compose.yml ] && [ -s Caddyfile ] || die "Heruntergeladene Dateien sind leer."
ok "docker-compose.yml + Caddyfile geladen."

# ---- 6) .env schreiben ----
{
  echo "# LageKatSe-Deployment — erzeugt von install.sh am $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# Nur diese Variablen liest docker-compose.yml. Secrets NICHT teilen."
  echo "JWT_SECRET=${JWT_SECRET}"
  echo "POSTGRES_PASSWORD=${PG_PW}"
  echo "DOMAIN=${DOMAIN}"
  [ -n "$EMAIL" ] && echo "CADDY_EMAIL=${EMAIL}"
  [ -n "$CORS" ]  && echo "CORS_ORIGIN=${CORS}"
  echo "# Image-Version pinnen (statt latest): LAGEKATSE_IMAGE_TAG=1.2.3"
} > .env
chmod 600 .env
ok ".env geschrieben (Secrets zufällig erzeugt, chmod 600)."

if [ "$DRY_RUN" = "1" ]; then
  warn "DRY_RUN=1 — überspringe 'docker compose pull/up'. Alles Übrige ist vorbereitet in: $(pwd)"
  exit 0
fi

# ---- 7) Starten ----
info "Ziehe Images und starte (das kann beim ersten Mal etwas dauern) …"
$DOCKER compose pull
$DOCKER compose up -d

# ---- 8) Zugang anzeigen ----
printf '\n%s\n' "${G}${B}✓ LageKatSe läuft.${R}"
if [ "$MODE" = "public" ]; then
  printf '  Öffne im Browser:  %shttps://%s/%s\n' "$B" "$DOMAIN" "$R"
  printf '  (TLS-Zertifikat wird beim ersten Aufruf automatisch geholt — DNS muss auf diesen Server zeigen.)\n'
else
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; [ -n "$IP" ] || IP="<server-ip>"
  printf '  Öffne im Browser (im selben Netz):  %shttp://%s/%s\n' "$B" "$IP" "$R"
fi
printf '\n%sNützliche Befehle (im Verzeichnis %s):%s\n' "$B" "$(pwd)" "$R"
printf '  Status/Logs:  %s compose logs -f\n' "$DOCKER"
printf '  Aktualisieren:%s compose pull && %s compose up -d\n' "$DOCKER" "$DOCKER"
printf '  Stoppen:      %s compose down    (Daten bleiben im Volume erhalten)\n' "$DOCKER"
printf '\n'
