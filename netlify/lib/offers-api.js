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
function clip(v, n) { return String(v == null ? "" : v).trim().slice(0, n); }
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

  // Counter laptop (kitchen screen): its own secret, separate from the report password.
  function kitchenKeyOk(given) {
    var key = String(env.KITCHEN_KEY || "").trim();
    if (key.length < 16 || typeof given !== "string") return false;
    var a = crypto.createHash("sha256").update(key).digest(), b = crypto.createHash("sha256").update(given.trim()).digest();
    return crypto.timingSafeEqual(a, b);
  }
  // The shop's day starts at 6 AM IST (it is open till 3 AM), as a UTC timestamp.
  function shopDayStart(t) {
    var IST = 330 * 60000, d = new Date(t + IST - 6 * 3600000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 6 * 3600000 - IST;
  }
  async function recentOrderKeys() {
    var t = now(), keys = [];
    for (var d = 0; d < 2; d++) keys = keys.concat(await store.list("orders/" + day(t - d * 86400000) + "/"));
    return keys;
  }
  function kitchenOrder(r) {
    return { orderId: r.orderId, at: r.at, channel: r.channel, customer: r.customer || null, items: r.items || [],
      freeItems: r.freeItems || [], itemTotal: r.itemTotal, prize: r.reward ? r.reward.code + " · " + r.reward.versionLabel : "",
      discount: r.discount || 0, gst: r.gst, total: r.total, newCustomer: !!r.newPhone, seenAt: r.seenAt || null };
  }

  var actions = {
    config: async function () { return ok(E.publicConfig(config, menu, env)); },

    // Today's website orders (since 6 AM IST) for the counter laptop. "known" = orders it already has and
    // staff have seen, so those aren't re-read every poll; the laptop drops any older than "from".
    kitchen_feed: async function (body) {
      if (!env.KITCHEN_KEY) return err(403, "not_set_up", "KITCHEN_KEY is not set in Netlify.");
      if (!kitchenKeyOk(body.key)) return err(403, "bad_key", "Wrong secret code.");
      var known = {}, from = shopDayStart(now());
      (Array.isArray(body.known) ? body.known : []).slice(0, 500).forEach(function (id) { known[id] = true; });
      var keys = await recentOrderKeys(), ids = [], orders = [];
      for (var i = 0; i < keys.length; i++) {
        var id = keys[i].split("/").pop();
        if (known[id]) { ids.push(id); continue; }
        var r = await store.get(keys[i]);
        if (!r || Date.parse(r.at) < from) continue;
        ids.push(id); orders.push(kitchenOrder(r));
      }
      return ok({ now: new Date(now()).toISOString(), from: new Date(from).toISOString(), ids: ids, orders: orders });
    },

    // Staff pressed Enter on the laptop: record when the order was seen.
    kitchen_ack: async function (body) {
      if (!kitchenKeyOk(body.key)) return err(403, "bad_key", "Wrong secret code.");
      var id = String(body.orderId || "");
      if (!/^PM-\d{4}-[A-Z0-9]{4}$/.test(id)) return err(400, "bad_order", "Unknown order");
      var keys = await recentOrderKeys();
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].split("/").pop() !== id) continue;
        var r = await store.get(keys[i]);
        if (!r.seenAt) { r.seenAt = new Date(now()).toISOString(); await store.set(keys[i], r); }
        return ok({ orderId: id, seenAt: r.seenAt });
      }
      return err(404, "bad_order", "Unknown order");
    },

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
      // One log row per website order (the owner's customer record); rows with a reward are the redemption log (brief §7.2).
      var c = body.customer || {};
      await store.set("orders/" + day(t) + "/" + orderId, {
        orderId: orderId, at: new Date(t).toISOString(), phoneHash: phoneHash, channel: channel, newPhone: !phoneRec,
        customer: { name: clip(c.name, 100), phone: digits, address: clip(c.address, 400), landmark: clip(c.landmark, 150), notes: clip(c.notes, 400) },
        items: q.priced.lines.map(function (l) {
          return { name: l.name, size: l.sizeLabel, choice: l.choice || "", qty: l.qty, toppings: l.toppings.map(function (x) { return x.name; }), total: l.total };
        }),
        freeItems: applied ? ev.freeLines.map(function (f) { return f.text; }) : [],
        itemTotal: q.totals.itemTotal, eligible: q.totals.eligible, gst: q.totals.gst, total: q.totals.total,
        reward: applied ? { code: ev.reward.code, id: ev.reward.id, rewardId: ev.reward.rewardId, source: ev.reward.source,
          option: ev.optionIndex, version: ev.versionIndex, versionLabel: ev.version.label } : null,
        discount: applied ? ev.discount : 0, estCost: applied ? ev.estCost : 0
      });
      return ok(Object.assign({ orderId: orderId }, quoteJson(q)));
    },

    summary: async function (body) {
      var key = env.OFFERS_ADMIN_KEY;
      if (!key) return { status: 403, html: page("<p>Set <b>OFFERS_ADMIN_KEY</b> in Netlify (Site configuration → Environment variables) to open this page.</p>") };
      if (!body.key) return { status: 200, html: page(loginHtml("")) };
      if (String(body.key).trim() !== key.trim()) return { status: 403, html: page(loginHtml("Wrong password. Please try again.")) };
      var nDays = Math.min(366, Math.max(1, parseInt(body.days, 10) || 7));
      var rows = [];
      for (var d = 0; d < nDays; d++) {
        var keys = await store.list("orders/" + day(now() - d * 86400000) + "/");
        for (var k = 0; k < keys.length; k++) { var r = await store.get(keys[k]); if (r) rows.push(r); }
      }
      rows.sort(function (a, b) { return b.at < a.at ? -1 : 1; });
      if (body.format === "csv") return { status: 200, csv: ordersCsv(rows), filename: "pizza-mia-orders-last-" + nDays + "-days.csv" };
      return { status: 200, html: page(summaryHtml(rows, nDays, body.key)) };
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
// Password box for the summary; posts back so the password stays out of the address bar.
function loginHtml(msg) {
  return "<h1>Pizza Mia · website orders</h1><p class=m>Enter the report password to see website orders, customers and prizes.</p>" +
    (msg ? "<p style='color:#C9341F;font-weight:700'>" + esc(msg) + "</p>" : "") +
    "<form method=post action='/.netlify/functions/offers'><input type=hidden name=action value=summary>" +
    "<input type=password name=key autocomplete=current-password autofocus required placeholder='Password' " +
    "style='font-size:17px;padding:12px;border:1px solid #ccc;border-radius:10px;width:100%;box-sizing:border-box;margin:6px 0 10px'>" +
    daysOptions(7) + "<br>" +
    "<button style='font-size:17px;font-weight:700;padding:12px 22px;border:0;border-radius:10px;background:#1B3A2A;color:#fff'>Open report</button></form>";
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function inr(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
function daysOptions(sel) {
  return "<select name=days style='font-size:16px;padding:10px;border-radius:10px;border:1px solid #ccc;margin-bottom:12px'>" +
    [[1, "Today"], [7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [366, "Last 12 months"]].map(function (o) {
      return "<option value=" + o[0] + (o[0] === sel ? " selected" : "") + ">" + o[1] + "</option>";
    }).join("") + "</select>";
}
function ist(at) { return new Date(Date.parse(at) + 330 * 60000).toISOString().slice(0, 16).replace("T", " "); }
function cust(r) { return r.customer || { name: "", phone: "", address: "", landmark: "", notes: "" }; }
function itemText(i) {
  return i.qty + " × " + i.name + ([i.size, i.choice].filter(Boolean).length ? " (" + [i.size, i.choice].filter(Boolean).join(", ") + ")" : "") +
    (i.toppings && i.toppings.length ? " + " + i.toppings.join(", ") : "");
}
function prizeText(r) { return r.reward ? r.reward.code + " · " + r.reward.versionLabel : ""; }
function summaryHtml(rows, nDays, key) {
  var withR = rows.filter(function (r) { return r.reward; }), without = rows.filter(function (r) { return !r.reward; });
  var cost = withR.reduce(function (s, r) { return s + (r.estCost || 0); }, 0);
  var disc = withR.reduce(function (s, r) { return s + (r.discount || 0); }, 0);
  var sales = rows.reduce(function (s, r) { return s + (r.total || 0); }, 0);
  var byType = {};
  withR.forEach(function (r) { var k = r.reward.rewardId + " · " + r.reward.versionLabel; byType[k] = (byType[k] || 0) + 1; });
  var h = "<h1>Pizza Mia · website orders</h1><p class=m>" + esc({ 1: "Today", 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days", 366: "Last 12 months" }[nDays] || ("Last " + nDays + " days")) + "</p>" +
    "<form method=post action='/.netlify/functions/offers' style='display:flex;gap:8px;flex-wrap:wrap;align-items:center'>" +
    "<input type=hidden name=action value=summary><input type=hidden name=key value=\"" + esc(key) + "\">" + daysOptions(nDays) +
    "<button class=b>Show</button><button class=b name=format value=csv>Download for Excel</button></form>" +
    "<table>" +
    "<tr><td>Website orders</td><td>" + rows.length + "</td></tr>" +
    "<tr><td>Total sales (incl. GST)</td><td>" + inr(sales) + "</td></tr>" +
    "<tr><td>Orders that used a prize</td><td>" + withR.length + "</td></tr>" +
    "<tr><td>Estimated cost of prizes</td><td>" + inr(cost) + "</td></tr>" +
    "<tr><td>Discounts given (part of the cost above)</td><td>" + inr(disc) + "</td></tr>" +
    "<tr><td>Average order with a prize</td><td>" + inr(avg(withR.map(function (r) { return r.eligible; }))) + "</td></tr>" +
    "<tr><td>Average order without a prize</td><td>" + inr(avg(without.map(function (r) { return r.eligible; }))) + "</td></tr>" +
    "<tr><td>Orders from new phone numbers</td><td>" + rows.filter(function (r) { return r.newPhone; }).length + "</td></tr></table>";
  h += "<h2>Prizes used</h2><table>" + (Object.keys(byType).map(function (k) { return "<tr><td>" + esc(k) + "</td><td>" + byType[k] + "</td></tr>"; }).join("") || "<tr><td>None yet</td><td></td></tr>") + "</table>";

  // Customers: one row per phone number, newest first.
  var people = {}, order = [];
  rows.forEach(function (r) {
    var c = cust(r), k = c.phone || r.phoneHash;
    if (!people[k]) { people[k] = { name: c.name, phone: c.phone, address: c.address, last: r.at, orders: 0, spent: 0, saved: 0 }; order.push(k); }
    var p = people[k]; p.orders++; p.spent += r.total || 0; p.saved += r.discount || 0;
    if (!p.name && c.name) p.name = c.name;
    if (!p.address && c.address) p.address = c.address;
  });
  h += "<h2>Customers (" + order.length + ")</h2><div class=x><table class=w><tr><th>Name</th><th>Phone</th><th>Address</th><th>Orders</th><th>Spent</th><th>Discounts</th><th>Last order</th></tr>" +
    (order.map(function (k) {
      var p = people[k];
      return "<tr><td>" + (esc(p.name) || "<span class=m>not saved</span>") + "</td><td>" + (p.phone ? "<a href='tel:+91" + esc(p.phone) + "'>" + esc(p.phone) + "</a>" : "") +
        "</td><td>" + esc(p.address) + "</td><td>" + p.orders + "</td><td>" + inr(p.spent) + "</td><td>" + inr(p.saved) + "</td><td>" + esc(ist(p.last)) + "</td></tr>";
    }).join("") || "<tr><td colspan=7>No website orders yet</td></tr>") + "</table></div>";

  h += "<h2>Orders</h2>" + (rows.length ? rows.slice(0, 300).map(function (r) {
    var c = cust(r);
    return "<div class=o><div class=oh><b>" + esc(r.orderId) + "</b><span class=m>" + esc(ist(r.at)) + " IST</span></div>" +
      "<div><b>" + (esc(c.name) || "<span class=m>Name not saved (older order)</span>") + "</b>" + (c.phone ? " · <a href='tel:+91" + esc(c.phone) + "'>" + esc(c.phone) + "</a>" : "") + "</div>" +
      (c.address ? "<div>" + esc(c.address) + (c.landmark ? " (near " + esc(c.landmark) + ")" : "") + "</div>" : "") +
      (c.notes ? "<div class=m>Notes: " + esc(c.notes) + "</div>" : "") +
      "<table>" + (r.items || []).map(function (i) { return "<tr><td>" + esc(itemText(i)) + "</td><td>" + inr(i.total) + "</td></tr>"; }).join("") +
      (r.freeItems || []).map(function (f) { return "<tr><td>🎁 " + esc(f) + "</td><td>₹0</td></tr>"; }).join("") +
      "<tr><td>Item total</td><td>" + inr(r.itemTotal) + "</td></tr>" +
      (r.reward ? "<tr><td>Prize: " + esc(prizeText(r)) + "</td><td>-" + inr(r.discount || 0) + "</td></tr>" : "") +
      (r.gst != null ? "<tr><td>GST</td><td>" + inr(r.gst) + "</td></tr>" : "") +
      "<tr><td><b>Total</b></td><td>" + inr(r.total) + "</td></tr>" +
      "<tr><td class=m>Seen by staff on the counter laptop</td><td class=m>" + (r.seenAt ? esc(ist(r.seenAt).slice(11)) : "Not yet") + "</td></tr>" +
      (r.reward ? "<tr><td class=m>Estimated cost of the prize to us</td><td class=m>" + inr(r.estCost || 0) + "</td></tr>" : "") +
      "</table></div>";
  }).join("") : "<p>No website orders yet.</p>");
  return h;
}
function csvCell(v) { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
function ordersCsv(rows) {
  var head = ["Date (IST)", "Order ID", "Name", "Phone", "Address", "Landmark", "Notes", "Items", "Free items", "Item total", "Prize", "Discount", "GST", "Total", "Est. prize cost", "New customer", "Seen by staff (IST)"];
  var lines = rows.map(function (r) {
    var c = cust(r);
    return [ist(r.at), r.orderId, c.name, c.phone, c.address, c.landmark, c.notes,
      (r.items || []).map(itemText).join("; "), (r.freeItems || []).join("; "), r.itemTotal, prizeText(r), r.discount || 0,
      r.gst != null ? r.gst : "", r.total, r.estCost || 0, r.newPhone ? "Yes" : "No", r.seenAt ? ist(r.seenAt) : ""].map(csvCell).join(",");
  });
  return "﻿" + [head.map(csvCell).join(",")].concat(lines).join("\r\n");
}
function page(inner) {
  return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Pizza Mia orders</title>" +
    "<style>body{font-family:system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#22271F;background:#FBF3E6}" +
    "table{width:100%;border-collapse:collapse;margin:8px 0 22px;background:#fff}td,th{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;font-size:14px}" +
    "td:last-child{text-align:right;font-weight:700}.m{color:#7A7767}a{color:#1B3A2A}" +
    ".x{overflow-x:auto}.w td,.w th{white-space:nowrap}.w td:nth-child(3){white-space:normal;min-width:180px}" +
    ".o{background:#fff;border-radius:12px;padding:12px 14px;margin:0 0 12px;font-size:14px;line-height:1.45}.o table{margin:8px 0 0}" +
    ".oh{display:flex;justify-content:space-between;gap:8px}.b{font-size:15px;font-weight:700;padding:10px 16px;border:0;border-radius:10px;background:#1B3A2A;color:#fff;margin-bottom:12px}</style></head><body>" + inner + "</body></html>";
}

module.exports = { Api: Api };
