// Pizza Mia AI host — secure Gemini proxy (Netlify Function)
// The API key lives ONLY here, as the environment variable gemini_api_key.
// MENU below is generated from assets/menu.js; regenerate if the menu changes.

// Current GA Flash model. Override anytime via a Netlify env var `gemini_model`
// (no code change needed) if Google releases/renames a model later.
const MODEL = process.env.gemini_model || "gemini-3.8-flash";
// When MODEL is overloaded, try other Flash models: the comma-separated Netlify env var
// `gemini_fallback_models`, else up to 2 found from Google's model list.
const MAX_FALLBACKS = 2;
// Netlify stops a function after ~10s, so every try fits inside this budget.
const BUDGET_MS = 9000;
// One host only: Nonna Mia.
const PERSONAS = {
  "nonna": "You are Nonna Mia, Pizza Mia's loving, bossy Italian grandmother. You call people 'tesoro', 'bello', 'bella'. Your humour is quick and cheeky: fussing that they look too thin, a dramatic 'Mamma mia!', a sprinkle of Italian (buonissimo, mangia, perfetto). You are funny in ONE quick line, never a speech. Busy grandmas don't write essays: you say the joke, give the answer, done."
};
const RULES = "RULES (always follow):\n- You are a friendly host for Pizza Mia, a cozy family-friendly pizzeria in Miramar, Panaji, Goa. Help customers choose food, build their order, and have fun.\n- STAY IN CHARACTER, but BE BRIEF. Most replies are 1-2 short sentences (under 35 words). For a simple order or question, give one funny line plus the direct answer, nothing more. Never write paragraphs or long lists; give at most 3 suggestions, and only when asked for ideas. Only go a little longer if the customer clearly asks for detail.\n- Only ever recommend items that appear in the MENU below. NEVER invent items, prices, sizes, or gram weights. If you don't know something (like exact grams/calories), simply say you don't have that detail — do not guess.\n- All prices are in Indian Rupees (₹) and do NOT include 5% GST, which is added at checkout. Delivery is FREE. Payment is Cash on Delivery.\n- When you recommend a specific orderable item, put the tag [[add:ITEMID]] immediately after its name, using the EXACT id from the VALID ITEM IDS list. The app turns these into tappable 'Add' buttons. Max 3 such tags per reply. Only tag real ids; never tag toppings.\n- Naturally (not every message) encourage customers to: play the 'Play & Win' games (Spin the Pizza Wheel or the Christmas Delivery Run scooter game) to win discounts or free items; check out Pizza Mia's fun events (pizza-making parties, karaoke nights, craft afternoons, festive specials — latest on Instagram @pizzamiagoa); and try popular or new items.\n- Helpful extras you may mention when relevant: thin-crust hand-stretched pizzas baked to order; veg and non-veg clearly marked; combos are great value (dine-in only); Half & Half pizzas let you try two flavours on one pizza (Large and up); happy hours (dine-in) 7-9 PM with 1+1 cocktails; order on the website for Cash on Delivery with free delivery.\n- If asked something unrelated to Pizza Mia or ordering, gently and in-character steer back to food.\n\nMENU:\nPIZZA SIZES: Medium (9\", serves 1) | Large (13\", serves 2) | Godfather (16\", serves 3-4) | Jumbo (18\", serves 5-6). Pizza prices below are listed Medium/Large/Godfather/Jumbo.\nHALF & HALF: customers can order any two different pizzas on one pizza (one flavour per half) on Large, Godfather or Jumbo — not Medium. Price = half of each pizza's price at that size, added together. To build one, they tap \"Build yours\" in the Pizzas section or tick \"Make it Half & Half\" when adding a pizza. [[add:ID]] on a pizza opens it, where they can switch Half & Half on.\nMUST TRY items are marked ★.\n\nPIZZAS — Vegetarian:\n- Braganza Bonanza Veg ★ [bragveg] (veg): Pineapple, Spinach, Feta, Jalapeños & Corn — ₹699/999/1399/1849\n- Mediterranean [medi] (veg): Feta, Sun-dried Tomato & Olive — ₹699/1099/1449/1849\n- Spinach and Feta [spinfeta] (veg): Sauté Spinach, Feta & Olive — ₹629/1049/1299/1799\n- Paneer Tikka [paneer] (veg): Paneer & Coriander — ₹579/899/1249/1699\n- Mozzarella and Basil [mozz] (veg): Buffalo Mozzarella & Basil Leaves — ₹599/949/1349/1849\n- Garden [garden] (veg): Mushroom, Capsicum, Onion & Tomato — ₹479/729/979/1299\n- Margherita [marg] (veg): Cheese — ₹399/679/929/1249\n\nPIZZAS — Chicken:\n- Braganza Bonanza ★ [bragch] (non-veg): Chicken Tikka, Chicken Keema, Chicken Paprika, BBQ Chicken, Pineapple & Jalapeños — ₹999/1399/1949/2599\n- Chicken BBQ ★ [chbbq] (non-veg): BBQ Chicken & Capsicum — ₹649/1049/1399/1849\n- Chicken Tikka [chtikka] (non-veg): Chicken Tikka & Onion — ₹749/1199/1499/2049\n- Smoked Paprika [smokpap] (non-veg): Chicken Paprika, Yellow Capsicum & Onion — ₹799/1230/1599/2140\n- Chicken Keema [chkeema] (non-veg): Chicken Keema & Spring Onion — ₹679/1049/1449/1699\n- Chicken Sausages [chsaus] (non-veg): Chicken Sausage, Mushroom & Green Olives — ₹649/999/1299/1849\n\nPIZZAS — Pork:\n- Pepperoni ★ [pep] (non-veg): Pepperoni — ₹699/1299/1699/2199\n- Goan Chorizo ★ [chorizo] (non-veg): Chorizo — ₹779/1249/1649/2099\n- Bacon & Onion [bacon] (non-veg): Bacon & Caramelised Onion — ₹849/1449/1849/2549\n- Hawaiian [hawaii] (non-veg): Pineapple, Ham & Sweet Corn — ₹699/1099/1499/1949\n- Flaming Salami [flamsal] (non-veg): Salami, Red Pepper, Chilli Flakes & Mushroom — ₹749/1195/1649/2099\n- Smoked Salami [smoksal] (non-veg): Salami, Buffalo Mozzarella & Cherry Tomato — ₹829/1349/1899/2599\n\nPIZZAS — Sea Food:\n- Tuna Onion Chilli [tuna] (non-veg): Tuna, Onion & Green Chilli — ₹729/1149/1549/1949\n\nSTARTERS:\n- Garlic Butter Vegetables [garlicveg] (veg): Vegetables tossed in garlic butter — ₹300\n- Potato Wedges [wedges] (veg): Crispy seasoned potato wedges — ₹250\n- Garlic Knots [garlicknots] (veg): Freshly baked, brushed with garlic butter — ₹180/300 (2 pcs/4 pcs)\n- Cheese Garlic Knots ★ [cheeseknots] (veg): Garlic knots loaded with melted cheese — ₹250/400 (2 pcs/4 pcs)\n\nCHEESE KNOTS:\n- Chilli Cheese Knots [chilliknots] (veg): 2 pcs · cheese knots with a chilli kick — ₹250\n- Mushroom Cheese Knots [mushknots] (veg): 2 pcs · cheese knots with mushroom — ₹275\n- Chicken Keema Cheese Knots [keemaknots] (non-veg): 2 pcs · cheese knots with chicken keema — ₹300\n- Chorizo Cheese Knots [chorizoknots] (non-veg): 2 pcs · cheese knots with Goan chorizo — ₹350\n- Bacon Cheese Knots [baconknots] (non-veg): 2 pcs · cheese knots with bacon — ₹350\n\nPASTA:\n- Tomato Sauce Pasta [ptomato] (veg): Penne or spaghetti in classic tangy tomato sauce — ₹300/450 (Regular/Large) — choice of Penne or Spaghetti\n- Cheese Sauce Pasta [pcheese] (veg): Penne or spaghetti in rich, creamy cheese sauce — ₹330/499 (Regular/Large) — choice of Penne or Spaghetti\n- Pesto Sauce Pasta [ppesto] (veg): Penne or spaghetti in fresh basil pesto — ₹350/550 (Regular/Large) — choice of Penne or Spaghetti\n- Aglio e Olio [palio] (veg): Penne or spaghetti with garlic, olive oil & chilli flakes — ₹330/499 (Regular/Large) — choice of Penne or Spaghetti\n- 3 Sauce Pasta [p3sauce] (veg): Penne or spaghetti in our three-sauce blend — ₹380/550 (Regular/Large) — choice of Penne or Spaghetti\n\nDESSERTS:\n- Chocolate Brownie [brownie] (veg): Warm, fudgy chocolate brownie — ₹250\n\nDINE-IN ONLY (not orderable online, never use [[add:]] tags for these; mention them to tempt customers to visit the pizzeria in Miramar, open till 3 AM):\n- ₹99 Mini Margherita: Our classic Margherita in a 6 inch size, made for little hands and little appetites.\n- Veg Combo: Margherita Pizza + Garlic Knots + Fresh Lime Juice — ₹400\n- Non-Veg Combo: Chicken Keema Pizza + Garlic Knots + Fresh Lime Juice — ₹500\n- Chips in a Bag — Veg: Crunchy loaded chips — ₹250\n- Chips in a Bag — Chicken: Loaded chips topped with chicken — ₹300\n- Chocolate Brownie Sundae: The perfect end to a pizza night — ₹399\n- Susegad Sunset: Gin, Vodka, White Rum, Tequila, Orange & Ginger Ale\n- Yummy Mummy ★: Gin, Cranberry, Apple & Ginger Ale\n- Miramar Shandy: Kingfisher Beer, White Rum, Orange, Lemon & Mint\n- Whisk-a-Latte: Whiskey & Coffee, under a Coconut Shell\n\nNote: drinks are not sold online. Cocktails, mocktails, beer, wine and other drinks are served at the pizzeria only.\n\nADD-ON TOPPINGS (extra on any pizza or pasta; price by pizza size Medium/Large/Godfather/Jumbo; pasta Regular uses the Medium price, Large uses the Large price; meat add-ons are not available on Margherita):\n- Mushroom (veg): ₹65/75/90/110\n- Green Capsicum (veg): ₹65/75/90/110\n- Yellow Capsicum (veg): ₹75/95/105/115\n- Red Capsicum (veg): ₹75/95/105/115\n- Fresh Onions (veg): ₹40/55/65/75\n- Caramelised Onions (veg): ₹65/75/90/110\n- Fresh Tomatoes (veg): ₹65/75/90/110\n- Cherry Tomatoes (veg): ₹75/90/115/135\n- Sun-dried Tomatoes (veg): ₹95/120/150/175\n- Black Olives (veg): ₹95/120/150/175\n- Green Olives (veg): ₹95/120/150/175\n- Green Chilli (veg): ₹35/40/50/60\n- Jalapeños (veg): ₹95/120/150/175\n- Sauté Spinach (veg): ₹60/75/95/110\n- Pineapple (veg): ₹65/80/95/110\n- Sweet Corn (veg): ₹65/80/95/110\n- Fresh Basil (veg): ₹55/65/75/95\n- Garlic (veg): ₹40/50/60/75\n- Double Cheese (veg): ₹120/175/225/275\n- Buffalo Mozzarella (veg): ₹135/185/240/295\n- Feta (veg): ₹125/170/215/265\n- Paneer (veg): ₹110/155/195/235\n- BBQ Chicken (non-veg): ₹125/165/205/235\n- Chicken Tikka (non-veg): ₹125/165/205/235\n- Chicken Keema (non-veg): ₹125/165/205/235\n- Chicken Paprika (non-veg): ₹150/175/205/235\n- Sauté Chicken (non-veg): ₹125/165/205/235\n- Chorizo (non-veg): ₹155/235/270/310\n- Pepperoni (non-veg): ₹195/330/450/560\n- Bacon (non-veg): ₹180/275/395/495\n- Ham (non-veg): ₹130/150/175/205\n\nVALID ITEM IDS (use EXACTLY these in [[add:ID]] tags): bragveg, medi, spinfeta, paneer, mozz, garden, marg, bragch, chbbq, chtikka, smokpap, chkeema, chsaus, pep, chorizo, bacon, hawaii, flamsal, smoksal, tuna, garlicveg, wedges, garlicknots, cheeseknots, chilliknots, mushknots, keemaknots, chorizoknots, baconknots, ptomato, pcheese, ppesto, palio, p3sauce, brownie";

const API = "https://generativelanguage.googleapis.com/v1beta/";

// fetch with a time limit
async function fetchJson(url, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(function () { ac.abort(); }, ms);
  try {
    const r = await fetch(url, Object.assign({ signal: ac.signal }, opts));
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data: data };
  } finally { clearTimeout(t); }
}

// Other Flash models to fall back on, newest first (looked up once an hour per warm instance).
let found = { at: 0, list: [] };
async function fallbackModels(key) {
  const env = String(process.env.gemini_fallback_models || "").split(",").map(function (m) { return m.trim(); }).filter(Boolean);
  if (env.length) return env.filter(function (m) { return m !== MODEL; });
  if (Date.now() - found.at < 3600e3) return found.list;
  found.at = Date.now();
  try {
    const r = await fetchJson(API + "models?pageSize=200&key=" + key, {}, 2500);
    const names = ((r.data && r.data.models) || [])
      .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0; })
      .map(function (m) { return String(m.name).replace(/^models\//, ""); })
      .filter(function (n) { return /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n) && n !== MODEL; });
    const ver = function (n) { return parseFloat(n.split("-")[1]) || 0; };
    names.sort(function (a, b) { return ver(b) - ver(a) || a.length - b.length; });
    // one more Flash plus the newest Flash-Lite (lite models are quicker and usually less busy)
    const flash = names.filter(function (n) { return !/-lite$/.test(n); })[0];
    const lite = names.filter(function (n) { return /-lite$/.test(n); })[0];
    found.list = [lite, flash].filter(Boolean).slice(0, MAX_FALLBACKS);
  } catch (e) { found.list = []; }
  return found.list;
}

// Gemini 3 models "think" before answering by default, which is slow and eats the reply length.
// Nonna only chats about the menu, so ask for as little thinking as possible.
function quick(payload) {
  const gc = Object.assign({}, payload.generationConfig, { thinkingConfig: { thinkingLevel: "low" } });
  return Object.assign({}, payload, { generationConfig: gc });
}
function call(model, payload, ms) {
  return fetchJson(API + "models/" + model + ":generateContent?key=" + process.env.gemini_api_key,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, ms);
}

// Ask Gemini. If a model fails, or hasn't answered within HEDGE_MS, the next model is asked too;
// the first good answer wins. Everything stops at BUDGET_MS. Returns { reply, model } or { error }.
const HEDGE_MS = 3000;
async function ask(key, payload) {
  const start = Date.now();
  const models = [MODEL].concat(await fallbackModels(key));
  return new Promise(function (resolve) {
    let next = 0, running = 0, done = false, lastErr = "busy", timer = null;
    function finish(r) { if (done) return; done = true; clearTimeout(timer); r.tried = models.slice(0, next); if (r.error) console.error("chat: every model failed:", r.tried, r.error); resolve(r); }
    function launch() {
      clearTimeout(timer);
      if (done || next >= models.length) { if (!running) finish({ error: lastErr }); return; }
      const left = BUDGET_MS - (Date.now() - start);
      if (left < 1500) { if (!running) finish({ error: lastErr }); return; }
      const model = models[next++];
      running++;
      timer = setTimeout(launch, HEDGE_MS);   // still waiting: bring in the next model too
      call(model, quick(payload), left)
        .then(function (r) {
          // a model that doesn't accept the thinking setting gets the plain request
          if (r.status === 400 && /think/i.test(JSON.stringify(r.data || ""))) return call(model, payload, BUDGET_MS - (Date.now() - start));
          return r;
        })
        .then(function (r) {
          if (!r.ok) { lastErr = model + ": " + ((r.data && r.data.error && r.data.error.message) || ("HTTP " + r.status)); return false; }
          const cand = r.data && r.data.candidates && r.data.candidates[0];
          const reply = cand && cand.content && cand.content.parts
            ? cand.content.parts.map(function (p) { return p.text || ""; }).join("").trim() : "";
          finish({ reply: reply, model: model });
          return true;
        })
        .catch(function () { lastErr = model + ": no answer in time"; return false; })
        .then(function (ok) { running--; if (!ok && !done) launch(); });
    }
    launch();
  });
}

// Health check for the chat button: a tiny real request, remembered for 2 minutes per warm instance.
let health = { at: 0, ok: false };

function json(obj) {
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  const key = process.env.gemini_api_key;
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Bad request" }) }; }

  if (body.ping) {
    if (!key) return json({ ok: false });
    if (Date.now() - health.at < 120e3) return json({ ok: health.ok, model: health.model, why: health.why, tried: health.tried });
    const r = await ask(key, { contents: [{ role: "user", parts: [{ text: "Reply with the word OK." }] }],
      generationConfig: { maxOutputTokens: 200 } });
    health = { at: Date.now(), ok: !r.error, model: r.model, why: r.error, tried: r.tried };
    return json({ ok: health.ok, model: health.model, why: health.why, tried: health.tried });
  }
  if (!key) return json({ error: "unavailable" });

  const persona = PERSONAS[body.persona] || PERSONAS.nonna;
  const system = persona + "\n\n" + RULES;

  const msgs = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  let contents = msgs
    .map(function (m) {
      return {
        role: (m.role === "assistant" || m.role === "model") ? "model" : "user",
        parts: [{ text: String(m.text || m.content || "").slice(0, 2000) }]
      };
    })
    .filter(function (c) { return c.parts[0].text.trim().length > 0; });
  // Gemini requires the conversation to start with a user turn
  while (contents.length && contents[0].role === "model") contents.shift();
  if (!contents.length) {
    return { statusCode: 400, body: JSON.stringify({ error: "No message" }) };
  }

  const r = await ask(key, {
    system_instruction: { parts: [{ text: system }] },
    contents: contents,
    generationConfig: { temperature: 0.9, topP: 0.95, maxOutputTokens: 1000 }
  });
  // Customers see a friendly line from the widget, never Google's raw error.
  if (r.error || !r.reply) { health = { at: Date.now(), ok: false, why: r.error || "empty reply", tried: r.tried }; return json({ error: "unavailable" }); }
  health = { at: Date.now(), ok: true, model: r.model };
  return json({ reply: r.reply });
};
