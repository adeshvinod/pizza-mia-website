// Acceptance tests from the offers brief (§10). Run: npm test
"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var E = require("../netlify/lib/offers-engine.js");
var Api = require("../netlify/lib/offers-api.js").Api;
var CONFIG = require("../offers.config.json");
var MENU = require("../assets/menu.js");

// The website doesn't sell Coke or the ₹99 pizza, but the brief's tests use them,
// so this copy of the menu adds them for testing only.
var TMENU = JSON.parse(JSON.stringify(MENU));
TMENU.SECTIONS.push({ id: "testonly", label: "Test", items: [
  { id: "coke", name: "Coke", type: "single", price: 120 },
  { id: "pz99", name: "99 Pizza", type: "single", price: 99 }
] });

function memStore() {
  var m = {};
  return {
    get: async function (k) { return m[k] ? JSON.parse(m[k]) : null; },
    set: async function (k, v) { m[k] = JSON.stringify(v); },
    list: async function (p) { return Object.keys(m).filter(function (k) { return k.indexOf(p) === 0; }); }
  };
}
function setup(over) {
  var clock = { t: Date.UTC(2026, 9, 19, 12) };
  var store = memStore();
  var api = Api(Object.assign({ config: CONFIG, menu: TMENU, crypto: require("crypto"), store: store, env: {}, now: function () { return clock.t; } }, over || {}));
  return { api: api, store: store, clock: clock };
}
// Put a specific reward in the store, as if the server had issued it.
async function give(s, rewardId, source) {
  var id = "TESTREWARD" + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "A");
  id = (id + "AAAAAAAAAAAAAAAA").slice(0, 16);
  await s.store.set("reward/" + id, { id: id, code: "TST123", source: source || "wheel", rewardId: rewardId, label: rewardId,
    issuedAt: s.clock.t, expiresAt: s.clock.t + 48 * 3600e3, used: false });
  return id;
}
function L(itemId, size, qty, extra) { return Object.assign({ itemId: itemId, sizeLabel: size || "", qty: qty || 1 }, extra || {}); }
async function price(s, cart, rewardId, sel, other) {
  var r = await s.api.handle("price", { cart: cart, rewardId: rewardId, selection: sel, otherOffers: other });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

var MARG_M = L("marg", "Medium"), PEP_M = L("pep", "Medium");

test("1. Margherita M ₹399 + W_KNOTS → Garlic Knots 2 pc free, nudge to 4 pc", async function () {
  var s = setup(), id = await give(s, "W_KNOTS");
  var r = await price(s, [MARG_M], id);
  assert.equal(r.totals.eligible, 399);
  assert.equal(r.reward.status, "applied");
  assert.equal(r.reward.freeLines[0].text, "Garlic Knots (2 pc) ×1 ₹0 (Game reward TST123)");
  assert.equal(r.reward.discount, 0);
  assert.equal(r.reward.nudges[0].text, "Add ₹400 more to upgrade your prize to free Garlic Knots 4 pc.");
});

test("2. Garlic Knots 2 pc + Coke ₹300, no pizza → not applied, kept saved", async function () {
  var s = setup(), id = await give(s, "W_TOPPING");
  var r = await price(s, [L("garlicknots", "2 pcs"), L("coke")], id);
  assert.equal(r.totals.eligible, 300);
  assert.equal(r.reward.status, "saved");
  assert.match(r.reward.message, /^Add a pizza/);
  assert.equal(r.totals.discount, 0);
  var rec = await s.store.get("reward/" + id);
  assert.equal(rec.used, false);
});

test("3. 99 Pizza ×5 ₹495 → not applied (excluded, no regular pizza)", async function () {
  var s = setup(), id = await give(s, "W_PCT10");
  var r = await price(s, [L("pz99", "", 5)], id);
  assert.equal(r.totals.itemTotal, 495);
  assert.equal(r.totals.eligible, 0);
  assert.equal(r.reward.status, "saved");
  assert.equal(r.totals.discount, 0);
});

test("4. Pepperoni M ₹699 + W_PCT10 → ₹69 off", async function () {
  var s = setup(), id = await give(s, "W_PCT10");
  var r = await price(s, [PEP_M], id);
  assert.equal(r.totals.discount, 69);
  assert.equal(r.reward.discountLabel, "Game reward: 10% off");
  assert.equal(r.totals.gst, 31.5);           // GST on 699 − 69 = 630
});

test("5. Pepperoni L + Margherita L + Cheese Garlic Knots 4 pc ₹2,378 + W_PCT10 → ₹100 (cap)", async function () {
  var s = setup(), id = await give(s, "W_PCT10");
  var r = await price(s, [L("pep", "Large"), L("marg", "Large"), L("cheeseknots", "4 pcs")], id);
  assert.equal(r.totals.eligible, 2378);
  assert.equal(r.totals.discount, 100);
});

test("6. Margherita M ₹399 + W_CHEESY → Garlic Knots 2 pc (below ₹449)", async function () {
  var s = setup(), id = await give(s, "W_CHEESY");
  var r = await price(s, [MARG_M], id);
  assert.equal(r.reward.freeLines[0].name, "Garlic Knots");
  assert.equal(r.reward.freeLines[0].size, "2 pc");
});

test("7. Garden M + Coke ₹599 + W_CHEESY → Cheese Garlic Knots 2 pc", async function () {
  var s = setup(), id = await give(s, "W_CHEESY");
  var r = await price(s, [L("garden", "Medium"), L("coke")], id);
  assert.equal(r.totals.eligible, 599);
  assert.equal(r.reward.freeLines[0].name, "Cheese Garlic Knots");
  assert.equal(r.reward.freeLines[0].size, "2 pc");
});

test("8. Cart ₹1,049 → item removed → ₹699: W_CHEESY downgrades 4 pc → 2 pc", async function () {
  var s = setup(), id = await give(s, "W_CHEESY");
  var big = await price(s, [PEP_M, L("chorizoknots")], id);
  assert.equal(big.totals.eligible, 1049);
  assert.equal(big.reward.freeLines[0].text, "Cheese Garlic Knots (4 pc) ×1 ₹0 (Game reward TST123)");
  var small = await price(s, [PEP_M], id);
  assert.equal(small.reward.freeLines[0].text, "Cheese Garlic Knots (2 pc) ×1 ₹0 (Game reward TST123)");
});

test("9. ₹1,199 + A_T3 choosing 15% → not allowed; 10% or Cheese Garlic Knots 4 pc offered", async function () {
  var s = setup(), id = await give(s, "A_T3", "arcade");
  var r = await price(s, [MARG_M, L("cheeseknots", "4 pcs", 2)], id, { option: 2 });
  assert.equal(r.totals.eligible, 1199);
  assert.equal(r.reward.optionLocked.index, 2);
  assert.match(r.reward.optionLocked.text, /needs a ₹1,499\+ order/);
  assert.deepEqual(r.reward.options.map(function (o) { return o.available; }), [true, true, false]);
  assert.equal(r.reward.optionIndex, 0);
  assert.equal(r.totals.discount, 100);       // falls back to 10% (cap ₹100)
  var r2 = await price(s, [MARG_M, L("cheeseknots", "4 pcs", 2)], id, { option: 1 });
  assert.equal(r2.reward.freeLines[0].text, "Cheese Garlic Knots (4 pc) ×1 ₹0 (Game reward TST123)");
  assert.equal(r2.totals.discount, 0);
});

test("10. ₹1,499 + A_T3 choosing 15% → ₹200 (cap)", async function () {
  var s = setup(), id = await give(s, "A_T3", "arcade");
  var r = await price(s, [L("chtikka", "Godfather")], id, { option: 2 });
  assert.equal(r.totals.eligible, 1499);
  assert.equal(r.totals.discount, 200);
});

test("11. WhatsApp 5% + Review 5% also claimed → never combined", async function () {
  var s = setup(), id = await give(s, "A_T3", "arcade");
  var r = await price(s, [L("chtikka", "Godfather")], id, { option: 2 }, ["WHATSAPP_5", "REVIEW_5"]);
  assert.equal(r.reward.status, "rejected");
  assert.match(r.reward.message, /Only one offer per order/);
  assert.equal(r.totals.discount, 0);
  var sub = await s.api.handle("submit", { cart: [L("chtikka", "Godfather")], rewardId: id, selection: { option: 2 },
    otherOffers: ["WHATSAPP_5"], phone: "9876543210" });
  assert.equal(sub.status, 409);
});

test("12. Half & Half Large Margherita/Pepperoni + W_PCT10 → H&H counted at full price", async function () {
  var s = setup(), id = await give(s, "W_PCT10");
  var r = await price(s, [L("marg", "Large", 1, { half: { b: { id: "pep" } } })], id);
  // Site price today = ½ of ₹679 + ½ of ₹1,299 = ₹340 + ₹650 = ₹990 (the brief's ₹1,040 includes a
  // ₹25-per-half charge the website doesn't add yet — flagged to Adesh, prices not changed here).
  assert.equal(r.totals.eligible, r.lines[0].total);
  assert.equal(r.totals.eligible, 990);
  assert.equal(r.totals.discount, 99);
  // with the brief's ₹1,040 price the same rule gives the ₹100 cap
  var priced = { lines: [{ idx: 0, isPizza: true }], itemTotal: 1040, eligible: 1040, hasPizza: true };
  assert.equal(E.evaluateReward(CONFIG, priced, { rewardId: "W_PCT10" }).discount, 100);
});

test("13. Fake reward id or client-sent discount → rejected/ignored", async function () {
  var s = setup();
  var r = await s.api.handle("price", { cart: [PEP_M], rewardId: "FAKEFAKEFAKEFAKE", discount: 500 });
  assert.equal(r.json.reward.status, "rejected");
  assert.equal(r.json.totals.discount, 0);
  var r2 = await s.api.handle("submit", { cart: [PEP_M], rewardId: "<script>", discount: 500, phone: "9876543210" });
  assert.equal(r2.status, 409);
  var r3 = await s.api.handle("submit", { cart: [PEP_M], discount: 500, phone: "9876543210" });
  assert.equal(r3.json.totals.discount, 0);
  var r4 = await s.api.handle("price", { cart: [{ itemId: "pep", sizeLabel: "Medium", qty: 1, basePrice: 1 }] });
  assert.equal(r4.json.totals.itemTotal, 699);    // browser prices are ignored
});

test("14. Reward older than 48 h or already used → rejected with a clear message", async function () {
  var s = setup(), id = await give(s, "W_PCT10");
  var ok = await s.api.handle("submit", { cart: [PEP_M], rewardId: id, phone: "9876543210" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.totals.discount, 69);
  var again = await s.api.handle("submit", { cart: [PEP_M], rewardId: id, phone: "9123456780" });
  assert.equal(again.status, 409);
  assert.match(again.json.message, /already been used/);

  var id2 = await give(s, "W_PCT10");
  s.clock.t += 49 * 3600e3;
  var old = await price(s, [PEP_M], id2);
  assert.equal(old.reward.status, "rejected");
  assert.match(old.reward.message, /expired/);
});

test("14b. One prize per phone per 3 days (owner changed from 7, 19 Oct 2026)", async function () {
  var s = setup();
  var a = await give(s, "W_PCT5"), b = await give(s, "W_PCT5");
  assert.equal((await s.api.handle("submit", { cart: [PEP_M], rewardId: a, phone: "98765 43210" })).status, 200);
  var r = await s.api.handle("submit", { cart: [PEP_M], rewardId: b, phone: "+91 9876543210" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "reward_limit");
});

test("15. 10,000 random carts × every reward/option → discount ≤ 15%, one reward per order", function () {
  var M = MENU, ids = [];
  M.SECTIONS.forEach(function (s) { (s.items || []).forEach(function (i) { if (i.type !== "dinein") ids.push(i); });
    (s.groups || []).forEach(function (g) { g.items.forEach(function (i) { ids.push(i); }); }); });
  var defs = CONFIG.wheel.concat(CONFIG.arcade);
  for (var n = 0; n < 10000; n++) {
    var cart = [], k = 1 + Math.floor(Math.random() * 4);
    for (var j = 0; j < k; j++) {
      var it = ids[Math.floor(Math.random() * ids.length)];
      var line = { itemId: it.id, qty: 1 + Math.floor(Math.random() * 3) };
      if (it.type === "pizza") {
        line.sizeIdx = Math.floor(Math.random() * 4);
        if (line.sizeIdx > 0 && Math.random() < 0.3) line.half = { b: { id: it.id === "marg" ? "pep" : "marg" } };
      }
      if (it.type === "multi") line.sizeIdx = Math.floor(Math.random() * it.sizes.length);
      cart.push(line);
    }
    var priced = E.priceCart(M, CONFIG, cart);
    var def = defs[Math.floor(Math.random() * defs.length)];
    var ev = E.evaluateReward(CONFIG, priced, { rewardId: def.id, code: "X" },
      { option: Math.floor(Math.random() * 3), topping: "Sweet Corn", choices: ["Sprite"] });
    assert.ok(ev.discount <= Math.floor(0.15 * priced.eligible), "ceiling broken at " + priced.eligible);
    assert.ok(ev.discount === 0 || ev.freeLines.length === 0, "discount and freebie together");
    if (ev.status === "applied") assert.ok(priced.eligible >= 399 && priced.hasPizza);
  }
});

test("16. offers_enabled = false → no prizes, checkout ignores rewards", async function () {
  var off = Object.assign({}, CONFIG, { offers_enabled: false });
  var s = setup({ config: off }), id = await give(s, "W_PCT10");
  assert.equal((await s.api.handle("config", {})).json.enabled, false);
  assert.equal((await s.api.handle("spin", {})).status, 403);
  assert.equal((await s.api.handle("arcade_start", {})).status, 403);
  var r = await price(s, [PEP_M], id);
  assert.equal(r.totals.discount, 0);
  assert.equal(r.reward.freeLines.length, 0);
  // and the env-var switch works without touching the file
  var s2 = setup({ env: { OFFERS_ENABLED: "false" } });
  assert.equal((await s2.api.handle("config", {})).json.enabled, false);
});

/* ---------- extra checks on the games and pickers ---------- */
test("Wheel spin issues a stored reward from one of the 6 slices", async function () {
  var s = setup();
  var r = await s.api.handle("spin", {}, { ip: "1.2.3.4" });
  assert.equal(r.status, 200);
  assert.ok(r.json.slice >= 0 && r.json.slice < 6);
  assert.equal(r.json.label, CONFIG.wheel[r.json.slice].label);
  var rec = await s.store.get("reward/" + r.json.reward.id);
  assert.equal(rec.used, false);
  assert.equal(rec.expiresAt - rec.issuedAt, 48 * 3600e3);
});

test("Wheel weights roughly match config", function () {
  var counts = [0, 0, 0, 0, 0, 0], N = 100000;
  for (var i = 0; i < N; i++) counts[E.pickWheelSlice(CONFIG, function (n) { return Math.floor(Math.random() * n); })]++;
  CONFIG.wheel.forEach(function (s, i) { assert.ok(Math.abs(counts[i] / N - s.weight / 100) < 0.01, s.id); });
});

test("Arcade: tiers, one result per run, implausible scores refused", async function () {
  var s = setup();
  var st = (await s.api.handle("arcade_start", {})).json.token;
  s.clock.t += 61000;
  var r = await s.api.handle("arcade_finish", { token: st, score: 500, seconds: 60 });
  assert.equal(r.json.tierId, "A_T3");
  assert.equal((await s.api.handle("arcade_finish", { token: st, score: 500, seconds: 60 })).status, 400);
  var st2 = (await s.api.handle("arcade_start", {})).json.token;
  s.clock.t += 5000;
  assert.equal((await s.api.handle("arcade_finish", { token: st2, score: 5000, seconds: 5 })).status, 400);
  var st3 = (await s.api.handle("arcade_start", {})).json.token;
  s.clock.t += 3000;
  assert.equal((await s.api.handle("arcade_finish", { token: st3, score: 100, seconds: 40 })).status, 400);  // claimed 40s, only 3s passed
  var st4 = (await s.api.handle("arcade_start", {})).json.token;
  s.clock.t += 20000;
  var low = await s.api.handle("arcade_finish", { token: st4, score: 30, seconds: 20 });
  assert.equal(low.json.tier, null);
  var st5 = (await s.api.handle("arcade_start", {})).json.token;
  s.clock.t += 30000;
  assert.equal((await s.api.handle("arcade_finish", { token: st5, score: 260, seconds: 30 })).json.tierId, "A_T2");
});

test("Free topping: customer picks the pizza and topping; needed before submit", async function () {
  var s = setup(), id = await give(s, "W_TOPPING");
  var cart = [L("garlicknots", "2 pcs"), L("marg", "Large", 1, { half: { b: { id: "garden" } } })];
  var r = await price(s, cart, id);
  assert.equal(r.reward.incomplete, true);
  assert.deepEqual(r.reward.topping.lines, [1]);
  var bad = await s.api.handle("submit", { cart: cart, rewardId: id, phone: "9876543210" });
  assert.equal(bad.json.error, "reward_incomplete");
  var r2 = await price(s, cart, id, { toppingLine: 1, topping: "Sweet Corn" });
  assert.equal(r2.reward.freeLines[0].text, "Extra Sweet Corn on Half & Half: Margherita + Garden (Large, whole pizza) ×1 ₹0 (Game reward TST123)");
  var notAllowed = await price(s, cart, id, { toppingLine: 1, topping: "Double Cheese" });
  assert.equal(notAllowed.reward.incomplete, true);
});

test("Free drinks: 1 below ₹999, 2 from ₹999, customer picks Coke or Sprite", async function () {
  var s = setup(), id = await give(s, "W_DRINK");
  var r = await price(s, [PEP_M], id, { choices: ["Sprite"] });
  assert.equal(r.reward.freeLines[0].text, "Sprite ×1 ₹0 (Game reward TST123)");
  assert.equal(r.reward.nudges[0].text, "Add ₹300 more to upgrade your prize to 2 free drinks (Coke or Sprite).");
  var r2 = await price(s, [L("pep", "Large")], id, { choices: ["Sprite", "Coke"] });
  assert.equal(r2.reward.freeLines.length, 2);
});

test("10% under the cap nudges toward the full ₹100", async function () {
  var s = setup(), id = await give(s, "W_PCT10");
  var r = await price(s, [PEP_M], id);
  assert.equal(r.reward.nudges[0].text, "Add ₹301 more to get the full ₹100 off.");
});

test("Weekly summary needs the admin key and shows totals", async function () {
  var s = setup({ env: { OFFERS_ADMIN_KEY: "k" } }), id = await give(s, "W_PCT10");
  await s.api.handle("submit", { cart: [PEP_M], rewardId: id, phone: "9876543210" });
  await s.api.handle("submit", { cart: [MARG_M], phone: "9876500000",
    customer: { name: "Asha <b>D'Souza</b>", address: "Flat 4, Miramar", landmark: "London Hotel", notes: "=call on arrival" } });
  assert.equal((await s.api.handle("summary", { key: "nope" })).status, 403);
  assert.match((await s.api.handle("summary", {})).html, /type=password/);
  var r = await s.api.handle("summary", { key: "k" });
  assert.match(r.html, /Website orders<\/td><td>2</);
  assert.match(r.html, /Orders that used a prize<\/td><td>1</);
  assert.match(r.html, /Asha &lt;b&gt;D'Souza/);
  assert.match(r.html, /9876500000/);
  assert.match(r.html, /Flat 4, Miramar \(near London Hotel\)/);
  assert.match(r.html, /1 × Margherita \(Medium\)/);
  var csv = await s.api.handle("summary", { key: "k", format: "csv" });
  assert.equal(csv.status, 200);
  assert.match(csv.csv, /"Asha <b>D'Souza<\/b>","9876500000","Flat 4, Miramar"/);
  assert.match(csv.csv, /"'=call on arrival"/);
  assert.equal(csv.csv.trim().split("\r\n").length, 3);
});

test("Every reward version costs less than the 13.5% website-vs-app gap at its unlock value (brief §1.1, §8)", function () {
  // §8 says 13% as a rule of thumb but explicitly approves 15% (cap ₹200) from ₹1,499 = 13.3%.
  CONFIG.wheel.concat(CONFIG.arcade).forEach(function (d) {
    E.optionsOf(d).forEach(function (opt) {
      opt.forEach(function (v) {
        var cost = v.type === "pct_off" ? Math.min(v.pct * v.min, v.cap) * 0.98
          : v.type === "free_topping" ? CONFIG.est_cost_inr.free_topping
          : v.choice ? CONFIG.est_cost_inr.Coke * (v.qty || 1) : CONFIG.est_cost_inr[v.item + "|" + v.size];
        assert.ok(cost <= 0.135 * v.min, d.id + " @" + v.min);
      });
    });
  });
});
