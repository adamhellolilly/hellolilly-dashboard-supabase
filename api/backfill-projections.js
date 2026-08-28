// api/backfill-projections.js
// Backfills cac_projections table with historical monthly snapshots
// Uses campaign_snapshots (spend/leads) + hubspot_funnel (customers) from Supabase

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const TT_CPL     = 20;       // kr per TikTok lead
  const TOTAL_CONV = 0.0118;   // 1.18% historical conversion rate

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };

  try {
    // Fetch all campaign snapshots
    const campsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campaign_snapshots?select=date,platform,leads,spend&order=date.asc&limit=5000`,
      { headers }
    );
    const camps = await campsRes.json();
    if (camps.error) throw new Error(camps.error.message);

    // Fetch hubspot_funnel history for actual customer counts
    const funnelRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hubspot_funnel?select=*&order=date.desc&limit=200`,
      { headers }
    );
    const funnelRows = await funnelRes.json();
    if (funnelRows.error) throw new Error(funnelRows.error.message);

    // Get the latest funnel snapshot for all-time customer counts
    const latestFunnel = funnelRows[0] || {};

    // Group campaign data by month
    const monthlyData = {};
    for (const row of camps || []) {
      const month = row.date.slice(0, 7) + '-01'; // e.g. "2026-03-01"
      if (!monthlyData[month]) {
        monthlyData[month] = { spend: 0, leads: 0, tt_spend: 0, fb_leads: 0 };
      }
      const spend = parseFloat(row.spend || 0);
      const leads = parseInt(row.leads || 0);
      monthlyData[month].spend += spend;
      if (row.platform === 'tiktok') {
        monthlyData[month].tt_spend += spend;
        // Use API leads if > 10, otherwise estimate from spend
        monthlyData[month].leads += leads > 10 ? leads : Math.round(spend / TT_CPL);
      } else {
        monthlyData[month].fb_leads += leads;
        monthlyData[month].leads += leads;
      }
    }

    // For actual customers per month, we use the hubspot_funnel period snapshots
    // We'll use customers_30d/60d/90d deltas to estimate monthly customers
    // For now use latest funnel data - actual customers update over time via sync-hubspot
    const c30 = latestFunnel.customers_30d || 0;
    const c60 = latestFunnel.customers_60d || 0;
    const c90 = latestFunnel.customers_90d || 0;

    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7) + '-01';

    // Estimate monthly customers from deltas
    const custByMonth = {};
    const months = Object.keys(monthlyData).sort();
    
    // Last 3 months we have data for
    const lastMonth  = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const twoMonths  = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
    const threeMonths = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10);

    custByMonth[currentMonth] = c30;
    custByMonth[lastMonth]    = Math.max(0, c60 - c30);
    custByMonth[twoMonths]    = Math.max(0, c90 - c60);

    // Build projection rows
    const projRows = [];
    for (const month of months) {
      const d = monthlyData[month];
      if (d.spend < 100) continue; // skip months with minimal spend

      const projectedCAC = d.leads > 0
        ? Math.round(d.spend / (d.leads * TOTAL_CONV))
        : null;

      const actualCust = custByMonth[month] || null;
      const actualCAC  = (actualCust && actualCust > 0)
        ? Math.round(d.spend / actualCust)
        : null;

      projRows.push({
        month,
        leads:          d.leads,
        spend:          Math.round(d.spend * 100) / 100,
        projected_cac:  projectedCAC,
        actual_customers: actualCust,
        actual_cac:     actualCAC,
      });
    }

    // Upsert all rows
    if (projRows.length) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/cac_projections?on_conflict=month`, {
        method: 'POST',
        headers,
        body: JSON.stringify(projRows),
      });
      if (!r.ok) { const e = await r.text(); throw new Error('Supabase: ' + e); }
    }

    return res.status(200).json({
      ok: true,
      months_backfilled: projRows.length,
      rows: projRows,
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
