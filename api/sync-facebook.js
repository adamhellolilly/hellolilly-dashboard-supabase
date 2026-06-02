// api/sync-facebook.js
// Vercel cron: runs every hour
// Pulls Facebook campaign + ad data → stores in Supabase

import { createClient } from '@supabase/supabase-js';

const FB_BASE   = 'https://graph.facebook.com/v18.0';
const ROM_CAMPS = ['120232042406430116', '120242593005960116'];

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Allow manual trigger or cron
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const token   = process.env.FB_ACCESS_TOKEN;
  const account = process.env.FB_AD_ACCOUNT_ID;
  const today   = new Date().toISOString().slice(0, 10);

  try {
    const fields = [
      'campaign_id','campaign_name','spend','impressions','reach',
      'frequency','cpm','clicks','ctr','cpc',
      'actions:lead','cost_per_action_type'
    ].join(',');

    // ── CAMPAIGN LEVEL ──────────────────────────────────────────────────────
    const campRes = await fetch(
      `${FB_BASE}/${account}/insights?fields=${fields}&date_preset=today&level=campaign&filtering=[{"field":"campaign.id","operator":"IN","values":${JSON.stringify(ROM_CAMPS)}}]&limit=100&access_token=${token}`
    );
    const campData = await campRes.json();
    if (campData.error) throw new Error('FB campaigns: ' + campData.error.message);

    const campRows = (campData.data || []).map(d => ({
      date:          today,
      platform:      'facebook',
      campaign_id:   d.campaign_id,
      campaign_name: d.campaign_name,
      spend:         parseFloat(d.spend || 0),
      impressions:   parseInt(d.impressions || 0),
      reach:         parseInt(d.reach || 0),
      clicks:        parseInt(d.clicks || 0),
      leads:         getAction(d.actions, 'lead'),
      cpm:           parseFloat(d.cpm || 0),
      ctr:           parseFloat(d.ctr || 0),
      cpc:           parseFloat(d.cpc || 0),
      cost_per_lead: getCPA(d.cost_per_action_type, 'lead'),
      frequency:     parseFloat(d.frequency || 0),
    }));

    if (campRows.length) {
      const { error: ce } = await supabase
        .from('campaign_snapshots')
        .upsert(campRows, { onConflict: 'date,platform,campaign_id' });
      if (ce) throw new Error('Supabase campaign upsert: ' + ce.message);
    }

    // ── AD LEVEL ────────────────────────────────────────────────────────────
    const adRes = await fetch(
      `${FB_BASE}/${account}/insights?fields=${fields},ad_id,ad_name&date_preset=today&level=ad&filtering=[{"field":"campaign.id","operator":"IN","values":${JSON.stringify(ROM_CAMPS)}}]&limit=200&access_token=${token}`
    );
    const adData = await adRes.json();
    if (adData.error) throw new Error('FB ads: ' + adData.error.message);

    const adRows = (adData.data || []).map(d => ({
      date:          today,
      platform:      'facebook',
      campaign_id:   d.campaign_id,
      campaign_name: d.campaign_name,
      ad_id:         d.ad_id,
      ad_name:       d.ad_name,
      spend:         parseFloat(d.spend || 0),
      impressions:   parseInt(d.impressions || 0),
      reach:         parseInt(d.reach || 0),
      clicks:        parseInt(d.clicks || 0),
      leads:         getAction(d.actions, 'lead'),
      cpm:           parseFloat(d.cpm || 0),
      ctr:           parseFloat(d.ctr || 0),
      cpc:           parseFloat(d.cpc || 0),
      cost_per_lead: getCPA(d.cost_per_action_type, 'lead'),
      frequency:     parseFloat(d.frequency || 0),
    }));

    if (adRows.length) {
      const { error: ae } = await supabase
        .from('ad_snapshots')
        .upsert(adRows, { onConflict: 'date,platform,ad_id' });
      if (ae) throw new Error('Supabase ad upsert: ' + ae.message);
    }

    return res.status(200).json({
      ok: true,
      date: today,
      campaigns_synced: campRows.length,
      ads_synced: adRows.length,
    });

  } catch (err) {
    console.error('sync-facebook error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function getAction(actions, type) {
  if (!actions) return 0;
  const a = actions.find(x => x.action_type === type);
  return a ? parseInt(a.value) : 0;
}
function getCPA(cpa, type) {
  if (!cpa) return null;
  const a = cpa.find(x => x.action_type === type);
  return a ? parseFloat(a.value) : null;
}
