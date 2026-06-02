// api/dashboard-data.js
// Single endpoint the frontend calls to get all dashboard data from Supabase

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { days = '30' } = req.query;
  const numDays   = parseInt(days);
  const startDate = new Date(Date.now() - numDays * 86400000).toISOString().slice(0, 10);

  try {
    const [camps, ads, funnel] = await Promise.all([
      // Campaign totals by platform for date range
      supabase.from('campaign_snapshots')
        .select('*')
        .gte('date', startDate)
        .order('date', { ascending: false }),

      // Ad totals for date range
      supabase.from('ad_snapshots')
        .select('*')
        .gte('date', startDate)
        .order('spend', { ascending: false }),

      // Latest HubSpot funnel snapshot
      supabase.from('hubspot_funnel')
        .select('*')
        .order('date', { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (camps.error) throw new Error(camps.error.message);
    if (ads.error)   throw new Error(ads.error.message);

    // Aggregate campaigns by platform
    const byPlatform = {};
    for (const row of camps.data || []) {
      const k = row.platform;
      if (!byPlatform[k]) byPlatform[k] = { spend:0, impressions:0, reach:0, clicks:0, leads:0 };
      byPlatform[k].spend       += parseFloat(row.spend || 0);
      byPlatform[k].impressions += parseInt(row.impressions || 0);
      byPlatform[k].reach       += parseInt(row.reach || 0);
      byPlatform[k].clicks      += parseInt(row.clicks || 0);
      byPlatform[k].leads       += parseInt(row.leads || 0);
    }

    // Aggregate ads by ad_id across days
    const adMap = {};
    for (const row of ads.data || []) {
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
      cpm:          a.impressions > 0 ? (a.spend / a.impressions * 1000) : null,
      ctr:          a.clicks > 0 && a.impressions > 0 ? (a.clicks / a.impressions * 100) : null,
      cpc:          a.clicks > 0 ? (a.spend / a.clicks) : null,
      cost_per_lead: a.leads > 0 ? (a.spend / a.leads) : null,
    })).sort((a, b) => b.spend - a.spend);

    return res.status(200).json({
      ok: true,
      period_days: numDays,
      start_date:  startDate,
      platforms:   byPlatform,
      ads:         adList,
      funnel:      funnel.data || null,
      synced_at:   new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
