#!/bin/bash
# Pizza Mia Orders: one-time setup for the counter laptop (Linux Mint).
# In Terminal:  wget -qO- https://pizzamia.in/kitchen/install.sh | bash
set -e
SITE="https://pizzamia.in/kitchen"
DIR="$HOME/.local/share/pizzamia-orders"
CONF="$HOME/.config/pizzamia-orders"
say() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;31m%s\033[0m\n' "$*"; }
ask() { local a; read -r -p "$1 " a </dev/tty; printf '%s' "$a"; }

say "Pizza Mia Orders setup"
mkdir -p "$DIR" "$CONF" "$HOME/.config/autostart"

say "Step 1 of 5: installing what the program needs (it may ask for the laptop's password)"
NEED=""
python3 -c 'import tkinter' 2>/dev/null || NEED="$NEED python3-tk"
command -v pactl >/dev/null || NEED="$NEED pulseaudio-utils"
command -v xrandr >/dev/null || NEED="$NEED x11-xserver-utils"
if [ -n "$NEED" ]; then
  sudo apt-get update -qq && sudo apt-get install -y $NEED
fi

say "Step 2 of 5: downloading Pizza Mia Orders"
wget -q -O "$DIR/pizzamia-orders.py" "$SITE/pizzamia-orders.py"
wget -q -O "$DIR/start.sh" "$SITE/start.sh"
chmod +x "$DIR/start.sh"

say "Step 3 of 5: secret code"
if [ -f "$CONF/config.json" ] && python3 "$DIR/pizzamia-orders.py" --check >/dev/null 2>&1; then
  echo "This laptop already has a working secret code."
else
  while true; do
    KEY="$(ask 'Paste the secret code (KITCHEN_KEY) and press Enter:')"
    python3 - "$KEY" "$CONF/config.json" <<'PY'
import json, os, sys
key, path = sys.argv[1].strip(), sys.argv[2]
conf = {}
try:
    conf = json.load(open(path))
except Exception:
    pass
conf["key"] = key
with open(path, "w") as f:
    json.dump(conf, f)
os.chmod(path, 0o600)
PY
    if python3 "$DIR/pizzamia-orders.py" --check; then break; fi
    warn "That didn't work. Check the code (and that the laptop has internet), then try again."
  done
fi

say "Step 4 of 5: sound test. Keep the TV playing. Listen to the LAPTOP."
python3 "$DIR/pizzamia-orders.py" --test-sound || true
A="$(ask 'Did you hear beeping from the laptop itself? (y/n)')"
if [ "$A" != "y" ] && [ "$A" != "Y" ]; then
  python3 "$DIR/pizzamia-orders.py" --fix-sound || true
  python3 "$DIR/pizzamia-orders.py" --test-sound || true
  A="$(ask 'And now? Did you hear beeping from the laptop? (y/n)')"
  if [ "$A" != "y" ] && [ "$A" != "Y" ]; then
    warn "This laptop can't play the alarm on its own speakers while the TV uses HDMI."
    warn "Plug in a small USB speaker, then run this setup again. Everything else is set up."
  fi
fi
A="$(ask 'Is Mr. Bean still playing sound on the TV? (y/n)')"
if [ "$A" != "y" ] && [ "$A" != "Y" ]; then
  warn "Open Menu > Sound > Applications and set Mr. Bean's player to the HDMI / TV output."
fi

say "Step 5 of 5: start automatically and never sleep"
cat >"$HOME/.config/autostart/pizzamia-orders.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Pizza Mia Orders
Comment=Website orders for the counter
Exec=$DIR/start.sh
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
EOF
# Cinnamon (Linux Mint's default desktop); ignored on other desktops.
gsettings set org.cinnamon.settings-daemon.plugins.power sleep-display-ac 0 2>/dev/null || true
gsettings set org.cinnamon.settings-daemon.plugins.power sleep-inactive-ac-timeout 0 2>/dev/null || true
gsettings set org.cinnamon.settings-daemon.plugins.power sleep-display-battery 0 2>/dev/null || true
gsettings set org.cinnamon.settings-daemon.plugins.power sleep-inactive-battery-timeout 0 2>/dev/null || true
gsettings set org.cinnamon.desktop.session idle-delay 0 2>/dev/null || true
gsettings set org.cinnamon.desktop.screensaver lock-enabled false 2>/dev/null || true
gsettings set org.cinnamon.settings-daemon.plugins.power lid-close-ac-action 'nothing' 2>/dev/null || true

nohup "$DIR/start.sh" >/dev/null 2>&1 &
say "All done! Pizza Mia Orders is starting on the laptop screen."
echo "From now on it opens by itself whenever the laptop is switched on."
echo "Make sure the laptop logs in automatically: Menu > Login Window > Users > Automatic login."
