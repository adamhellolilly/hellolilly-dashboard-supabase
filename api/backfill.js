const FB_BASE    = 'https://graph.facebook.com/v18.0';
const TT_BASE    = 'https://business-api.tiktok.com/open_api/v1.3';
const ROM_CAMPS  = ['120232042406430116', '120242593005960116'];
const USD_TO_SEK = 10.35; // TikTok account is in USD, convert to SEK

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const fbToken      = process.env.FB_ACCESS_TOKEN;
  const fbAccount    = process.env.FB_AD_ACCOUNT_ID;
  const ttToken      = process.env.TIKTOK_ACCESS_TOKEN;
  const ttAdvertiser = process.env.TIKTOK_ADVERTISER_ID;
  const days         = parseInt(req.query.days || '90');
  const preset       = 'maximum';

  async function supabaseUpsert(table, rows, onConflict) {
    if (!rows.length) return;
    const batchSize = 200;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      });
      if (!r.ok) { const e = await r.text(); throw new Error(`Supabase ${table}: ${e}`); }
    }
  }

  function getAction(actions, type) {
    if (!actions) return 0;
    const a = actions.find(x => x.action_type === type);
    return a ? parseInt(a.value) : 0;
  }

  const results = { facebook: null, tiktok: null };

  // ── FACEBOOK BACKFILL ────────────────────────────────────────────────────
  try {
    const fields = 'campaign_id,campaign_name,spend,impressions,reach,frequency,cpm,clicks,ctr,cpc,actions,date_start';
    const filter = JSON.stringify(ROM_CAMPS);

    // Campaign level with daily breakdown
    const campRes = await fetch(
      `${FB_BASE}/${fbAccount}/insights?fields=${fields}&date_preset=${preset}&level=campaign&time_increment=1&filtering=[{"field":"campaign.id","operator":"IN","value":${filter}}]&limit=500&access_token=${fbToken}`
    );
    const campData = await campRes.json();
    if (campData.error) throw new Error(campData.error.message);

    const campRows = (campData.data || []).map(d => ({
      date: d.date_start, platform: 'facebook',
      campaign_id: d.campaign_id, campaign_name: d.campaign_name,
      spend: parseFloat(d.spend || 0),
      impressions: parseInt(d.impressions || 0),
      reach: parseInt(d.reach || 0),
      clicks: parseInt(d.clicks || 0),
      leads: getAction(d.actions, 'lead'),
      cpm: parseFloat(d.cpm || 0),
      ctr: parseFloat(d.ctr || 0),
      cpc: parseFloat(d.cpc || 0),
      cost_per_lead: getAction(d.actions, 'lead') > 0 ? parseFloat(d.spend) / getAction(d.actions, 'lead') : null,
      frequency: parseFloat(d.frequency || 0),
    }));

    await supabaseUpsert('campaign_snapshots', campRows, 'date,platform,campaign_id');

    // Ad level with daily breakdown
    const adRes = await fetch(
      `${FB_BASE}/${fbAccount}/insights?fields=${fields},ad_id,ad_name&date_preset=${preset}&level=ad&time_increment=1&filtering=[{"field":"campaign.id","operator":"IN","value":${filter}}]&limit=500&access_token=${fbToken}`
    );
    const adData = await adRes.json();
    if (adData.error) throw new Error(adData.error.message);

    const adRows = (adData.data || []).map(d => ({
      date: d.date_start, platform: 'facebook',
      campaign_id: d.campaign_id, campaign_name: d.campaign_name,
      ad_id: d.ad_id, ad_name: d.ad_name,
      spend: parseFloat(d.spend || 0),
      impressions: parseInt(d.impressions || 0),
      reach: parseInt(d.reach || 0),
      clicks: parseInt(d.clicks || 0),
      leads: getAction(d.actions, 'lead'),
      cpm: parseFloat(d.cpm || 0),
      ctr: parseFloat(d.ctr || 0),
      cpc: parseFloat(d.cpc || 0),
      cost_per_lead: getAction(d.actions, 'lead') > 0 ? parseFloat(d.spend) / getAction(d.actions, 'lead') : null,
      frequency: parseFloat(d.frequency || 0),
    }));

    await supabaseUpsert('ad_snapshots', adRows, 'date,platform,ad_id');
    results.facebook = { campaigns: campRows.length, ads: adRows.length };

  } catch(e) {
    results.facebook = { error: e.message };
  }

  // ── TIKTOK BACKFILL ──────────────────────────────────────────────────────
  try {
    const endDateObj   = new Date();
    const startDateObj = new Date(Date.now() - days * 86400000);
    const allRows = [];

    // Split into 30-day chunks
    let chunkEnd = new Date(endDateObj);
    while (chunkEnd > startDateObj) {
      const chunkStart = new Date(chunkEnd);
      chunkStart.setDate(chunkStart.getDate() - 29);
      if (chunkStart < startDateObj) chunkStart.setTime(startDateObj.getTime());

      const startDate = chunkStart.toISOString().slice(0, 10);
      const endDate   = chunkEnd.toISOString().slice(0, 10);

      const queryParams = [
        `advertiser_id=${ttAdvertiser}`,
        `report_type=BASIC`,
        `data_level=AUCTION_CAMPAIGN`,
        `dimensions=${encodeURIComponent(JSON.stringify(['campaign_id', 'stat_time_day']))}`,
        // Use on_site_form for lead form submissions specifically
        `metrics=${encodeURIComponent(JSON.stringify(['campaign_name','spend','impressions','reach','clicks','ctr','cpc','cpm','frequency','total_registration','cost_per_total_registration']))}`,
        `start_date=${startDate}`,
        `end_date=${endDate}`,
        `page_size=1000`,
      ].join('&');

      const insRes = await fetch(`${TT_BASE}/report/integrated/get/?${queryParams}`, {
        method: 'GET',
        headers: { 'Access-Token': ttToken, 'Content-Type': 'application/json' },
      });

      const insData = JSON.parse(await insRes.text());
      if (insData.code !== 0) throw new Error(`TikTok code ${insData.code}: ${insData.message}`);

      const chunkRows = (insData.data?.list || []).map(r => ({
        date:          r.dimensions?.stat_time_day?.slice(0, 10) || endDate,
        platform:      'tiktok',
        campaign_id:   String(r.dimensions?.campaign_id || ''),
        campaign_name: r.metrics?.campaign_name || '',
        spend:         parseFloat(r.metrics?.spend || 0) * USD_TO_SEK,
        impressions:   parseInt(r.metrics?.impressions || 0),
        reach:         parseInt(r.metrics?.reach || 0),
        clicks:        parseInt(r.metrics?.clicks || 0),
        leads:         parseInt(r.metrics?.total_registration || 0),
        cpm:           parseFloat(r.metrics?.cpm || 0) * USD_TO_SEK,
        ctr:           parseFloat(r.metrics?.ctr || 0),
        cpc:           parseFloat(r.metrics?.cpc || 0) * USD_TO_SEK,
        cost_per_lead: parseFloat(r.metrics?.cost_per_total_registration || 0) ? parseFloat(r.metrics?.cost_per_total_registration) * USD_TO_SEK : null,
        frequency:     parseFloat(r.metrics?.frequency || 0),
      })).filter(r => r.spend > 0);

      allRows.push(...chunkRows);
      chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() - 1);
    }

    if (allRows.length) await supabaseUpsert('campaign_snapshots', allRows, 'date,platform,campaign_id');
    results.tiktok = { campaigns: allRows.length };

  } catch(e) {
    results.tiktok = { error: e.message };
  }

  return res.status(200).json({ ok: true, days, results });
};
