// api/tiktok-auth.js
// One-time helper to generate a TikTok access token from App ID + Secret
// Call: GET /api/tiktok-auth

export default async function handler(req, res) {
  const appId     = process.env.TIKTOK_APP_ID;
  const appSecret = process.env.TIKTOK_APP_SECRET;

  if (!appId || !appSecret) {
    return res.status(500).json({ error: 'Missing TIKTOK_APP_ID or TIKTOK_APP_SECRET' });
  }

  try {
    const r = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, secret: appSecret }),
    });

    const data = await r.json();

    if (data.code !== 0) {
      return res.status(400).json({ error: data.message, full: data });
    }

    return res.status(200).json({
      access_token:      data.data?.access_token,
      advertiser_ids:    data.data?.advertiser_ids,
      scope:             data.data?.scope,
      note: 'Save this access_token as TIKTOK_ACCESS_TOKEN in Vercel env vars',
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
