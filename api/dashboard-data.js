module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const days         = parseInt(req.query.days || '30');
  const startDate    = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // Also fetch last 90 days for projection model regardless of selected period
  const date90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const date60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const date30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const [campsRes, camps90Res, adsRes, funnelRes] = await Promise.all([
      // Current period for display
      fetch(`${SUPABASE_URL}/rest/v1/campaign_snapshots?date=gte.${startDate}&select=*`, { headers }),
      // Last 90 days for projection model
      fetch(`${SUPABASE_URL}/rest/v1/campaign_snapshots?date=gte.${date90}&select=date,platform,leads,spend`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/ad_snapshots?date=gte.${startDate}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/hubspot_funnel?select=*&order=date.desc&limit=1`, { headers }),
    ]);

    const [camps, camps90, ads, funnelArr] = await Promise.all([
      campsRes.json(), camps90Res.json(), adsRes.json(), funnelRes.json(),
    ]);

    if (camps.error)  throw new Error(camps.error.message);
    if (ads.error)    throw new Error(ads.error.message);

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

    // ── PROJECTION MODEL ──────────────────────────────────────────────────
    // Calculate leads per 30-day window from Supabase historical data
    // Window A: 61-90 days ago (their 61-90d conversion tail still ahead)
    // Window B: 31-60 days ago (their 31-60d and 61-90d tail still ahead)
    // Window C: 0-30 days ago (their full tail still ahead)

    let leadsWindowA = 0; // 61-90d ago
    let leadsWindowB = 0; // 31-60d ago
    let leadsWindowC = 0; // 0-30d ago
    let spendWindowC = 0; // spend last 30d for projection

    for (const row of camps90 || []) {
      const d = row.date;
      const leads = parseInt(row.leads || 0);
      const spend = parseFloat(row.spend || 0);
      if (d >= date90 && d < date60) leadsWindowA += leads;
      else if (d >= date60 && d < date30) leadsWindowB += leads;
      else if (d >= date30) { leadsWindowC += leads; spendWindowC += spend; }
    }

    // Project monthly spend based on last 30 days
    const projMonthlySpend = spendWindowC > 0 ? spendWindowC : Object.values(byPlatform).reduce((s,p)=>s+(p.spend||0),0);
    const cpl = leadsWindowC > 0 ? spendWindowC / leadsWindowC : 40;
    const projLeadsPerMonth = projMonthlySpend / cpl;

    // Conversion rates by window (from HubSpot historical data)
    const CONV = [0.00622, 0.00129, 0.00150]; // 0-30d, 31-60d, 61-90d

    // Month +1 (next 30 days):
    //   - Window C leads (0-30d old) converting at 31-60d rate
    //   - Window B leads (31-60d old) converting at 61-90d rate
    //   - New leads generated next month converting at 0-30d rate
    const month1_existing = (leadsWindowC * CONV[1]) + (leadsWindowB * CONV[2]);
    const month1_new      = projLeadsPerMonth * CONV[0];
    const month1_total    = month1_existing + month1_new;
    const month1_cac      = month1_total > 0 ? Math.round(projMonthlySpend / month1_total) : null;

    // Month +2:
    //   - Window C leads now 61-90d old → converting at 61-90d rate
    //   - Month +1 new leads now 31-60d old → converting at 31-60d rate
    //   - New leads generated in month +2 → 0-30d rate
    const month2_existing = (leadsWindowC * CONV[2]) + (projLeadsPerMonth * CONV[1]);
    const month2_new      = projLeadsPerMonth * CONV[0];
    const month2_total    = month2_existing + month2_new;
    const month2_cac      = month2_total > 0 ? Math.round(projMonthlySpend / month2_total) : null;

    // Month +3:
    //   - Month +1 new leads now 61-90d old → CONV[2]
    //   - Month +2 new leads now 31-60d old → CONV[1]
    //   - New leads generated in month +3 → CONV[0]
    const month3_existing = (projLeadsPerMonth * CONV[2]) + (projLeadsPerMonth * CONV[1]);
    const month3_new      = projLeadsPerMonth * CONV[0];
    const month3_total    = month3_existing + month3_new;
    const month3_cac      = month3_total > 0 ? Math.round(projMonthlySpend / month3_total) : null;

    const projection = {
      leads_window_a: leadsWindowA,
      leads_window_b: leadsWindowB,
      leads_window_c: leadsWindowC,
      proj_monthly_spend: projMonthlySpend,
      proj_leads_per_month: Math.round(projLeadsPerMonth),
      months: [
        { label: 'Månad +1', cac: month1_cac, existing: month1_existing, new_leads: month1_new, total: month1_total },
        { label: 'Månad +2', cac: month2_cac, existing: month2_existing, new_leads: month2_new, total: month2_total },
        { label: 'Månad +3', cac: month3_cac, existing: month3_existing, new_leads: month3_new, total: month3_total },
      ],
    };

    // Period-specific KollaROM and customers
    let kollarom, customers;
    if (days <= 7)       { kollarom = funnel?.kollarom_30d||0;  customers = funnel?.customers_30d||0; }
    else if (days <= 30) { kollarom = funnel?.kollarom_30d||0;  customers = funnel?.customers_30d||0; }
    else if (days <= 60) { kollarom = funnel?.kollarom_60d||0;  customers = funnel?.customers_60d||0; }
    else                 { kollarom = funnel?.kollarom_90d||0;  customers = funnel?.customers_90d||0; }

    // Aggregate ads
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
