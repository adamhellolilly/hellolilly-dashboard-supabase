module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const days         = parseInt(req.query.days || '30');
  const startDate    = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const [campsRes, adsRes, funnelRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/campaign_snapshots?date=gte.${startDate}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/ad_snapshots?date=gte.${startDate}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/hubspot_funnel?select=*&order=date.desc&limit=1`, { headers }),
    ]);

    const [camps, ads, funnelArr] = await Promise.all([
      campsRes.json(), adsRes.json(), funnelRes.json(),
    ]);

    if (camps.error) throw new Error(camps.error.message);
    if (ads.error)   throw new Error(ads.error.message);

    const byPlatform = {};
    for (const row of camps || []) {
      const k = row.platform;
      if (!byPlatform[k]) byPlatform[k] = { spend:0, impressions:0, reach:0, clicks:0, leads:0 };
      byPlatform[k].spend       += parseFloat(row.spend || 0);
      byPlatform[k].impressions += parseInt(row.impressions || 0);
      byPlatform[k].reach       += parseInt(row.reach || 0);
      byPlatform[k].clicks      += parseInt(row.clicks || 0);
      byPlatform[k].leads       += parseInt(row.leads || 0);
    }

    const adMap = {};
    for (const row of ads || []) {
      if (!adMap[row.ad_id]) {
        adMap[row.ad_id] = {
          ad_id: row.ad_id, ad_name: row.ad_name,
          platform: row.platform, campaign_name: row.campaign_name,
          spend:0, impressions:0, reach:0, clicks:0, leads:0,
        };
      }
      adMap[row.ad_id].spend       += parseFloat(row.spend || 0);
      adMap[row.ad_id].impressions += parseInt(row.impressions || 0);
      adMap[row.ad_id].reach       += parseInt(row.reach || 0);
      adMap[row.ad_id].clicks      += parseInt(row.clicks || 0);
      adMap[row.ad_id].leads       += parseInt(row.leads || 0);
    }

    const adList = Object.values(adMap).map(a => ({
      ...a,
      cpm:           a.impressions > 0 ? (a.spend / a.impressions * 1000) : null,
      ctr:           a.impressions > 0 ? (a.clicks / a.impressions * 100) : null,
      cpc:           a.clicks > 0 ? (a.spend / a.clicks) : null,
      cost_per_lead: a.leads > 0 ? (a.spend / a.leads) : null,
    })).sort((a, b) => b.spend - a.spend);

    return res.status(200).json({
      ok: true, period_days: days, start_date: startDate,
      platforms: byPlatform,
      ads: adList,
      funnel: (funnelArr || [])[0] || null,
      synced_at: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
