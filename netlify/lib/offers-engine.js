// Pizza Mia game prizes — pure pricing + reward rules (no storage, no HTTP).
// Used by netlify/functions/offers.mjs and by tests/offers.test.js.
// Every number comes from offers.config.json; prices come from assets/menu.js.
"use strict";

var SIZE_NAMES = ["Medium", "Large", "Godfather", "Jumbo"];
var GST_RATE = 0.05;

function norm(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function rupees(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
function round2(n) { return Math.round(n * 100) / 100; }
function fail(code, message) { var e = new Error(message); e.code = code; throw e; }

/* ---------- menu index ---------- */
function indexMenu(menu) {
  var items = {}, toppings = {};
  menu.SECTIONS.forEach(function (s) {
    var list = [];
    if (s.groups) s.groups.forEach(function (g) { list = list.concat(g.items); });
    if (s.items) list = list.concat(s.items);
    list.forEach(function (it) { if (it.type !== "dinein") items[it.id] = it; });
  });
  menu.TOPPINGS.forEach(function (t) { toppings[norm(t.name)] = t; });
  return { items: items, toppings: toppings, halfSizes: menu.HALF_SIZES, noMeat: menu.NO_MEAT_ADDONS || {} };
}

function sizeIndexOf(item, line) {
  if (item.type === "pizza") {
    var si = typeof line.sizeIdx === "number" ? line.sizeIdx : SIZE_NAMES.indexOf(String(line.sizeLabel || "").split(" ")[0]);
    if (!(si >= 0 && si < item.sizes.length)) fail("bad_cart", "Unknown size for " + item.name);
    return si;
  }
  if (item.type === "multi") {
    var mi = typeof line.sizeIdx === "number" ? line.sizeIdx : -1;
    if (mi < 0) item.sizes.forEach(function (s, i) { if (s.label === line.sizeLabel) mi = i; });
    if (!(mi >= 0 && mi < item.sizes.length)) fail("bad_cart", "Unknown size for " + item.name);
    return mi;
  }
  return -1;
}

function isExcludedName(config, name) {
  var ex = (config.excluded_from_eligible || []).map(norm);
  return ex.indexOf(norm(name)) >= 0;
}

// Re-price the cart from the menu. The browser only sends what was picked
// (item, size, half, toppings, qty) — never prices.
function priceCart(menu, config, rawLines) {
  var M = indexMenu(menu);
  if (!Array.isArray(rawLines)) fail("bad_cart", "Cart missing");
  var lines = rawLines.map(function (raw, idx) {
    var it = M.items[raw && raw.itemId];
    if (!it) fail("bad_cart", "Unknown item");
    var qty = Math.floor(Number(raw.qty));
    if (!(qty >= 1 && qty <= 50)) fail("bad_cart", "Bad quantity");
    var si = sizeIndexOf(it, raw), unit, name = it.name, half = null;
    if (it.type === "pizza") {
      var bId = raw.half && (raw.half.b ? raw.half.b.id || raw.half.b : raw.half);
      if (bId) {
        var b = M.items[bId];
        if (!b || b.type !== "pizza" || b.id === it.id) fail("bad_cart", "Bad Half & Half");
        if (M.halfSizes.indexOf(si) < 0) fail("bad_cart", "Half & Half is Large and up only");
        unit = Math.ceil(it.sizes[si] / 2) + Math.ceil(b.sizes[si] / 2);
        name = "Half & Half: " + it.name + " + " + b.name;
        half = { a: it.name, b: b.name, bId: b.id };
      } else unit = it.sizes[si];
    } else if (it.type === "multi") unit = it.sizes[si].price;
    else unit = it.price;
    var tops = (raw.toppings || []).map(function (t) {
      var tp = M.toppings[norm(t && t.name != null ? t.name : t)];
      if (!tp) fail("bad_cart", "Unknown topping");
      var ti = it.type === "pizza" ? si : (it.type === "multi" ? Math.min(si, 1) : -1);
      if (ti < 0) fail("bad_cart", "Toppings not allowed on " + it.name);
      return { name: tp.name, price: tp.prices[ti] };
    });
    tops.forEach(function (t) { unit += t.price; });
    var excluded = isExcludedName(config, it.name) || !!it.alcohol;
    var sizeLabel = it.type === "pizza" ? SIZE_NAMES[si] : (it.type === "multi" ? it.sizes[si].label : "");
    return {
      idx: idx, itemId: it.id, name: name, sizeIdx: si, sizeLabel: sizeLabel, qty: qty,
      unit: unit, total: unit * qty, toppings: tops, half: half,
      choice: raw.choice && it.choice && it.choice.opts.indexOf(raw.choice) >= 0 ? raw.choice : (it.choice ? it.choice.opts[0] : null),
      isPizza: it.type === "pizza" && !excluded && norm(it.name) !== "99 pizza",
      excluded: excluded
    };
  });
  var itemTotal = 0, eligible = 0;
  lines.forEach(function (l) { itemTotal += l.total; if (!l.excluded) eligible += l.total; });
  return { lines: lines, itemTotal: itemTotal, eligible: eligible, hasPizza: lines.some(function (l) { return l.isPizza; }) };
}

/* ---------- reward definitions ---------- */
function findDef(config, rewardId) {
  var all = (config.wheel || []).concat(config.arcade || []);
  for (var i = 0; i < all.length; i++) if (all[i].id === rewardId) return all[i];
  return null;
}
// Wheel slices have one ladder of versions; arcade tiers have a list of options (each a ladder).
function optionsOf(def) { return def.options ? def.options : [def.versions]; }

function versionLabel(v) {
  if (v.type === "pct_off") return Math.round(v.pct * 100) + "% off (max " + rupees(v.cap) + ")";
  if (v.type === "free_topping") return (v.qty > 1 ? v.qty + " free veg toppings" : "a free veg topping");
  if (v.choice) return (v.qty > 1 ? v.qty + " free drinks (" + v.choice.join(" or ") + ")" : "a free " + v.choice.join(" or "));
  return (v.qty > 1 ? v.qty + " × " : "") + "free " + v.item + " " + v.size;
}
function optionLabel(opt) {
  var top = opt[opt.length - 1];
  if (top.type === "pct_off") return versionLabel(top);
  return versionLabel(opt[0]);
}

function estCost(config, v, discount, choices) {
  var est = config.est_cost_inr || {};
  if (v.type === "pct_off") return round2(discount * (est.pct_off_cost_factor || 1));
  if (v.type === "free_topping") return (est.free_topping || 0) * (v.qty || 1);
  if (v.choice) return (choices || []).reduce(function (s, c) { return s + (est[c] || 0); }, 0);
  return (est[v.item + "|" + v.size] || 0) * (v.qty || 1);
}

function pctDiscount(v, eligible) {
  var bp = Math.round(v.pct * 10000);                 // integer maths, no float surprises
  return Math.min(Math.floor(bp * eligible / 10000), v.cap);
}
function ceilingFor(config, eligible) {
  return Math.floor(Math.round(config.max_discount_pct_of_eligible * 10000) * eligible / 10000);
}

function enabled(config, env) {
  return !!config.offers_enabled && String((env || {}).OFFERS_ENABLED || "").toLowerCase() !== "false";
}

// Decide what a saved prize gives on this cart. `sel` = customer's choices:
// { option, choices:[drink names], toppingLine, topping }.
function evaluateReward(config, priced, reward, sel, opts) {
  opts = opts || {};
  sel = sel || {};
  var out = { status: "none", discount: 0, freeLines: [], nudges: [], estCost: 0, incomplete: false };
  if (!reward) return out;
  var def = findDef(config, reward.rewardId);
  if (!def) { out.status = "rejected"; out.message = "This prize is no longer available."; return out; }
  out.reward = { id: reward.id, code: reward.code, rewardId: def.id, label: def.label, source: reward.source };

  var others = (opts.otherOffers || []).filter(function (o) { return (config.mutually_exclusive_with || []).indexOf(o) >= 0; });
  if (config.one_reward_per_order && others.length) {
    out.status = "rejected";
    out.message = "Only one offer per order. Choose either your game prize or the " + others.join(" + ") + " offer.";
    return out;
  }

  var floor = config.floor || {}, eligible = priced.eligible, min = floor.min_eligible_subtotal || 0;
  var options = optionsOf(def);
  out.options = options.map(function (o, i) {
    return { index: i, label: optionLabel(o), min: o[0].min, available: o[0].min <= eligible };
  });

  var needPizza = floor.require_regular_pizza && !priced.hasPizza;
  if (needPizza || eligible < min) {
    out.status = "saved";
    var gap = Math.max(0, min - eligible);
    out.message = needPizza ? (config.copy && config.copy.below_floor) || "Add a pizza to use your prize."
                            : "Add " + rupees(gap) + " more to use your prize. It's saved for " + config.limits.expiry_hours + " hours.";
    if (needPizza && gap > 0) out.message = "Add a pizza (" + rupees(min) + "+ order) to use your prize. It's saved for " + config.limits.expiry_hours + " hours.";
    out.nudges.push({ kind: "floor", gap: gap, text: out.message });
    return out;
  }

  // Which option? Customer's pick if unlocked, else the first unlocked one.
  var want = typeof sel.option === "number" ? sel.option : 0;
  var oi = out.options[want] && out.options[want].available ? want : 0;
  if (!out.options[oi].available) oi = out.options.filter(function (o) { return o.available; })[0].index;
  if (want !== oi && out.options[want]) {
    var lk = out.options[want];
    out.optionLocked = { index: want, label: lk.label, min: lk.min, gap: lk.min - eligible,
      text: cap1(lk.label) + " needs a " + rupees(lk.min) + "+ order. Add " + rupees(lk.min - eligible) + " more to unlock it." };
  }
  var ladder = options[oi], vi = 0;
  for (var i = 0; i < ladder.length; i++) if (ladder[i].min <= eligible) vi = i;
  var v = ladder[vi], next = ladder[vi + 1];
  out.status = "applied";
  out.optionIndex = oi;
  out.versionIndex = vi;
  out.version = { type: v.type, label: versionLabel(v), min: v.min };

  var code = reward.code || "";
  var tag = "(Game reward" + (code ? " " + code : "") + ")";
  if (v.type === "pct_off") {
    out.discount = pctDiscount(v, eligible);
    out.discountLabel = "Game reward: " + Math.round(v.pct * 100) + "% off";
    var full = Math.ceil(v.cap * 10000 / Math.round(v.pct * 10000));
    if (!next && eligible < full) out.nudges.push({ kind: "cap", gap: full - eligible,
      text: "Add " + rupees(full - eligible) + " more to get the full " + rupees(v.cap) + " off." });
  } else if (v.type === "free_topping") {
    var pizzas = priced.lines.filter(function (l) { return l.isPizza; });
    var target = pizzas.filter(function (l) { return l.idx === sel.toppingLine; })[0] || pizzas[0];
    var list = config[v.list] || [];
    var pick = list.filter(function (t) { return norm(t) === norm(sel.topping); })[0];
    out.topping = { lines: pizzas.map(function (l) { return l.idx; }), line: target.idx, list: list, picked: pick || null };
    if (!pick) { out.incomplete = true; out.message = "Pick your free topping below."; }
    else out.freeLines.push({ name: "Extra " + pick + " on " + target.name, size: target.sizeLabel + (target.half ? ", whole pizza" : ""), qty: 1,
      text: "Extra " + pick + " on " + target.name + " (" + target.sizeLabel + (target.half ? ", whole pizza" : "") + ") ×1 ₹0 " + tag });
  } else if (v.choice) {
    var qty = v.qty || 1, chosen = [];
    for (var c = 0; c < qty; c++) {
      var w = (sel.choices || [])[c];
      chosen.push(v.choice.indexOf(w) >= 0 ? w : v.choice[0]);
    }
    out.drinks = { qty: qty, options: v.choice, chosen: chosen };
    var counts = {};
    chosen.forEach(function (d) { counts[d] = (counts[d] || 0) + 1; });
    Object.keys(counts).forEach(function (d) {
      out.freeLines.push({ name: d, size: "", qty: counts[d], text: d + " ×" + counts[d] + " ₹0 " + tag });
    });
  } else {
    var q = v.qty || 1;
    out.freeLines.push({ name: v.item, size: v.size, qty: q, text: v.item + " (" + v.size + ") ×" + q + " ₹0 " + tag });
  }
  if (next) out.nudges.push({ kind: "upgrade", gap: next.min - eligible, nextLabel: versionLabel(next),
    text: "Add " + rupees(next.min - eligible) + " more to upgrade your prize to " + versionLabel(next) + "." });
  var locked = out.options.filter(function (o) { return !o.available; }).sort(function (a, b) { return a.min - b.min; })[0];
  if (locked && !out.optionLocked) out.nudges.push({ kind: "unlock", gap: locked.min - eligible,
    text: "Add " + rupees(locked.min - eligible) + " more to unlock " + locked.label + "." });

  // Hard ceiling (brief §2 rule 2) — never remove.
  if (out.discount > ceilingFor(config, eligible)) throw new Error("Discount above 15% ceiling");
  out.estCost = estCost(config, v, out.discount, out.drinks && out.drinks.chosen);
  return out;
}
function cap1(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Discount comes off before GST, so GST is charged on the reduced amount.
function totals(priced, discount) {
  var subtotal = Math.max(0, priced.itemTotal - (discount || 0));
  var gst = round2(subtotal * GST_RATE);
  return { itemTotal: priced.itemTotal, eligible: priced.eligible, discount: discount || 0,
           subtotal: subtotal, gstRate: GST_RATE, gst: gst, total: round2(subtotal + gst) };
}

/* ---------- games ---------- */
function pickWheelSlice(config, randInt) {
  var w = config.wheel, sum = 0;
  w.forEach(function (s) { sum += s.weight; });
  var r = randInt(sum);
  for (var i = 0; i < w.length; i++) { if (r < w[i].weight) return i; r -= w[i].weight; }
  return w.length - 1;
}
function arcadeTierFor(config, score) {
  var best = -1;
  config.arcade.forEach(function (t, i) { if (score >= config.arcade_scores[t.min_score]) best = i; });
  return best;
}

// What the browser may know: labels and thresholds only (no weights).
function publicConfig(config, menu, env) {
  var M = indexMenu(menu);
  return {
    enabled: enabled(config, env),
    floor: config.floor,
    expiryHours: config.limits.expiry_hours,
    copy: config.copy,
    wheel: config.wheel.map(function (s) {
      return { id: s.id, label: s.label, ladder: s.versions.map(function (v) { return { min: v.min, label: versionLabel(v) }; }) };
    }),
    arcade: config.arcade.map(function (t) {
      return { id: t.id, label: t.label, minScore: config.arcade_scores[t.min_score],
        options: t.options.map(function (o) { return { label: optionLabel(o), min: o[0].min,
          ladder: o.map(function (v) { return { min: v.min, label: versionLabel(v) }; }) }; }) };
    }),
    vegToppings: (config.VEG_TOPPINGS || []).map(function (n) { var t = M.toppings[norm(n)]; return { name: n, display: t ? t.name : n }; })
  };
}

module.exports = {
  SIZE_NAMES: SIZE_NAMES, norm: norm, priceCart: priceCart, findDef: findDef, optionsOf: optionsOf,
  versionLabel: versionLabel, evaluateReward: evaluateReward, totals: totals, enabled: enabled,
  pickWheelSlice: pickWheelSlice, arcadeTierFor: arcadeTierFor, publicConfig: publicConfig, ceilingFor: ceilingFor
};
