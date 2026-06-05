// api/tiktok-callback.js
// OAuth callback — TikTok redirects here with ?code=xxx
// Exchanges the code for a real access token and displays it

module.exports = async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send(`
      <h2>No auth code received</h2>
      <p>TikTok didn't send a code. Make sure the redirect URI is correct.</p>
      <p>Query params: ${JSON.stringify(req.query)}</p>
    `);
  }

  const appId     = process.env.TIKTOK_APP_ID;
  const appSecret = process.env.TIKTOK_APP_SECRET;

  try {
    const r = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code: code }),
    });

    const data = await r.json();

    if (data.code !== 0) {
      return res.status(400).send(`
        <h2>Token exchange failed</h2>
        <pre>${JSON.stringify(data, null, 2)}</pre>
      `);
    }

    const token       = data.data?.access_token;
    const advertiserIds = data.data?.advertiser_ids || [];

    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><title>TikTok Token</title>
      <style>
        body { font-family: monospace; max-width: 700px; margin: 60px auto; padding: 20px; background: #0e1117; color: #e0e0e0; }
        h2 { color: #4f7eff; }
        .box { background: #1a1d27; border: 1px solid #2a2d3a; padding: 16px; border-radius: 8px; margin: 16px 0; word-break: break-all; }
        .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
        button { background: #4f7eff; border: none; color: white; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-family: monospace; margin-top: 8px; }
      </style>
      </head>
      <body>
        <h2>✅ Token Generated Successfully!</h2>
        <div class="label">Access Token — add to Vercel as TIKTOK_ACCESS_TOKEN</div>
        <div class="box" id="token">${token}</div>
        <button onclick="navigator.clipboard.writeText('${token}').then(()=>this.textContent='Copied!')">Copy Token</button>
        <div class="label" style="margin-top:20px">Advertiser IDs</div>
        <div class="box">${advertiserIds.join('<br>')}</div>
        <p style="color:#888;margin-top:20px">Copy the token above and add it to Vercel → Settings → Environment Variables → TIKTOK_ACCESS_TOKEN, then redeploy.</p>
      </body>
      </html>
    `);

  } catch (err) {
    return res.status(500).send(`<h2>Error</h2><pre>${err.message}</pre>`);
  }
};
