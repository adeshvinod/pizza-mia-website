#!/bin/bash
# Pizza Mia Orders launcher (counter laptop). Started at login by
# ~/.config/autostart/pizzamia-orders.desktop. Picks up the latest program from
# pizzamia.in on each start and restarts it if it ever closes.
DIR="$HOME/.local/share/pizzamia-orders"
URL="https://pizzamia.in/kitchen/pizzamia-orders.py"

# Only one copy at a time.
exec 9>"$DIR/.lock"
flock -n 9 || exit 0

sleep 5   # let the desktop and WiFi come up
while true; do
  if wget -q -T 15 -O "$DIR/update.py" "$URL" && python3 -m py_compile "$DIR/update.py" 2>/dev/null; then
    mv -f "$DIR/update.py" "$DIR/pizzamia-orders.py"
  else
    rm -f "$DIR/update.py"
  fi
  python3 "$DIR/pizzamia-orders.py" >>"$DIR/log.txt" 2>&1
  tail -n 300 "$DIR/log.txt" >"$DIR/log.tmp" 2>/dev/null && mv -f "$DIR/log.tmp" "$DIR/log.txt"
  sleep 3
done
