export default async function handler(req, res) {
  const method = req.method || "GET";

  // Optional protection: set LANDING_OWNER_PIN in Vercel env, then owner page must send same pin.
  const requiredPin = process.env.LANDING_OWNER_PIN || "";

  // Simple in-memory fallback when KV is not configured.
  if (!globalThis.__landingConfigStore) {
    globalThis.__landingConfigStore = null;
  }

  async function kvGet(key) {
    const base = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!base || !token) return null;

    const url = base.replace(/\/$/, "") + "/get/" + encodeURIComponent(key);
    const resp = await fetch(url, {
      headers: { Authorization: "Bearer " + token }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || typeof data.result !== "string") return null;
    try {
      return JSON.parse(data.result);
    } catch (_) {
      return null;
    }
  }

  async function kvSet(key, value) {
    const base = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!base || !token) return false;

    const url = base.replace(/\/$/, "") + "/set/" + encodeURIComponent(key);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([JSON.stringify(value)])
    });
    return resp.ok;
  }

  const KEY = "landing_config_v1";

  if (method === "GET") {
    const kvValue = await kvGet(KEY);
    if (kvValue) {
      return res.status(200).json({ ok: true, source: "kv", data: kvValue });
    }
    return res.status(200).json({ ok: true, source: "memory", data: globalThis.__landingConfigStore });
  }

  if (method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { body = null; }
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ ok: false, error: "invalid_payload" });
    }

    const pin = String((body.pin || "")).trim();
    if (requiredPin && pin !== requiredPin) {
      return res.status(401).json({ ok: false, error: "invalid_pin" });
    }

    const payload = {
      title: String(body.title || "").trim(),
      subtitle: String(body.subtitle || "").trim(),
      primaryLabel: String(body.primaryLabel || "").trim(),
      primaryUrl: String(body.primaryUrl || "").trim(),
      primaryIcon: String(body.primaryIcon || "").trim(),
      secondaryLabel: String(body.secondaryLabel || "").trim(),
      secondaryUrl: String(body.secondaryUrl || "").trim(),
      secondaryIcon: String(body.secondaryIcon || "").trim(),
      extraButtons: Array.isArray(body.extraButtons) ? body.extraButtons : []
    };

    globalThis.__landingConfigStore = payload;
    const savedKv = await kvSet(KEY, payload);

    return res.status(200).json({ ok: true, savedKv: Boolean(savedKv) });
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
