const FB_BASE   = 'https://graph.facebook.com/v18.0';
const ROM_CAMPS = ['120232042406430116', '120242593005960116'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const token        = process.env.FB_ACCESS_TOKEN;
  const account      = process.env.FB_AD_ACCOUNT_ID;
  const today        = new Date().toISOString().slice(0, 10);

  if (!token || !account) return res.status(500).json({ ok: false, error: 'Missing FB credentials' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ ok: false, error: 'Missing Supabase credentials' });

  async function supabaseUpsert(table, rows, onConflict) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': `resolution=merge-duplicates,return=minimal`,
      },
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      const e = await r.text();
      throw new Error(`Supabase ${table}: ${e}`);
    }
  }


  function getAction(actions, type) {
    if (!actions) return 0;
    const a = actions.find(x => x.action_type === type);
    return a ? parseInt(a.value) : 0;
  }

  try {
    const fields = 'campaign_id,campaign_name,spend,impressions,reach,frequency,cpm,clicks,ctr,cpc,actions';
    const filter = JSON.stringify(ROM_CAMPS);

    // Campaign level
    const campRes = await fetch(
      `${FB_BASE}/${account}/insights?fields=${fields}&date_preset=today&level=campaign&filtering=[{"field":"campaign.id","operator":"IN","value":${filter}}]&limit=100&access_token=${token}`
    );
    const campData = await campRes.json();
    if (campData.error) throw new Error('FB: ' + campData.error.message);

    const campRows = (campData.data || []).map(d => ({
      date: today, platform: 'facebook',
      campaign_id: d.campaign_id, campaign_name: d.campaign_name,
      spend: parseFloat(d.spend || 0), impressions: parseInt(d.impressions || 0),
      reach: parseInt(d.reach || 0), clicks: parseInt(d.clicks || 0),
      leads: getAction(d.actions, 'lead'),
      cpm: parseFloat(d.cpm || 0), ctr: parseFloat(d.ctr || 0),
      cpc: parseFloat(d.cpc || 0), cost_per_lead: null,
      frequency: parseFloat(d.frequency || 0),
    }));

    if (campRows.length) await supabaseUpsert('campaign_snapshots', campRows, 'date,platform,campaign_id');

    // Ad level
    const adRes = await fetch(
      `${FB_BASE}/${account}/insights?fields=${fields},ad_id,ad_name&date_preset=today&level=ad&filtering=[{"field":"campaign.id","operator":"IN","value":${filter}}]&limit=200&access_token=${token}`
    );
    const adData = await adRes.json();
    if (adData.error) throw new Error('FB ads: ' + adData.error.message);

    const adRows = (adData.data || []).map(d => ({
      date: today, platform: 'facebook',
      campaign_id: d.campaign_id, campaign_name: d.campaign_name,
      ad_id: d.ad_id, ad_name: d.ad_name,
      spend: parseFloat(d.spend || 0), impressions: parseInt(d.impressions || 0),
      reach: parseInt(d.reach || 0), clicks: parseInt(d.clicks || 0),
      leads: getAction(d.actions, 'lead'),
      cpm: parseFloat(d.cpm || 0), ctr: parseFloat(d.ctr || 0),
      cpc: parseFloat(d.cpc || 0), cost_per_lead: null,
      frequency: parseFloat(d.frequency || 0),
    }));

    if (adRows.length) await supabaseUpsert('ad_snapshots', adRows, 'date,platform,ad_id');

    return res.status(200).json({ ok: true, date: today, campaigns_synced: campRows.length, ads_synced: adRows.length });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
