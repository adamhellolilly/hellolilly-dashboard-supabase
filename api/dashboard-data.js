module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const days         = parseInt(req.query.days || '30');
  const startDate    = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const date180 = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const date90  = new Date(Date.now() -  90 * 86400000).toISOString().slice(0, 10);
  const date60  = new Date(Date.now() -  60 * 86400000).toISOString().slice(0, 10);
  const date30  = new Date(Date.now() -  30 * 86400000).toISOString().slice(0, 10);
  const date120 = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const date150 = new Date(Date.now() - 150 * 86400000).toISOString().slice(0, 10);

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const [campsRes, camps180Res, adsRes, funnelRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/campaign_snapshots?date=gte.${startDate}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/campaign_snapshots?date=gte.${date180}&select=date,platform,leads,spend`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/ad_snapshots?date=gte.${startDate}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/hubspot_funnel?select=*&order=date.desc&limit=1`, { headers }),
    ]);

    const [camps, camps180, ads, funnelArr] = await Promise.all([
      campsRes.json(), camps180Res.json(), adsRes.json(), funnelRes.json(),
    ]);

    if (camps.error) throw new Error(camps.error.message);
    if (ads.error)   throw new Error(ads.error.message);

    // Aggregate current period by platform
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

    const funnel = (funnelArr || [])[0] || null;

    // Full conversion rate across 180 days
    const TOTAL_CONV = 0.00622 + 0.00129 + 0.00150 + 0.00107 + 0.00107 + 0.00065;

    // Conversion rates by window
    const CONV = {
      w0: 0.00622, w1: 0.00129, w2: 0.00150,
      w3: 0.00107, w4: 0.00107, w5: 0.00065,
    };
    const CONV_LATE = 0.00129 / 6;

    // Leads AND spend by 30-day window
    let L = { w0:0, w1:0, w2:0, w3:0, w4:0, w5:0 };
    let S = { w0:0, w1:0, w2:0 }; // spend for last 3 months (for lead-attributed CAC)

    for (const row of camps180 || []) {
      const d = row.date;
      const leads = parseInt(row.leads || 0);
      const spend = parseFloat(row.spend || 0);
      if      (d >= date30)  { L.w0 += leads; S.w0 += spend; }
      else if (d >= date60)  { L.w1 += leads; S.w1 += spend; }
      else if (d >= date90)  { L.w2 += leads; S.w2 += spend; }
      else if (d >= date120) { L.w3 += leads; }
      else if (d >= date150) { L.w4 += leads; }
      else                   { L.w5 += leads; }
    }

    // Add TikTok leads from HubSpot for current month only (w0)
    // We only have current month TikTok data reliably
    const ttLeads = funnel?.tiktok_leads_month || 0;
    L.w0 += ttLeads;

    // Lead-attributed CAC per month = spend / (leads × TOTAL_CONV)
    // This varies by month based on actual spend and leads that month
    const leadAttrCAC = [
      { spend: S.w2, leads: L.w2 }, // 61-90d ago (oldest = leftmost bar)
      { spend: S.w1, leads: L.w1 }, // 31-60d ago
      { spend: S.w0, leads: L.w0 }, // 0-30d ago (most recent)
    ].map(m => m.leads > 0 ? Math.round(m.spend / (m.leads * TOTAL_CONV)) : null);

    // Projected monthly spend and leads
    const projMonthlySpend = S.w0 > 0 ? S.w0 : Object.values(byPlatform).reduce((s,p)=>s+(p.spend||0),0);
    const cpl = L.w0 > 0 ? S.w0 / L.w0 : 40;
    const NL  = projMonthlySpend / cpl;

    // Lead-attributed CAC for projected months (based on projected spend/leads)
    const projLeadAttrCAC = [1, 2, 3].map(() =>
      NL > 0 ? Math.round(projMonthlySpend / (NL * TOTAL_CONV)) : null
    );

    // Projection model
    const m1_existing = (L.w0*CONV.w1)+(L.w1*CONV.w2)+(L.w2*CONV.w3)+(L.w3*CONV.w4)+(L.w4*CONV.w5)+(L.w5*CONV_LATE);
    const m1_new = NL*CONV.w0;
    const m1_total = m1_existing+m1_new;
    const m1_cac = m1_total>0 ? Math.round(projMonthlySpend/m1_total) : null;

    const m2_existing = (L.w0*CONV.w2)+(L.w1*CONV.w3)+(L.w2*CONV.w4)+(L.w3*CONV.w5)+(L.w4*CONV_LATE)+(NL*CONV.w1);
    const m2_new = NL*CONV.w0;
    const m2_total = m2_existing+m2_new;
    const m2_cac = m2_total>0 ? Math.round(projMonthlySpend/m2_total) : null;

    const m3_existing = (L.w0*CONV.w3)+(L.w1*CONV.w4)+(L.w2*CONV.w5)+(L.w3*CONV_LATE)+(NL*CONV.w2)+(NL*CONV.w1);
    const m3_new = NL*CONV.w0;
    const m3_total = m3_existing+m3_new;
    const m3_cac = m3_total>0 ? Math.round(projMonthlySpend/m3_total) : null;

    const projection = {
      leads_by_window: L,
      proj_monthly_spend: Math.round(projMonthlySpend),
      proj_leads_per_month: Math.round(NL),
      cpl: Math.round(cpl),
      lead_attr_cac: leadAttrCAC,        // historical, varies per month
      proj_lead_attr_cac: projLeadAttrCAC, // projected, varies if CPL changes
      months: [
        { cac: m1_cac, existing: parseFloat(m1_existing.toFixed(1)), new_leads: parseFloat(m1_new.toFixed(1)), total: parseFloat(m1_total.toFixed(1)) },
        { cac: m2_cac, existing: parseFloat(m2_existing.toFixed(1)), new_leads: parseFloat(m2_new.toFixed(1)), total: parseFloat(m2_total.toFixed(1)) },
        { cac: m3_cac, existing: parseFloat(m3_existing.toFixed(1)), new_leads: parseFloat(m3_new.toFixed(1)), total: parseFloat(m3_total.toFixed(1)) },
      ],
    };

    // Period-specific KollaROM and customers
    let kollarom, customers;
    if (days <= 7)       { kollarom = funnel?.kollarom_30d||0;  customers = funnel?.customers_30d||0; }
    else if (days <= 30) { kollarom = funnel?.kollarom_30d||0;  customers = funnel?.customers_30d||0; }
    else if (days <= 60) { kollarom = funnel?.kollarom_60d||0;  customers = funnel?.customers_60d||0; }
    else                 { kollarom = funnel?.kollarom_90d||0;  customers = funnel?.customers_90d||0; }

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
      funnel,
      kollarom,
      customers,
      projection,
      synced_at: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
