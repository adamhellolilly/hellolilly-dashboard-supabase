// api/tiktok.js
const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token        = process.env.TIKTOK_ACCESS_TOKEN;
  const advertiserId = process.env.TIKTOK_ADVERTISER_ID;

  if (!token || !advertiserId) {
    return res.status(500).json({ error: 'Missing TIKTOK_ACCESS_TOKEN or TIKTOK_ADVERTISER_ID' });
  }

  const preset = req.query.preset || 'this_month';
  const today  = new Date();
  function fmt(d) { return d.toISOString().slice(0, 10); }
  let startDate, endDate = fmt(today);

  switch (preset) {
    case 'last_7d':
      startDate = fmt(new Date(today - 7 * 86400000)); break;
    case 'last_30d':
      startDate = fmt(new Date(today - 30 * 86400000)); break;
    case 'last_month':
      startDate = fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1));
      endDate   = fmt(new Date(today.getFullYear(), today.getMonth(), 0)); break;
    case 'this_month':
    default:
      startDate = fmt(new Date(today.getFullYear(), today.getMonth(), 1)); break;
  }

  try {
    // 1. Get active campaigns
    const campRes = await fetch(
      `${TT_BASE}/campaign/get/?advertiser_id=${advertiserId}&fields=["campaign_id","campaign_name","status"]&filtering={"primary_status":"STATUS_CAMPAIGN_STATUS_ENABLE"}&page_size=100`,
      { headers: { 'Access-Token': token } }
    );
    const campData = await campRes.json();
    if (campData.code !== 0) throw new Error(campData.message || 'Campaign fetch failed');

    const activeIds = (campData.data?.list || []).map(c => c.campaign_id);
    if (!activeIds.length) return res.status(200).json({ preset, campaigns: [] });

    // 2. Get insights
    const insRes = await fetch(`${TT_BASE}/report/integrated/get/`, {
      method: 'POST',
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        advertiser_id: advertiserId,
        report_type:   'BASIC',
        dimensions:    ['campaign_id'],
        metrics: ['campaign_name','spend','impressions','reach','clicks','ctr','cpc','cpm','frequency','result','cost_per_result'],
        start_date: startDate,
        end_date:   endDate,
        filtering:  [{ field_name: 'campaign_id', filter_type: 'IN', filter_value: JSON.stringify(activeIds) }],
        page_size: 100,
      }),
    });

    const insData = await insRes.json();
    if (insData.code !== 0) throw new Error(insData.message || 'Insights fetch failed');

    const campaigns = (insData.data?.list || [])
      .map(row => ({
        id:            row.dimensions?.campaign_id,
        name:          row.metrics.campaign_name,
        spend:         parseFloat(row.metrics.spend || 0),
        impressions:   parseInt(row.metrics.impressions || 0),
        reach:         parseInt(row.metrics.reach || 0),
        clicks:        parseInt(row.metrics.clicks || 0),
        ctr:           parseFloat(row.metrics.ctr || 0),
        cpc:           parseFloat(row.metrics.cpc || 0),
        cpm:           parseFloat(row.metrics.cpm || 0),
        frequency:     parseFloat(row.metrics.frequency || 0),
        leads:         parseInt(row.metrics.result || 0),
        cost_per_lead: parseFloat(row.metrics.cost_per_result || 0),
      }))
      .filter(c => c.spend > 0)
      .sort((a, b) => b.spend - a.spend);

    return res.status(200).json({ preset, start_date: startDate, end_date: endDate, fetched_at: new Date().toISOString(), campaigns });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
