export default async function handler(req, res) {
  const method = req.method || "GET";

  // Protection:
  // 1) If LANDING_OWNER_PIN is set in Vercel env, that value is used.
  // 2) Otherwise fallback to default PIN below.
  const requiredPin = process.env.LANDING_OWNER_PIN || "778899";

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
    if (!data || data.result == null) return null;
    try {
      // Normal case: result is JSON string
      if (typeof data.result === "string") {
        const parsed = JSON.parse(data.result);
        // Migration helper: older bad write could store ["{...json...}"]
        if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "string") {
          try {
            return JSON.parse(parsed[0]);
          } catch (_) {
            return null;
          }
        }
        return parsed;
      }
      // Some clients may return object directly.
      if (typeof data.result === "object") return data.result;
      return null;
    } catch (_) {
      return null;
    }
  }

  async function kvSet(key, value) {
    const base = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!base || !token) return false;

    const serialized = encodeURIComponent(JSON.stringify(value));
    const url = base.replace(/\/$/, "") + "/set/" + encodeURIComponent(key) + "/" + serialized;
    const resp = await fetch(url, {
      headers: { Authorization: "Bearer " + token }
    });
    return resp.ok;
  }

  const KEY = "landing_config_v1";
  const FALLBACK_DEFAULTS = {
    title: "Reezo Official Links",
    subtitle: "Pilih mana-mana link rasmi di bawah.",
    primaryLabel: "Open Bot",
    primaryUrl: "https://t.me/MMHREEZO_BOT",
    primaryIcon: "telegram.png",
    primaryEffect: "",
    secondaryLabel: "Open WhatsApp Channel",
    secondaryUrl: "https://whatsapp.com/channel/YOUR_CHANNEL_ID",
    secondaryIcon: "whatsapp.png",
    secondaryEffect: "",
    extraButtons: []
  };

  function normalizeExtraButtons(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({
        label: String((item && item.label) || "").trim(),
        url: String((item && item.url) || "").trim(),
        icon: String((item && item.icon) || "").trim(),
        effect: String((item && item.effect) || "").trim()
      }))
      .filter((item) => item.label && item.url);
  }

  function mergeExtraButtons(existingList, incomingList) {
    const map = new Map();
    for (const item of normalizeExtraButtons(existingList)) {
      const key = `${item.label.toLowerCase()}|${item.url.toLowerCase()}`;
      map.set(key, item);
    }
    // incoming overrides existing on same key (allows editing effect/icon later)
    for (const item of normalizeExtraButtons(incomingList)) {
      const key = `${item.label.toLowerCase()}|${item.url.toLowerCase()}`;
      map.set(key, item);
    }
    return Array.from(map.values());
  }

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

    const current = (await kvGet(KEY)) || globalThis.__landingConfigStore || FALLBACK_DEFAULTS;
    const incoming = {
      title: String(body.title || "").trim(),
      subtitle: String(body.subtitle || "").trim(),
      primaryLabel: String(body.primaryLabel || "").trim(),
      primaryUrl: String(body.primaryUrl || "").trim(),
      primaryIcon: String(body.primaryIcon || "").trim(),
      primaryEffect: String(body.primaryEffect || "").trim(),
      secondaryLabel: String(body.secondaryLabel || "").trim(),
      secondaryUrl: String(body.secondaryUrl || "").trim(),
      secondaryIcon: String(body.secondaryIcon || "").trim(),
      secondaryEffect: String(body.secondaryEffect || "").trim(),
      extraButtons: Array.isArray(body.extraButtons) ? body.extraButtons : []
    };

    // Keep prior saved values if incoming fields are empty; append extra buttons (do not overwrite old ones).
    const payload = {
      title: incoming.title || current.title || FALLBACK_DEFAULTS.title,
      subtitle: incoming.subtitle || current.subtitle || FALLBACK_DEFAULTS.subtitle,
      primaryLabel: incoming.primaryLabel || current.primaryLabel || FALLBACK_DEFAULTS.primaryLabel,
      primaryUrl: incoming.primaryUrl || current.primaryUrl || FALLBACK_DEFAULTS.primaryUrl,
      // icon/effect allow explicit empty string from owner to clear value
      primaryIcon: incoming.primaryIcon,
      primaryEffect: incoming.primaryEffect,
      secondaryLabel: incoming.secondaryLabel || current.secondaryLabel || FALLBACK_DEFAULTS.secondaryLabel,
      secondaryUrl: incoming.secondaryUrl || current.secondaryUrl || FALLBACK_DEFAULTS.secondaryUrl,
      secondaryIcon: incoming.secondaryIcon,
      secondaryEffect: incoming.secondaryEffect,
      extraButtons: mergeExtraButtons(current.extraButtons, incoming.extraButtons)
    };

    globalThis.__landingConfigStore = payload;
    const savedKv = await kvSet(KEY, payload);

    return res.status(200).json({ ok: true, savedKv: Boolean(savedKv) });
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
