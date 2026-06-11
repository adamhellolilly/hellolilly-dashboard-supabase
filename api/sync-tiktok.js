const TT_BASE    = 'https://business-api.tiktok.com/open_api/v1.3';
const USD_TO_SEK = 10.35;
const TT_ROM_CAMP = '1854941866484754'; // HelloLilly Smartcampaign_ROM

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const token        = process.env.TIKTOK_ACCESS_TOKEN;
  const advertiser   = process.env.TIKTOK_ADVERTISER_ID;
  const today        = new Date().toISOString().slice(0, 10);

  if (!token || !advertiser) return res.status(500).json({ ok: false, error: 'Missing TikTok credentials' });

  async function supabaseUpsert(table, rows, onConflict) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!r.ok) { const e = await r.text(); throw new Error(`Supabase: ${e}`); }
  }

  try {
    const queryParams = [
      `advertiser_id=${advertiser}`,
      `report_type=BASIC`,
      `data_level=AUCTION_CAMPAIGN`,
      `dimensions=${encodeURIComponent(JSON.stringify(['campaign_id']))}`,
      `metrics=${encodeURIComponent(JSON.stringify(['campaign_name','spend','impressions','reach','clicks','ctr','cpc','cpm','frequency','complete_registration','cost_per_complete_registration']))}`,
      `start_date=${today}`,
      `end_date=${today}`,
      `page_size=100`,
    ].join('&');

    const insRes = await fetch(`${TT_BASE}/report/integrated/get/?${queryParams}`, {
      method: 'GET',
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
    });

    const rawText = await insRes.text();
    let insData;
    try { insData = JSON.parse(rawText); }
    catch(e) { throw new Error('TikTok returned non-JSON: ' + rawText.slice(0, 300)); }

    if (insData.code !== 0) throw new Error(`TikTok API error (code ${insData.code}): ${insData.message}`);

    const rows = (insData.data?.list || [])
      .map(r => ({
        date:          today,
        platform:      'tiktok',
        campaign_id:   String(r.dimensions?.campaign_id || ''),
        campaign_name: r.metrics?.campaign_name || '',
        spend:         parseFloat(r.metrics?.spend || 0) * USD_TO_SEK,
        impressions:   parseInt(r.metrics?.impressions || 0),
        reach:         parseInt(r.metrics?.reach || 0),
        clicks:        parseInt(r.metrics?.clicks || 0),
        leads:         parseInt(r.metrics?.complete_registration || 0),
        cpm:           parseFloat(r.metrics?.cpm || 0) * USD_TO_SEK,
        ctr:           parseFloat(r.metrics?.ctr || 0),
        cpc:           parseFloat(r.metrics?.cpc || 0) * USD_TO_SEK,
        cost_per_lead: parseFloat(r.metrics?.cost_per_complete_registration || 0) ? parseFloat(r.metrics?.cost_per_complete_registration) * USD_TO_SEK : null,
        frequency:     parseFloat(r.metrics?.frequency || 0),
      }))
      .filter(r => r.spend > 0 && String(r.campaign_id) === TT_ROM_CAMP);

    if (rows.length) await supabaseUpsert('campaign_snapshots', rows, 'date,platform,campaign_id');

    return res.status(200).json({ ok: true, date: today, campaigns_synced: rows.length });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
