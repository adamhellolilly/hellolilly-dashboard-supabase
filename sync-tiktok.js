// api/sync-tiktok.js
// Vercel cron: runs every hour
// Pulls TikTok campaign + ad data → stores in Supabase

import { createClient } from '@supabase/supabase-js';

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const token      = process.env.TIKTOK_ACCESS_TOKEN;
  const advertiser = process.env.TIKTOK_ADVERTISER_ID;

  if (!token || !advertiser) {
    return res.status(500).json({ ok: false, error: 'Missing TikTok credentials' });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    // ── CAMPAIGN LEVEL ──────────────────────────────────────────────────────
    const campRes = await fetch(`${TT_BASE}/report/integrated/get/`, {
      method: 'POST',
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        advertiser_id: advertiser,
        report_type:   'BASIC',
        dimensions:    ['campaign_id'],
        metrics: ['campaign_name','spend','impressions','reach','clicks',
                  'ctr','cpc','cpm','frequency','result','cost_per_result'],
        start_date: today,
        end_date:   today,
        page_size: 100,
      }),
    });
    const campData = await campRes.json();
    if (campData.code !== 0) throw new Error('TikTok campaigns: ' + campData.message);

    const campRows = (campData.data?.list || []).map(row => ({
      date:          today,
      platform:      'tiktok',
      campaign_id:   row.dimensions.campaign_id,
      campaign_name: row.metrics.campaign_name,
      spend:         parseFloat(row.metrics.spend || 0),
      impressions:   parseInt(row.metrics.impressions || 0),
      reach:         parseInt(row.metrics.reach || 0),
      clicks:        parseInt(row.metrics.clicks || 0),
      leads:         parseInt(row.metrics.result || 0),
      cpm:           parseFloat(row.metrics.cpm || 0),
      ctr:           parseFloat(row.metrics.ctr || 0),
      cpc:           parseFloat(row.metrics.cpc || 0),
      cost_per_lead: parseFloat(row.metrics.cost_per_result || 0) || null,
      frequency:     parseFloat(row.metrics.frequency || 0),
    })).filter(r => r.spend > 0);

    if (campRows.length) {
      const { error: ce } = await supabase
        .from('campaign_snapshots')
        .upsert(campRows, { onConflict: 'date,platform,campaign_id' });
      if (ce) throw new Error('Supabase TT campaign upsert: ' + ce.message);
    }

    // ── AD LEVEL ────────────────────────────────────────────────────────────
    const adRes = await fetch(`${TT_BASE}/report/integrated/get/`, {
      method: 'POST',
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        advertiser_id: advertiser,
        report_type:   'BASIC',
        dimensions:    ['ad_id'],
        metrics: ['ad_name','campaign_id','campaign_name','spend','impressions',
                  'reach','clicks','ctr','cpc','cpm','frequency','result','cost_per_result'],
        start_date: today,
        end_date:   today,
        page_size: 200,
      }),
    });
    const adData = await adRes.json();
    if (adData.code !== 0) throw new Error('TikTok ads: ' + adData.message);

    const adRows = (adData.data?.list || []).map(row => ({
      date:          today,
      platform:      'tiktok',
      campaign_id:   row.metrics.campaign_id,
      campaign_name: row.metrics.campaign_name,
      ad_id:         row.dimensions.ad_id,
      ad_name:       row.metrics.ad_name,
      spend:         parseFloat(row.metrics.spend || 0),
      impressions:   parseInt(row.metrics.impressions || 0),
      reach:         parseInt(row.metrics.reach || 0),
      clicks:        parseInt(row.metrics.clicks || 0),
      leads:         parseInt(row.metrics.result || 0),
      cpm:           parseFloat(row.metrics.cpm || 0),
      ctr:           parseFloat(row.metrics.ctr || 0),
      cpc:           parseFloat(row.metrics.cpc || 0),
      cost_per_lead: parseFloat(row.metrics.cost_per_result || 0) || null,
      frequency:     parseFloat(row.metrics.frequency || 0),
    })).filter(r => r.spend > 0);

    if (adRows.length) {
      const { error: ae } = await supabase
        .from('ad_snapshots')
        .upsert(adRows, { onConflict: 'date,platform,ad_id' });
      if (ae) throw new Error('Supabase TT ad upsert: ' + ae.message);
    }

    return res.status(200).json({
      ok: true,
      date: today,
      campaigns_synced: campRows.length,
      ads_synced: adRows.length,
    });

  } catch (err) {
    console.error('sync-tiktok error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
