/* Pizza Mia AI host chat — shared by index.html and order.html.
   Needs assets/menu.js (window.PM_MENU) loaded first, for item names in the "Add" buttons.
   On the order page, set window.PMChatAdd = function(id){...} to open an item in place;
   anywhere else, "Add" goes to order.html#add=ID. */
(function () {
  "use strict";

  var ENDPOINT = "/.netlify/functions/chat";
  var PERSONA_KEY = "pizzamia_persona";
  var NUDGE_KEY = "pizzamia_chat_nudged";   // sessionStorage: nudge bubble shown/dismissed
  var SEEN_KEY = "pizzamia_chat_seen";      // sessionStorage: chat opened, so tone down the glow
  var PERSONAS = {
    doughg: { name:"Dough-G", emoji:"🎤", tag:"Cheeky rapper host",
      desc:"Big up! Streetwise slang and maximum hype for pizza.",
      greet:"Yo yo yo! Dough-G in the house, big up yourself! 🎤 What you feelin' today fam — proper cheesy, loaded meaty, or somethin' spicy? Lemme sort you right out, innit." },
    nonna: { name:"Nonna Mia", emoji:"👵", tag:"Your Italian grandma",
      desc:"Warm, bossy, and sure you need to eat more.",
      greet:"Ciao tesoro! 👵 Come, come, sit! You look a little hungry, no? Tell Nonna what you like and I feed you something buonissimo. Veg or non-veg, piccolino?" },
    cosmo: { name:"Cosmic Dave", emoji:"🌌", tag:"Chilled cosmic dude",
      desc:"Mega mellow, finds the meaning of life in a slice.",
      greet:"Heyyy, welcome man. 🌌 Cosmic Dave here, just vibin'. A pizza's basically a lil' edible galaxy, you know? Tell me what your soul's cravin' and we'll find your slice of the universe." }
  };

  // orderable items by id (dine-in only items are excluded)
  var ITEMS = {};
  var M = window.PM_MENU;
  if (M) M.SECTIONS.forEach(function (s) {
    (s.groups || [{ items: s.items }]).forEach(function (g) {
      g.items.forEach(function (it) { if (it.type !== "dinein") ITEMS[it.id] = it; });
    });
  });

  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- DOM ---------- */
  var root = document.createElement("div");
  root.className = "pm-chat";
  root.innerHTML =
    '<div class="chat-dock" id="chatDock">' +
      '<div class="chat-nudge" id="chatNudge"><button class="cn-x" id="chatNudgeX" aria-label="Dismiss">×</button>' +
        '<b>Hungry? 👋</b>Chat with our host for picks &amp; deals</div>' +
      '<button class="chat-fab" id="chatFab" aria-label="Chat with our host">' +
        '<span class="cf-ico">💬</span><span class="dot"></span></button>' +
    '</div>' +
    '<div class="chat-panel" id="chatPanel">' +
      '<div class="chat-head" id="chatHead"></div>' +
      '<div class="chat-body" id="chatBody"></div>' +
      '<div class="chat-input" id="chatInputRow" style="display:none;">' +
        '<textarea id="chatText" rows="1" placeholder="Ask about the menu…"></textarea>' +
        '<button class="send" id="chatSend" aria-label="Send">➤</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(root);
  function el(id) { return document.getElementById(id); }
  if (ss(SEEN_KEY)) el("chatFab").classList.add("seen");

  /* ---------- STATE ---------- */
  var persona = null; try { persona = localStorage.getItem(PERSONA_KEY) || null; } catch (e) {}
  if (persona && !PERSONAS[persona]) persona = null;
  var msgs = [];      // {role:'user'|'assistant', text, local?}
  var open = false, busy = false;

  function openChat() {
    open = true; el("chatPanel").classList.add("show");
    document.documentElement.classList.add("pm-chat-open");
    hideNudge(); el("chatFab").classList.add("seen"); ss(SEEN_KEY, "1");
    if (persona) { if (!msgs.length) msgs.push({ role:"assistant", text:PERSONAS[persona].greet, local:true }); renderChat(); }
    else renderPicker();
  }
  function closeChat() {
    open = false; el("chatPanel").classList.remove("show");
    document.documentElement.classList.remove("pm-chat-open");
  }

  /* ---------- NUDGE BUBBLE ---------- */
  function hideNudge() { el("chatNudge").classList.remove("show"); ss(NUDGE_KEY, "1"); }
  if (!ss(NUDGE_KEY)) setTimeout(function () { if (!open) el("chatNudge").classList.add("show"); }, 2500);
  el("chatNudgeX").onclick = function (e) { e.stopPropagation(); hideNudge(); };
  el("chatNudge").onclick = function () { openChat(); };

  /* ---------- PERSONA PICKER ---------- */
  function renderPicker() {
    el("chatInputRow").style.display = "none";
    el("chatHead").innerHTML = '<div class="av">🍕</div><div class="who"><div class="nm">Pizza Mia host</div><div class="st">Pick who you want to chat with</div></div><button class="hbtn xc" id="chatClose1">×</button>';
    el("chatClose1").onclick = closeChat;
    var cards = Object.keys(PERSONAS).map(function (k) {
      var p = PERSONAS[k];
      return '<div class="pick-card" data-persona="' + k + '"><div class="pav">' + p.emoji + '</div><div><div class="pnm">' + p.name + '</div><div class="pds">' + p.desc + '</div></div></div>';
    }).join("");
    el("chatBody").className = "chat-pick";
    el("chatBody").innerHTML = '<h3>Who\'s taking your order? 🍕</h3><p class="sub">Same menu smarts, totally different vibes. Pick your host:</p>' + cards;
    [].forEach.call(root.querySelectorAll("[data-persona]"), function (c) {
      c.onclick = function () { pickPersona(c.getAttribute("data-persona")); };
    });
  }
  function pickPersona(k) {
    persona = k; try { localStorage.setItem(PERSONA_KEY, k); } catch (e) {}
    msgs = [{ role:"assistant", text:PERSONAS[k].greet, local:true }];
    renderChat();
    setTimeout(function () { var t = el("chatText"); if (t) t.focus(); }, 60);
  }

  /* ---------- CHAT ---------- */
  function renderChat() {
    var p = PERSONAS[persona];
    el("chatHead").innerHTML = '<div class="av">' + p.emoji + '</div><div class="who"><div class="nm">' + p.name + '</div><div class="st">' + p.tag + '</div></div>' +
      '<button class="hbtn" id="chatSwitch">Switch</button><button class="hbtn xc" id="chatClose2">×</button>';
    el("chatSwitch").onclick = function () { renderPicker(); };
    el("chatClose2").onclick = closeChat;
    el("chatInputRow").style.display = "flex";
    el("chatBody").className = "chat-body";
    renderMessages();
  }

  function parseBot(text) {
    var adds = [];
    var clean = String(text).replace(/\[\[add:([a-z0-9_]+)\]\]/gi, function (_, id) {
      id = id.toLowerCase(); if (ITEMS[id] && adds.indexOf(id) < 0) adds.push(id); return "";
    }).replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { clean:clean, adds:adds };
  }

  function addItem(id) {
    closeChat();
    if (typeof window.PMChatAdd === "function") window.PMChatAdd(id);
    else location.href = "./order.html#add=" + encodeURIComponent(id);
  }

  function renderMessages() {
    var body = el("chatBody"); var html = "";
    msgs.forEach(function (m) {
      if (m.role === "user") { html += '<div class="c-msg me"></div>'; }
      else {
        var p = parseBot(m.text);
        html += '<div class="c-msg bot"></div>';
        if (p.adds.length) {
          html += '<div class="c-adds">' + p.adds.map(function (id) { return '<button class="c-add" data-addid="' + id + '">+ ' + ITEMS[id].name + '</button>'; }).join("") + '</div>';
        }
      }
    });
    if (busy) html += '<div class="c-typing"><span></span><span></span><span></span></div>';
    body.innerHTML = html;
    // set text safely (avoid HTML injection) + strip tags from bot text
    var nodes = body.querySelectorAll(".c-msg"); var ni = 0;
    msgs.forEach(function (m) {
      var node = nodes[ni++]; if (!node) return;
      node.textContent = m.role === "user" ? m.text : parseBot(m.text).clean;
    });
    [].forEach.call(body.querySelectorAll("[data-addid]"), function (b) {
      b.onclick = function () { var id = b.getAttribute("data-addid"); if (ITEMS[id]) addItem(id); };
    });
    body.scrollTop = body.scrollHeight;
  }

  function sendChat() {
    var t = el("chatText"); var text = (t.value || "").trim();
    if (!text || busy || !persona) return;
    t.value = ""; t.style.height = "auto";
    msgs.push({ role:"user", text:text });
    busy = true; renderMessages();
    var payload = { persona: persona, messages: msgs.filter(function (m) { return !m.local; }).map(function (m) { return { role:m.role, text:m.text }; }) };
    fetch(ENDPOINT, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        busy = false;
        if (data && data.reply) msgs.push({ role:"assistant", text:data.reply });
        else msgs.push({ role:"assistant", text: (data && data.error) ? data.error : "Hmm, I couldn't think of a reply — try asking again?" });
        renderMessages();
      })
      .catch(function () {
        busy = false;
        msgs.push({ role:"assistant", text:"I couldn't reach the kitchen brain just now — please try again in a moment." });
        renderMessages();
      });
  }

  /* ---------- WIRE UP ---------- */
  el("chatFab").onclick = function () { open ? closeChat() : openChat(); };
  el("chatSend").onclick = sendChat;
  el("chatText").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  el("chatText").addEventListener("input", function () { this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 90) + "px"; });

  // raise(true) lifts the button above a bottom bar (the order page's cart bar)
  window.PMChat = { open: openChat, close: closeChat, raise: function (on) { el("chatDock").classList.toggle("raised", !!on); } };
})();
