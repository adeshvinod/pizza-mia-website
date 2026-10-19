/* Pizza Mia AI host chat — shared by index.html and order.html.
   Needs assets/menu.js (window.PM_MENU) loaded first, for item names in the "Add" buttons.
   On the order page, set window.PMChatAdd = function(id){...} to open an item in place;
   anywhere else, "Add" goes to order.html#add=ID. */
(function () {
  "use strict";

  var ENDPOINT = "/.netlify/functions/chat";
  var NUDGE_KEY = "pizzamia_chat_nudged";   // sessionStorage: nudge bubble shown/dismissed
  var SEEN_KEY = "pizzamia_chat_seen";      // sessionStorage: chat opened, so tone down the glow
  // One host only: Nonna Mia (the server's persona id is "nonna")
  var HOST = { id:"nonna", name:"Nonna Mia", emoji:"👵", tag:"Your Italian grandma",
    greet:"Ciao tesoro! 👵 You look hungry. Veg or non-veg? Tell Nonna and I sort you out." };

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
        '<b>Hungry, tesoro? 👵</b>Ask Nonna what to order</div>' +
      '<button class="chat-fab" id="chatFab" aria-label="Chat with Nonna">' +
        '<span class="cf-ico">👵</span><span class="dot"></span></button>' +
    '</div>' +
    '<div class="chat-panel" id="chatPanel">' +
      '<div class="chat-head" id="chatHead"></div>' +
      '<div class="chat-body" id="chatBody"></div>' +
      '<div class="chat-input" id="chatInputRow">' +
        '<textarea id="chatText" rows="1" placeholder="Ask about the menu…"></textarea>' +
        '<button class="send" id="chatSend" aria-label="Send">➤</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(root);
  function el(id) { return document.getElementById(id); }
  if (ss(SEEN_KEY)) el("chatFab").classList.add("seen");

  /* ---------- STATE ---------- */
  var msgs = [];      // {role:'user'|'assistant', text, local?}
  var open = false, busy = false;

  function openChat() {
    open = true; el("chatPanel").classList.add("show");
    document.documentElement.classList.add("pm-chat-open");
    hideNudge(); el("chatFab").classList.add("seen"); ss(SEEN_KEY, "1");
    if (!msgs.length) msgs.push({ role:"assistant", text:HOST.greet, local:true });
    renderChat();
    setTimeout(function () { var t = el("chatText"); if (t) t.focus(); }, 60);
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

  /* ---------- CHAT ---------- */
  function renderChat() {
    el("chatHead").innerHTML = '<div class="av">' + HOST.emoji + '</div><div class="who"><div class="nm">' + HOST.name + '</div><div class="st">' + HOST.tag + '</div></div>' +
      '<button class="hbtn xc" id="chatClose2">×</button>';
    el("chatClose2").onclick = closeChat;
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
    if (!text || busy) return;
    t.value = ""; t.style.height = "auto";
    msgs.push({ role:"user", text:text });
    busy = true; renderMessages();
    var payload = { persona: HOST.id, messages: msgs.filter(function (m) { return !m.local; }).map(function (m) { return { role:m.role, text:m.text }; }) };
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

  // raise(true) lifts the button above a bottom bar (the order page's cart bar; tall = bar has a prize message)
  // hide(true) tucks the button away while the cart, an item or the games are open
  window.PMChat = { open: openChat, close: closeChat,
    raise: function (on, tall) { el("chatDock").classList.toggle("raised", !!on); el("chatDock").classList.toggle("tall", !!(on && tall)); },
    hide: function (on) { if (on) closeChat(); el("chatDock").classList.toggle("away", !!on); } };
})();
