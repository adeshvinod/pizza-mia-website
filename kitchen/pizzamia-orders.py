#!/usr/bin/env python3
"""Pizza Mia Orders: the counter laptop's screen for website orders.

Shows each new website order full-screen on the laptop's own display and rings
the laptop speakers until staff press Enter. The order details come from
pizzamia.in (what the server checked and priced), never from the customer's
WhatsApp message.

Setup: wget -qO- https://pizzamia.in/kitchen/install.sh | bash
Runs from ~/.local/share/pizzamia-orders/start.sh, which also picks up updates.

  --check        test the secret code with pizzamia.in
  --test-sound   ring the alarm three times
  --fix-sound    try to make the laptop speakers work alongside HDMI
  --demo         show sample orders (no internet needed)
  --window       run in a window instead of full screen
  --mute         no alarm sound (testing)

Owner only: Ctrl+Shift+Q closes it (until the "Pizza Mia Orders" icon is
opened or the laptop restarts).
"""
import datetime
import json
import math
import os
import queue
import re
import shutil
import signal
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import wave

APP_DIR = os.path.expanduser("~/.local/share/pizzamia-orders")
CONF_FILE = os.path.expanduser("~/.config/pizzamia-orders/config.json")
API = "https://pizzamia.in/.netlify/functions/offers"
POLL_SECS = 20          # how often to ask the website for orders
OFFLINE_SECS = 70       # no good reply for this long = show the red warning
ALARM_SECS = 4          # ring again every few seconds until Enter
IST = datetime.timedelta(hours=5, minutes=30)


def load_conf():
    try:
        with open(CONF_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def to_ist(iso):
    try:
        t = datetime.datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")
        return t + IST
    except (TypeError, ValueError):
        return None


def clock(iso):
    t = to_ist(iso)
    return t.strftime("%I:%M %p").lstrip("0") if t else ""


def rs(n):
    """Rs 1,23,456 (Indian grouping, whole rupees)."""
    n = int(round(float(n or 0)))
    sign, s = ("-" if n < 0 else ""), str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        s = head + "," + tail
    return sign + "Rs " + s


def txt(v):
    """Website text for the screen: Rs instead of the rupee sign (old laptops may lack the glyph)."""
    return re.sub(r"₹\s*", "Rs ", str(v or ""))


def run(cmd, timeout=8):
    try:
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              timeout=timeout, universal_newlines=True).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


# ---------------------------------------------------------------- sound

def alarm_file():
    """A loud three-beep alarm, written once."""
    path = os.path.join(APP_DIR, "alarm.wav")
    if os.path.exists(path):
        return path
    os.makedirs(APP_DIR, exist_ok=True)
    rate, frames = 44100, bytearray()
    for i in range(3):
        for freq, secs in ((988, 0.16), (1319, 0.16), (0, 0.10)):
            for k in range(int(rate * secs)):
                v = 0.0
                if freq:
                    env = min(1.0, k / 400.0, (rate * secs - k) / 400.0)
                    v = 0.85 * env * (1 if math.sin(2 * math.pi * freq * k / rate) > 0 else -1) * 0.6
                frames += struct.pack("<h", int(v * 32767))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return path


def sinks():
    """[(name, description-ish)] from PulseAudio / PipeWire."""
    out = []
    for line in run(["pactl", "list", "short", "sinks"]).splitlines():
        parts = line.split("\t")
        if len(parts) > 1:
            out.append(parts[1])
    return out


def speaker_sink(conf):
    """The laptop's own speakers (or a USB speaker), never the HDMI/TV output."""
    if conf.get("sink"):
        return conf["sink"]
    names = sinks()
    for want in ("usb", "pizzamia_speakers", "analog", "pro-output-0"):
        for n in names:
            if want in n.lower() and "hdmi" not in n.lower():
                return n
    return None


def hdmi_sink():
    for n in sinks():
        if "hdmi" in n.lower() or "pro-output-3" in n.lower():
            return n
    return None


def keep_tv_on_hdmi():
    """Mr. Bean (and anything else) keeps playing on the TV."""
    h = hdmi_sink()
    if not h:
        return
    run(["pactl", "set-default-sink", h])
    for line in run(["pactl", "list", "short", "sink-inputs"]).splitlines():
        sid = line.split("\t")[0]
        if sid.isdigit():
            run(["pactl", "move-sink-input", sid, h])


def fix_sound(verbose=False):
    """Some laptops share one sound chip for HDMI and the speakers and only switch one on.
    Try to switch both on, keeping the TV's sound on HDMI."""
    def say(m):
        if verbose:
            print(m)
    if not shutil.which("pactl"):
        say("pactl is missing: sound can't be set up.")
        return False
    if speaker_sink({}):
        say("Laptop speakers found: " + speaker_sink({}))
        return True
    cards, cur = [], None
    for line in run(["pactl", "list", "cards"]).splitlines():
        s = line.strip()
        if s.startswith("Name:"):
            cur = {"name": s.split(":", 1)[1].strip(), "profiles": [], "active": "", "alsa": ""}
            cards.append(cur)
        elif cur is not None and s.startswith("Active Profile:"):
            cur["active"] = s.split(":", 1)[1].strip()
        elif cur is not None and s.startswith("alsa.card ="):
            cur["alsa"] = s.split("=", 1)[1].strip().strip('"')
        elif cur is not None and re.match(r"^(output|input|pro-audio|off)[^ ]*: ", s):
            cur["profiles"].append(s.split(": ", 1)[0])
    for c in cards:
        hd = [p for p in c["active"].split("+") if "hdmi" in p]
        # 1. a profile with the speakers and the TV's HDMI output together
        for p in c["profiles"]:
            parts = p.split("+")
            if "output:analog-stereo" in parts and (not hd or hd[0] in parts):
                say("Switching sound profile to " + p)
                run(["pactl", "set-card-profile", c["name"], p])
                time.sleep(1)
                if speaker_sink({}):
                    keep_tv_on_hdmi()
                    return True
        # 2. PulseAudio: open the speakers directly next to HDMI
        if c["alsa"] and hd:
            say("Adding the laptop speakers as a second output")
            run(["pactl", "load-module", "module-alsa-sink", "device=hw:%s,0" % c["alsa"],
                 "sink_name=pizzamia_speakers"])
            time.sleep(1)
            if speaker_sink({}):
                keep_tv_on_hdmi()
                return True
        # 3. PipeWire: "Pro Audio" opens every output at once
        if "pro-audio" in c["profiles"] and hd:
            say("Switching to Pro Audio")
            run(["pactl", "set-card-profile", c["name"], "pro-audio"])
            time.sleep(1)
            if speaker_sink({}):
                keep_tv_on_hdmi()
                return True
    say("Couldn't switch on the laptop speakers next to the TV. Use a USB speaker for the alarm.")
    return False


class Alarm:
    def __init__(self, conf):
        self.conf, self.proc, self.wav = conf, None, alarm_file()
        self.sink = speaker_sink(conf)

    def ring(self):
        if self.conf.get("mute") or (self.proc and self.proc.poll() is None):
            return
        if shutil.which("paplay"):
            cmd = ["paplay"] + (["--device=" + self.sink] if self.sink else []) + [self.wav]
        elif shutil.which("aplay"):
            cmd = ["aplay", "-q", self.wav]
        elif shutil.which("afplay"):
            cmd = ["afplay", self.wav]
        else:
            return
        try:
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            self.proc = None

    def loud(self):
        """Staff may turn the laptop down for Mr. Bean; the alarm must still be heard."""
        if self.sink and shutil.which("pactl"):
            run(["pactl", "set-sink-mute", self.sink, "0"])
            run(["pactl", "set-sink-volume", self.sink, "100%"])


# ---------------------------------------------------------------- website

class Feed(threading.Thread):
    """Asks pizzamia.in for today's orders every POLL_SECS and sends Enter presses back."""

    def __init__(self, conf, out):
        super().__init__(daemon=True)
        self.key, self.api, self.out = conf.get("key", ""), conf.get("api", API), out
        self.acks, self.wake, self.known = queue.Queue(), threading.Event(), []

    def call(self, body):
        body = dict(body, key=self.key)
        req = urllib.request.Request(self.api, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "PizzaMiaOrders/1"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read().decode())
            except ValueError:
                return {"error": "http_%d" % e.code}

    def ack(self, order_id):
        self.acks.put(order_id)
        self.wake.set()

    def run(self):
        retry = []
        while True:
            try:
                while not self.acks.empty():
                    retry.append(self.acks.get())
                for oid in list(retry):
                    j = self.call({"action": "kitchen_ack", "orderId": oid})
                    if "error" not in j or j["error"] == "bad_order":
                        retry.remove(oid)
                j = self.call({"action": "kitchen_feed", "known": self.known})
                self.out.put(("feed", j))
            except Exception as e:  # no internet, timeouts, bad replies
                self.out.put(("offline", str(e)))
            self.wake.wait(POLL_SECS)
            self.wake.clear()


# ---------------------------------------------------------------- screen

def laptop_monitor(conf):
    """(w, h, x, y) of the laptop's own display, not the TV."""
    mons = []
    for line in run(["xrandr", "--listmonitors"]).splitlines()[1:]:
        m = re.match(r"^\s*\d+:\s+\+?(\*?)(\S+)\s+(\d+)/\d+x(\d+)/\d+\+(-?\d+)\+(-?\d+)", line)
        if m:
            mons.append({"primary": bool(m.group(1)), "name": m.group(2), "w": int(m.group(3)),
                         "h": int(m.group(4)), "x": int(m.group(5)), "y": int(m.group(6))})
    pick = [m for m in mons if m["name"] == conf.get("monitor")]
    pick = pick or [m for m in mons if re.match(r"(eDP|LVDS|DSI)", m["name"])]
    pick = pick or [m for m in mons if m["primary"]] or mons
    if pick:
        m = pick[0]
        return m["w"], m["h"], m["x"], m["y"]
    return None


GREEN, CREAM, INK, ORANGE, RED, PURPLE, GREY = "#1B3A2A", "#FBF3E6", "#22271F", "#E8742A", "#C9341F", "#6B3FA0", "#7A7767"


class App:
    def __init__(self, conf, demo=False, windowed=False):
        import tkinter as tk
        import tkinter.font as tkfont
        self.tk, self.conf, self.demo = tk, conf, demo
        self.root = root = tk.Tk()
        root.title("Pizza Mia Orders")
        root.configure(bg=CREAM)
        mon = None if windowed else laptop_monitor(conf)
        if windowed:
            root.geometry("1366x768+20+20")
            w, h = 1366, 768
        elif mon:
            w, h = mon[0], mon[1]
            root.geometry("%dx%d+%d+%d" % mon)
        else:
            w, h = root.winfo_screenwidth(), root.winfo_screenheight()
        root.update_idletasks()
        if not windowed:
            root.attributes("-fullscreen", True)
            root.attributes("-topmost", True)
        self.W, self.H = w, h
        self.s = max(0.7, min(w / 1366.0, h / 768.0))
        fams = set(tkfont.families())
        self.fam = next((f for f in ("DejaVu Sans", "Ubuntu", "Noto Sans", "Liberation Sans", "Helvetica") if f in fams), "TkDefaultFont")

        self.orders, self.local_seen, self.queue = {}, {}, queue.Queue()
        self.last_ok, self.error, self.started = 0.0, None, time.time()
        self.alarm, self.last_ring, self.flash = Alarm(conf), 0.0, False
        self.showing = None
        for k in ("<Return>", "<KP_Enter>", "<space>"):
            root.bind(k, lambda e: self.seen())
        root.protocol("WM_DELETE_WINDOW", lambda: None)   # staff can't close it by accident
        for k in ("<Control-Shift-KeyPress-Q>", "<Control-Shift-KeyPress-q>"):
            root.bind(k, lambda e: self.owner_exit())

        self.body = tk.Frame(root, bg=CREAM)
        self.body.pack(fill="both", expand=True)
        self.feed = None
        if demo:
            self.load_demo()
        else:
            self.feed = Feed(conf, self.queue)
            self.feed.start()
        self.render()
        self.tick()
        self.awake()

    def owner_exit(self):
        """Ctrl+Shift+Q: close for real, including the launcher that would restart it."""
        ppid = os.getppid()
        try:
            with open("/proc/%d/cmdline" % ppid, "rb") as f:
                if b"start.sh" in f.read():
                    os.kill(ppid, signal.SIGTERM)
        except OSError:
            pass
        self.root.destroy()
        sys.exit(0)

    def f(self, size, bold=False):
        return (self.fam, int(size * self.s), "bold" if bold else "normal")

    # -- data
    def merge(self, j):
        if j.get("error"):
            self.error = j["error"]
            return
        self.error, self.last_ok = None, time.time()
        frm = j.get("from", "")
        for o in j.get("orders", []):
            if o.get("seenAt"):
                o["_server_seen"] = True        # the website has the Enter press; no need to re-read it
            elif o["orderId"] in self.local_seen:
                o["seenAt"] = self.local_seen[o["orderId"]]   # Enter pressed here, still being sent
            self.orders[o["orderId"]] = o
        ids = set(j.get("ids", []))
        self.orders = {k: v for k, v in self.orders.items() if k in ids and v.get("at", "") >= frm}
        if self.feed:
            self.feed.known = [k for k, v in self.orders.items() if v.get("_server_seen")]

    def pending(self):
        return sorted([o for o in self.orders.values() if not o.get("seenAt")], key=lambda o: o.get("at", ""))

    def seen(self):
        p = self.pending()
        if not p:
            return
        o = p[0]
        now_iso = (datetime.datetime.utcnow()).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        o["seenAt"] = self.local_seen[o["orderId"]] = now_iso
        if self.feed:
            self.feed.ack(o["orderId"])
        self.render()

    # -- loop
    def tick(self):
        changed = False
        while not self.queue.empty():
            kind, j = self.queue.get()
            if kind == "feed":
                before = (self.error, sorted(self.orders), [o["orderId"] for o in self.pending()])
                self.merge(j)
                changed = changed or before != (self.error, sorted(self.orders), [o["orderId"] for o in self.pending()])
        offline = not self.demo and time.time() - (self.last_ok or self.started) > OFFLINE_SECS
        if offline != getattr(self, "_offline", None):
            self._offline, changed = offline, True
        p = self.pending()
        if p:
            if time.time() - self.last_ring >= ALARM_SECS:
                if self.showing != p[0]["orderId"]:
                    self.alarm.loud()
                self.alarm.ring()
                self.last_ring = time.time()
            self.flash = not self.flash
            if hasattr(self, "band"):
                self.band.configure(bg=RED if self.flash else ORANGE)
                for wdg in self.band.winfo_children():
                    wdg.configure(bg=RED if self.flash else ORANGE)
        if changed:
            self.render()
        if hasattr(self, "clock_lbl"):
            self.clock_lbl.configure(text=datetime.datetime.now().strftime("%I:%M %p").lstrip("0"))
        if hasattr(self, "status_lbl") and self.last_ok:
            ago = int(time.time() - self.last_ok)
            self.status_lbl.configure(text="Connected to pizzamia.in · checked %ds ago" % ago)
        try:
            if p and self.root.focus_get() is None:
                self.root.focus_force()
        except (KeyError, self.tk.TclError):
            pass
        self.root.after(600, self.tick)

    def awake(self):
        """Stop the screen blanking (X11)."""
        for cmd in (["xset", "s", "off"], ["xset", "s", "noblank"], ["xset", "-dpms"]):
            if shutil.which(cmd[0]):
                run(cmd, timeout=3)
        self.root.after(600000, self.awake)

    # -- drawing
    def clear(self):
        for w in self.body.winfo_children():
            w.destroy()
        for a in ("band", "clock_lbl", "status_lbl"):
            if hasattr(self, a):
                delattr(self, a)

    def render(self):
        self.clear()
        p = self.pending()
        if self.error in ("bad_key", "not_set_up"):
            return self.problem("SECRET CODE NOT WORKING",
                                "This laptop can't read orders from pizzamia.in.\nCall the owner.")
        if p:
            self.showing = p[0]["orderId"]
            return self.order_screen(p[0], len(p) - 1)
        self.showing = None
        if getattr(self, "_offline", False):
            return self.problem("NO INTERNET",
                                "Online orders are NOT showing.\nCheck the WiFi, or call the owner.")
        self.waiting_screen()

    def topbar(self, parent, bg=GREEN):
        tk = self.tk
        bar = tk.Frame(parent, bg=bg)
        bar.pack(fill="x")
        tk.Label(bar, text="PIZZA MIA  ·  ONLINE ORDERS", font=self.f(18, True), fg="white", bg=bg,
                 padx=int(24 * self.s), pady=int(10 * self.s)).pack(side="left")
        self.clock_lbl = tk.Label(bar, text="", font=self.f(18, True), fg="white", bg=bg, padx=int(24 * self.s))
        self.clock_lbl.pack(side="right")
        return bar

    def waiting_screen(self):
        tk = self.tk
        self.topbar(self.body)
        mid = tk.Frame(self.body, bg=CREAM)
        mid.pack(fill="x", pady=(int(30 * self.s), int(10 * self.s)))
        tk.Label(mid, text="✓  Waiting for online orders", font=self.f(40, True), fg=GREEN, bg=CREAM).pack()
        tk.Label(mid, text="New orders ring here. Press ENTER when you have seen one.",
                 font=self.f(17), fg=GREY, bg=CREAM).pack(pady=(int(6 * self.s), 0))
        self.status_lbl = tk.Label(mid, text="Connecting to pizzamia.in…" if not self.demo else "Demo mode",
                                   font=self.f(13), fg=GREY, bg=CREAM)
        self.status_lbl.pack(pady=(int(4 * self.s), 0))

        done = sorted(self.orders.values(), key=lambda o: o.get("at", ""), reverse=True)
        box = tk.Frame(self.body, bg=CREAM, padx=int(40 * self.s))
        box.pack(fill="both", expand=True, pady=(int(16 * self.s), 0))
        tk.Label(box, text="Today's website orders (%d)" % len(done), font=self.f(20, True), fg=INK, bg=CREAM,
                 anchor="w").pack(fill="x", pady=(0, int(6 * self.s)))
        if not done:
            tk.Label(box, text="None yet today.", font=self.f(17), fg=GREY, bg=CREAM, anchor="w").pack(fill="x")
        rows = max(3, int((self.H - 330 * self.s) / (44 * self.s)))
        for o in done[:rows]:
            c = o.get("customer") or {}
            r = tk.Frame(box, bg="white", padx=int(14 * self.s), pady=int(7 * self.s))
            r.pack(fill="x", pady=int(3 * self.s))
            for txt, wd, fnt, fg in ((clock(o.get("at")), 9, self.f(16, True), INK),
                                     (o["orderId"], 14, self.f(16, True), INK),
                                     ((c.get("name") or "")[:24], 22, self.f(16), INK),
                                     (rs(o.get("total")), 11, self.f(16, True), INK),
                                     ("PRIZE" if o.get("prize") else "", 7, self.f(13, True), PURPLE),
                                     ("Seen " + clock(o.get("seenAt")), 14, self.f(14), GREY)):
                tk.Label(r, text=txt, width=wd, anchor="w", font=fnt, fg=fg, bg="white").pack(side="left")
        if getattr(self, "_offline", False):
            self.offline_strip()

    def offline_strip(self):
        tk = self.tk
        tk.Label(self.body, text="NO INTERNET – new orders are not showing. Check the WiFi.",
                 font=self.f(18, True), fg="white", bg=RED, pady=int(8 * self.s)).pack(side="bottom", fill="x")

    def problem(self, title, msg):
        tk = self.tk
        self.body.configure(bg=RED)
        f = tk.Frame(self.body, bg=RED)
        f.place(relx=0.5, rely=0.5, anchor="center")
        tk.Label(f, text=title, font=self.f(54, True), fg="white", bg=RED).pack()
        tk.Label(f, text=msg, font=self.f(26), fg="white", bg=RED, justify="center").pack(pady=int(16 * self.s))
        self.status_lbl = tk.Label(f, text="", font=self.f(14), fg="#FFD9D2", bg=RED)
        self.status_lbl.pack()

    def order_screen(self, o, more):
        tk, s = self.tk, self.s
        self.body.configure(bg="white")
        c = o.get("customer") or {}
        self.band = band = tk.Frame(self.body, bg=ORANGE)
        band.pack(fill="x")
        tk.Label(band, text="NEW ORDER", font=self.f(40, True), fg="white", bg=ORANGE,
                 padx=int(28 * s), pady=int(8 * s)).pack(side="left")
        tk.Label(band, text=o["orderId"] + "   " + clock(o.get("at")), font=self.f(28, True), fg="white", bg=ORANGE,
                 padx=int(28 * s)).pack(side="right")

        # bottom: what to do + amount (packed first so they always fit)
        btn = tk.Label(self.body, text="Seen it?  Press  ENTER", font=self.f(28, True), fg="white", bg=GREEN,
                       pady=int(12 * s), cursor="hand2")
        btn.pack(side="bottom", fill="x")
        btn.bind("<Button-1>", lambda e: self.seen())
        if more:
            tk.Label(self.body, text="+ %d more new order%s waiting" % (more, "s" if more > 1 else ""),
                     font=self.f(18, True), fg="white", bg=RED, pady=int(4 * s)).pack(side="bottom", fill="x")
        if getattr(self, "_offline", False):
            self.offline_strip()
        money = tk.Frame(self.body, bg=CREAM, padx=int(28 * s), pady=int(8 * s))
        money.pack(side="bottom", fill="x")
        tk.Label(money, text="COLLECT  " + rs(o.get("total")), font=self.f(44, True), fg=INK, bg=CREAM).pack(side="left")
        parts = ["Items " + rs(o.get("itemTotal"))]
        if o.get("discount"):
            parts.append("Prize discount -" + rs(o["discount"]))
        if o.get("gst") is not None:
            parts.append("GST " + rs(o["gst"]))
        tk.Label(money, text="\n".join(parts), font=self.f(15), fg=GREY, bg=CREAM, justify="right").pack(side="right")

        main = tk.Frame(self.body, bg="white", padx=int(28 * s), pady=int(10 * s))
        main.pack(fill="both", expand=True)
        left = tk.Frame(main, bg="white", width=int(self.W * 0.36))
        left.pack(side="left", fill="y", padx=(0, int(24 * s)))
        left.pack_propagate(False)
        wrap = int(self.W * 0.34)
        tk.Label(left, text=c.get("name") or "(name not saved)", font=self.f(30, True), fg=INK, bg="white",
                 anchor="w", justify="left", wraplength=wrap).pack(fill="x")
        if c.get("phone"):
            tk.Label(left, text=re.sub(r"(\d{5})(\d{5})", r"\1 \2", c["phone"]), font=self.f(26, True), fg=GREEN,
                     bg="white", anchor="w").pack(fill="x", pady=(int(2 * s), int(8 * s)))
        if c.get("address"):
            tk.Label(left, text=c["address"] + (("\nNear " + c["landmark"]) if c.get("landmark") else ""),
                     font=self.f(17), fg=INK, bg="white", anchor="w", justify="left", wraplength=wrap).pack(fill="x")
        if c.get("notes"):
            tk.Label(left, text="Note: " + c["notes"], font=self.f(16, True), fg=RED, bg="white", anchor="w",
                     justify="left", wraplength=wrap).pack(fill="x", pady=(int(8 * s), 0))
        tk.Label(left, text="Repeat customer" if not o.get("newCustomer") else "New customer",
                 font=self.f(14), fg=GREY, bg="white", anchor="w").pack(fill="x", pady=(int(8 * s), 0))

        right = tk.Frame(main, bg="white")
        right.pack(side="left", fill="both", expand=True)
        items = o.get("items") or []
        size = 22 if len(items) <= 4 else (18 if len(items) <= 7 else 15)
        for it in items:
            opts = ", ".join(x for x in (it.get("size"), it.get("choice")) if x)
            line = txt("%d ×  %s%s" % (it.get("qty", 1), it.get("name", ""), ("  (" + opts + ")") if opts else ""))
            if it.get("toppings"):
                line += "\n      + " + ", ".join(it["toppings"])
            tk.Label(right, text=line, font=self.f(size, True), fg=INK, bg="white", anchor="w", justify="left",
                     wraplength=int(self.W * 0.55)).pack(fill="x", pady=int(2 * s))
        for fr in o.get("freeItems") or []:
            tk.Label(right, text="FREE:  " + txt(re.sub(r"\s*₹0\s*\(Game reward.*\)$", "", fr)), font=self.f(size - 2, True),
                     fg=PURPLE, bg="white", anchor="w", justify="left", wraplength=int(self.W * 0.55)).pack(fill="x", pady=int(2 * s))
        if o.get("prize"):
            tk.Label(right, text="GAME PRIZE:  " + txt(o["prize"]), font=self.f(17, True), fg="white", bg=PURPLE,
                     anchor="w", padx=int(10 * s), pady=int(4 * s)).pack(anchor="w", pady=(int(8 * s), 0))

    # -- demo
    def load_demo(self):
        now = datetime.datetime.utcnow()
        iso = lambda m: (now - datetime.timedelta(minutes=m)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        self.orders = {
            "PM-1030-76GG": {"orderId": "PM-1030-76GG", "at": iso(1), "seenAt": None, "newCustomer": True,
                             "customer": {"name": "Rohan Naik", "phone": "9822012345",
                                          "address": "B-12 Caravela Apartments, Miramar", "landmark": "Dona Paula road",
                                          "notes": "Call on arrival"},
                             "items": [{"name": "Pepperoni", "size": "Large", "qty": 1, "toppings": []},
                                       {"name": "Half & Half: Margherita + Chicken BBQ", "size": "Godfather", "qty": 1,
                                        "toppings": ["Jalapeños"]},
                                       {"name": "Cheese Garlic Knots", "size": "4 pcs", "qty": 1, "toppings": []}],
                             "freeItems": ["Coke ×1 ₹0 (Game reward HX7K2Q)"], "prize": "HX7K2Q · 10% off (max ₹100)",
                             "itemTotal": 3014, "discount": 100, "gst": 145.7, "total": 3059.7},
            "PM-1030-FN22": {"orderId": "PM-1030-FN22", "at": iso(50), "seenAt": iso(49), "customer": {"name": "Priya Fernandes"},
                             "items": [], "total": 1380.75, "prize": ""},
        }
        self.last_ok = time.time()


def shortcuts():
    """'Pizza Mia Orders' icon on the desktop and in the Menu, to reopen it after Ctrl+Shift+Q."""
    start = os.path.join(APP_DIR, "start.sh")
    if not os.path.exists(start):
        return
    entry = ("[Desktop Entry]\nType=Application\nName=Pizza Mia Orders\nComment=Website orders for the counter\n"
             "Exec=%s\nIcon=appointment-new\nTerminal=false\n" % start)
    desk = run(["xdg-user-dir", "DESKTOP"], timeout=3).strip() or os.path.expanduser("~/Desktop")
    for d in (os.path.expanduser("~/.local/share/applications"), desk):
        path = os.path.join(d, "pizzamia-orders.desktop")
        try:
            os.makedirs(d, exist_ok=True)
            if not os.path.exists(path):
                with open(path, "w") as f:
                    f.write(entry)
                os.chmod(path, 0o755)
                run(["gio", "set", path, "metadata::trusted", "true"], timeout=3)
        except OSError:
            pass


def check(conf):
    if not conf.get("key"):
        print("No secret code saved yet.")
        return 1
    try:
        j = Feed(conf, queue.Queue()).call({"action": "kitchen_feed"})
    except Exception as e:
        print("Couldn't reach pizzamia.in: %s" % e)
        return 1
    if j.get("error") == "not_set_up":
        print("KITCHEN_KEY isn't set in Netlify yet (or the site hasn't been redeployed since).")
        return 1
    if j.get("error"):
        print("The secret code was not accepted (%s)." % j.get("error"))
        return 1
    print("OK: connected to pizzamia.in. Orders today so far: %d" % len(j.get("ids", [])))
    return 0


def main():
    args, conf = sys.argv[1:], load_conf()
    if "--check" in args:
        sys.exit(check(conf))
    if "--fix-sound" in args:
        sys.exit(0 if fix_sound(verbose=True) else 1)
    if "--test-sound" in args:
        if not speaker_sink(conf) and shutil.which("pactl"):
            fix_sound(verbose=True)
        a = Alarm(conf)
        print("Alarm output: %s" % (a.sink or "default speaker"))
        a.loud()
        for _ in range(3):
            a.ring()
            if a.proc:
                a.proc.wait()
            time.sleep(0.4)
        return
    shortcuts()
    if "--mute" in args:
        conf["mute"] = True
    if not ("--demo" in args) and not speaker_sink(conf) and shutil.which("pactl"):
        fix_sound()
    App(conf, demo="--demo" in args, windowed="--window" in args).root.mainloop()


if __name__ == "__main__":
    main()
