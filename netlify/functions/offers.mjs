// Pizza Mia game prizes (Netlify Function). The browser only shows what this decides:
// wheel spins, arcade scores, cart prices, prizes and the final order total.
// Rules live in netlify/lib; numbers live in offers.config.json.
// Kill switch without a code change: set the Netlify env var OFFERS_ENABLED=false.
// Weekly summary: /.netlify/functions/offers?action=summary&key=<OFFERS_ADMIN_KEY>
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import offersApi from "../lib/offers-api.js";
import config from "../../offers.config.json";
import menu from "../../assets/menu.js";

// Connects to Netlify Blobs on first use (the config call needs no storage).
function blobStore() {
  let store = null;
  const S = () => store || (store = getStore({ name: "pizzamia-offers", consistency: "strong" }));
  return {
    get: (key) => S().get(key, { type: "json" }),
    set: (key, obj) => S().setJSON(key, obj),
    list: async (prefix) => (await S().list({ prefix })).blobs.map((b) => b.key)
  };
}

export default async (req, context) => {
  const url = new URL(req.url);
  let body = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch (e) { return Response.json({ error: "bad_request" }, { status: 400 }); }
  } else {
    url.searchParams.forEach((v, k) => { body[k] = v; });
  }
  const action = body.action || url.searchParams.get("action") || "config";
  if (req.method !== "POST" && action !== "config" && action !== "summary") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const api = offersApi.Api({ config, menu, crypto, store: blobStore(), env: process.env });
  try {
    const r = await api.handle(action, body, { ip: context.ip });
    if (r.html) return new Response(r.html, { status: r.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    return Response.json(r.json, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("offers error", action, e);
    return Response.json({ error: "server_error", message: "Something went wrong. Please try again." }, { status: 500 });
  }
};
