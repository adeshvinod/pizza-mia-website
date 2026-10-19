// Pizza Mia game prizes — request handling, storage and logging.
// Storage is passed in (Netlify Blobs in production, an in-memory map in tests):
//   store.get(key) -> object|null, store.set(key, obj), store.list(prefix) -> [keys]
"use strict";

var E = require("./offers-engine.js");
var crypto = null;   // Node's crypto module, passed in by the caller (keeps the ESM bundle happy)

var CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no 0/O/1/I/L mix-ups
function randCode(n) {
  var s = "";
  for (var i = 0; i < n; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}
function hash(s, env) {
  return crypto.createHash("sha256").update(String((env && env.OFFERS_SALT) || "pizzamia-offers") + "|" + s).digest("hex").slice(0, 24);
}
function phoneDigits(p) { var d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; }
function day(ts) { return new Date(ts).toISOString().slice(0, 10); }
function ok(json) { return { status: 200, json: json }; }
function err(status, code, message) { return { status: status, json: { error: code, message: message } }; }

function Api(deps) {
  crypto = deps.crypto || crypto;
  var config = deps.config, menu = deps.menu, store = deps.store, env = deps.env || {};
  var now = deps.now || function () { return Date.now(); };
  var isOn = function () { return E.enabled(config, env); };

  async function rateLimited(ip) {
    var lim = (config.rate_limit || {}).issues_per_ip_per_hour;
    if (!lim || !ip) return false;
    var key = "rl/" + hash(ip, env) + "/" + new Date(now()).toISOString().slice(0, 13);
    var rec = (await store.get(key)) || { n: 0 };
    if (rec.n >= lim) return true;
    rec.n++;
    await store.set(key, rec);
    return false;
  }

  async function issue(def, source, ip, extra) {
    var t = now(), id = randCode(16), code = randCode(6);
    var rec = Object.assign({ id: id, code: code, source: source, rewardId: def.id, label: def.label,
      issuedAt: t, expiresAt: t + config.limits.expiry_hours * 3600 * 1000, used: false,
      ipHash: ip ? hash(ip, env) : null }, extra || {});
    await store.set("reward/" + id, rec);
    return rec;
  }
  function publicReward(rec) {
    return { id: rec.id, code: rec.code, source: rec.source, rewardId: rec.rewardId, label: rec.label, expiresAt: rec.expiresAt };
  }

  // Load a reward the server issued and check it can still be used.
  async function loadReward(id) {
    if (!id || typeof id !== "string" || !/^[A-Z0-9]{16}$/.test(id)) return { error: "We couldn't find that prize. Please play again." };
    var rec = await store.get("reward/" + id);
    if (!rec) return { error: "We couldn't find that prize. Please play again." };
    if (rec.used) return { error: "This prize has already been used on an earlier order." };
    if (now() > rec.expiresAt) return { error: "This prize expired (prizes last " + config.limits.expiry_hours + " hours after winning)." };
    return { rec: rec };
  }

  async function quote(body) {
    var priced = E.priceCart(menu, config, body.cart || []);
    var ev = { status: "none", discount: 0, freeLines: [], nudges: [] };
    if (body.rewardId) {
      if (!isOn()) ev = { status: "rejected", message: "Game prizes are paused right now.", discount: 0, freeLines: [], nudges: [] };
      else {
        var r = await loadReward(body.rewardId);
        if (r.error) ev = { status: "rejected", message: r.error, discount: 0, freeLines: [], nudges: [] };
        else ev = E.evaluateReward(config, priced, r.rec, body.selection, { otherOffers: body.otherOffers });
      }
    }
    var discount = ev.status === "applied" ? ev.discount : 0;
    return { priced: priced, ev: ev, totals: E.totals(priced, discount) };
  }
  function quoteJson(q) {
    return { lines: q.priced.lines.map(function (l) {
        return { idx: l.idx, name: l.name, sizeLabel: l.sizeLabel, qty: l.qty, unit: l.unit, total: l.total, isPizza: l.isPizza, excluded: l.excluded };
      }), reward: q.ev, totals: q.totals };
  }

  var actions = {
    config: async function () { return ok(E.publicConfig(config, menu, env)); },

    spin: async function (body, ctx) {
      if (!isOn()) return err(403, "paused", "Game prizes are paused right now.");
      if (await rateLimited(ctx.ip)) return err(429, "slow_down", "That's a lot of spins! Please try again in a while.");
      var i = E.pickWheelSlice(config, function (n) { return crypto.randomInt(n); });
      var rec = await issue(config.wheel[i], "wheel", ctx.ip);
      return ok({ slice: i, label: config.wheel[i].label, reward: publicReward(rec) });
    },

    arcade_start: async function (body, ctx) {
      if (!isOn()) return err(403, "paused", "Game prizes are paused right now.");
      var token = randCode(20);
      await store.set("run/" + token, { startedAt: now(), used: false });
      return ok({ token: token });
    },

    // The browser reports a score; check it is believable for the time played.
    arcade_finish: async function (body, ctx) {
      if (!isOn()) return err(403, "paused", "Game prizes are paused right now.");
      var token = String(body.token || "");
      var run = /^[A-Z0-9]{20}$/.test(token) ? await store.get("run/" + token) : null;
      if (!run) return err(400, "bad_run", "We couldn't check that game. Please play again.");
      if (run.used) return err(400, "run_used", "That game has already been scored.");
      run.used = true;
      await store.set("run/" + token, run);
      var R = config.arcade_run, score = Number(body.score), secs = Number(body.seconds);
      var elapsed = (now() - run.startedAt) / 1000;
      if (!(Number.isInteger(score) && score >= 0) || !(secs >= 0 && secs <= R.max_seconds + 1) || secs > elapsed + R.slack_seconds)
        return err(400, "implausible", "That score didn't look right. Please play again.");
      if (score > R.max_points_per_second * Math.min(secs, elapsed) + 50)
        return err(400, "implausible", "That score didn't look right. Please play again.");
      var tier = E.arcadeTierFor(config, score);
      if (tier < 0) return ok({ tier: null, score: score, next: config.arcade_scores[config.arcade[0].min_score] });
      if (await rateLimited(ctx.ip)) return err(429, "slow_down", "That's a lot of games! Please try again in a while.");
      var rec = await issue(config.arcade[tier], "arcade", ctx.ip, { score: score });
      return ok({ tier: tier, tierId: config.arcade[tier].id, label: config.arcade[tier].label, score: score, reward: publicReward(rec) });
    },

    // Live cart check: prices, prize, nudges. Changes nothing.
    price: async function (body) {
      try { return ok(quoteJson(await quote(body))); }
      catch (e) { if (e.code === "bad_cart") return err(400, "bad_cart", e.message); throw e; }
    },

    // Final submit: re-check everything, use up the prize, log the order.
    submit: async function (body, ctx) {
      var digits = phoneDigits(body.phone);
      if (!digits) return err(400, "bad_phone", "Please enter a valid 10-digit phone number.");
      var channel = (config.channel || []).indexOf(body.channel) >= 0 ? body.channel : config.channel[0];
      var q;
      try { q = await quote(body); }
      catch (e) { if (e.code === "bad_cart") return err(400, "bad_cart", e.message); throw e; }
      var phoneHash = hash(digits, env), t = now();
      var phoneRec = (await store.get("phone/" + phoneHash)) || null;
      var ev = q.ev;
      if (body.rewardId) {
        if (ev.status === "rejected") return err(409, "reward_rejected", ev.message);
        if (ev.status === "saved") return err(409, "reward_not_usable", ev.message);
        if (ev.incomplete) return err(409, "reward_incomplete", ev.message || "Please finish choosing your prize.");
        var days = config.limits.redeem_per_phone_days;
        if (phoneRec && phoneRec.lastRedeemAt && t - phoneRec.lastRedeemAt < days * 86400000)
          return err(409, "reward_limit", "This phone number has already used a game prize in the last " + days + " days. You can still order without the prize.");
      }
      var orderId = "PM-" + day(t).slice(5).replace("-", "") + "-" + randCode(4);
      var applied = ev.status === "applied";
      if (applied) {
        var fresh = await store.get("reward/" + ev.reward.id);       // re-read to avoid double use
        if (!fresh || fresh.used) return err(409, "reward_rejected", "This prize has already been used on an earlier order.");
        fresh.used = true; fresh.usedAt = t; fresh.orderId = orderId; fresh.phoneHash = phoneHash;
        await store.set("reward/" + fresh.id, fresh);
      }
      await store.set("phone/" + phoneHash, {
        firstOrderAt: phoneRec ? phoneRec.firstOrderAt : t, orders: (phoneRec ? phoneRec.orders : 0) + 1,
        lastOrderAt: t, lastRedeemAt: applied ? t : (phoneRec && phoneRec.lastRedeemAt) || null
      });
      // One log row per website order; rows with a reward are the redemption log (brief §7.2).
      await store.set("orders/" + day(t) + "/" + orderId, {
        orderId: orderId, at: new Date(t).toISOString(), phoneHash: phoneHash, channel: channel, newPhone: !phoneRec,
        itemTotal: q.totals.itemTotal, eligible: q.totals.eligible, total: q.totals.total,
        reward: applied ? { code: ev.reward.code, id: ev.reward.id, rewardId: ev.reward.rewardId, source: ev.reward.source,
          option: ev.optionIndex, version: ev.versionIndex, versionLabel: ev.version.label } : null,
        discount: applied ? ev.discount : 0, estCost: applied ? ev.estCost : 0
      });
      return ok(Object.assign({ orderId: orderId }, quoteJson(q)));
    },

    summary: async function (body) {
      var key = env.OFFERS_ADMIN_KEY;
      if (!key) return { status: 403, html: page("<p>Set <b>OFFERS_ADMIN_KEY</b> in Netlify (Site configuration → Environment variables) to open this page.</p>") };
      if (body.key !== key) return { status: 403, html: page("<p>Wrong key.</p>") };
      var nDays = Math.min(90, Math.max(1, parseInt(body.days, 10) || 7));
      var rows = [];
      for (var d = 0; d < nDays; d++) {
        var keys = await store.list("orders/" + day(now() - d * 86400000) + "/");
        for (var k = 0; k < keys.length; k++) { var r = await store.get(keys[k]); if (r) rows.push(r); }
      }
      return { status: 200, html: page(summaryHtml(rows, nDays)) };
    }
  };

  return {
    handle: async function (action, body, ctx) {
      var fn = actions[action];
      if (!fn) return err(404, "unknown_action", "Unknown action");
      return fn(body || {}, ctx || {});
    }
  };
}

/* ---------- weekly summary page ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function inr(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
function summaryHtml(rows, nDays) {
  rows.sort(function (a, b) { return b.at < a.at ? -1 : 1; });
  var withR = rows.filter(function (r) { return r.reward; }), without = rows.filter(function (r) { return !r.reward; });
  var cost = withR.reduce(function (s, r) { return s + (r.estCost || 0); }, 0);
  var disc = withR.reduce(function (s, r) { return s + (r.discount || 0); }, 0);
  var byType = {};
  withR.forEach(function (r) { var k = r.reward.rewardId + " · " + r.reward.versionLabel; byType[k] = (byType[k] || 0) + 1; });
  var h = "<h1>Pizza Mia · game prizes</h1><p class=m>Last " + nDays + " day" + (nDays > 1 ? "s" : "") + " of website orders</p><table>" +
    "<tr><td>Website orders</td><td>" + rows.length + "</td></tr>" +
    "<tr><td>Orders that used a prize</td><td>" + withR.length + "</td></tr>" +
    "<tr><td>Estimated cost of prizes</td><td>" + inr(cost) + "</td></tr>" +
    "<tr><td>Discounts given (part of the cost above)</td><td>" + inr(disc) + "</td></tr>" +
    "<tr><td>Average order with a prize</td><td>" + inr(avg(withR.map(function (r) { return r.eligible; }))) + "</td></tr>" +
    "<tr><td>Average order without a prize</td><td>" + inr(avg(without.map(function (r) { return r.eligible; }))) + "</td></tr>" +
    "<tr><td>Orders from new phone numbers</td><td>" + rows.filter(function (r) { return r.newPhone; }).length + "</td></tr></table>";
  h += "<h2>Prizes used</h2><table>" + (Object.keys(byType).map(function (k) { return "<tr><td>" + esc(k) + "</td><td>" + byType[k] + "</td></tr>"; }).join("") || "<tr><td>None yet</td><td></td></tr>") + "</table>";
  h += "<h2>Latest orders with a prize</h2><table><tr><th>When</th><th>Order</th><th>Prize</th><th>Order value</th><th>Discount</th><th>Est. cost</th></tr>" +
    withR.slice(0, 100).map(function (r) {
      return "<tr><td>" + esc(r.at.slice(0, 16).replace("T", " ")) + "</td><td>" + esc(r.orderId) + "</td><td>" + esc(r.reward.code + " · " + r.reward.versionLabel) +
        "</td><td>" + inr(r.eligible) + "</td><td>" + inr(r.discount) + "</td><td>" + inr(r.estCost) + "</td></tr>";
    }).join("") + "</table>";
  return h;
}
function page(inner) {
  return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Prize summary</title>" +
    "<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#22271F;background:#FBF3E6}" +
    "table{width:100%;border-collapse:collapse;margin:8px 0 22px;background:#fff}td,th{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;font-size:14px}" +
    "td:last-child{text-align:right;font-weight:700}.m{color:#7A7767}</style></head><body>" + inner + "</body></html>";
}

module.exports = { Api: Api };
