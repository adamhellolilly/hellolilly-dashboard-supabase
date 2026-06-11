const HS_BASE = 'https://api.hubapi.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const hsToken      = process.env.HUBSPOT_ACCESS_TOKEN;

  if (!hsToken) return res.status(500).json({ ok: false, error: 'Missing HUBSPOT_ACCESS_TOKEN' });

  const today   = new Date().toISOString().slice(0, 10);
  const msTs    = new Date(today.slice(0, 8) + '01').getTime();
  const headers = { 'Authorization': `Bearer ${hsToken}`, 'Content-Type': 'application/json' };

  async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function count(filterGroups) {
    await sleep(800);
    const r = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST', headers,
      body: JSON.stringify({ filterGroups, limit: 1, properties: ['hs_object_id'] }),
    });
    const d = await r.json();
    if (d.status === 'error') throw new Error('HubSpot: ' + d.message);
    return d.total || 0;
  }

  try {
    // 1. Facebook new campaign KollaROM
    const newKolla = await count([{filters:[
      {operator:'EQ',propertyName:'lifecyclestage',value:'736277986'},
      {operator:'EQ',propertyName:'hs_latest_source_data_2',value:'huvudkampanjapi'}
    ]}]);

    // 2. Facebook new campaign customers
    const newCust = await count([{filters:[
      {operator:'EQ',propertyName:'lifecyclestage',value:'customer'},
      {operator:'EQ',propertyName:'hs_latest_source_data_2',value:'huvudkampanjapi'}
    ]}]);

    // 3. Facebook old campaign KollaROM
    const oldKolla = await count([{filters:[
      {operator:'EQ',propertyName:'lifecyclestage',value:'736277986'},
      {operator:'CONTAINS_TOKEN',propertyName:'hs_analytics_first_url',value:'120232042406430116'}
    ]}]);

    // 4. Facebook old campaign customers
    const oldCust = await count([{filters:[
      {operator:'EQ',propertyName:'lifecyclestage',value:'customer'},
      {operator:'CONTAINS_TOKEN',propertyName:'hs_analytics_first_url',value:'120232042406430116'}
    ]}]);

    // 5. Superheta leads this month
    const superheta = await count([{filters:[
      {operator:'GTE',propertyName:'recent_conversion_date',value:String(msTs)},
      {operator:'EQ',propertyName:'ar_du_inskriven_pa_arbetsformedlingen_',value:'Ja'},
      {operator:'EQ',propertyName:'vill_du_att_vi_ringer_till_dig_',value:'Ja'},
      {operator:'NOT_IN',propertyName:'fodelsear',values:['2024','2023','2022','2021','2019','2020','2018','2017','2016','2015','2014','2013','2012','2011','2010','2009','2008','2007','1959','1960']},
      {operator:'IN',propertyName:'hur_manga_manader_har_du_varit_inskriven_',values:['5 månader','7 månader','6 månader','9 månader','10 månader','8 månader','Mer än 4 år','Mer än 3 år','Mer än 2 år','Mer än 1 år','12 månader','11 månader']},
    ]}]);

    // 6. TikTok ROM leads this month
    const ttLeadsMonth = await count([{filters:[
      {operator:'GTE',propertyName:'createdate',value:String(msTs)},
      {operator:'CONTAINS_TOKEN',propertyName:'hs_analytics_first_url',value:'Smartcampaign_ROM'},
    ]}]);

    // 7. TikTok ROM KollaROM all time
    const ttKolla = await count([{filters:[
      {operator:'EQ',propertyName:'lifecyclestage',value:'736277986'},
      {operator:'CONTAINS_TOKEN',propertyName:'hs_analytics_first_url',value:'Smartcampaign_ROM'},
    ]}]);

    // 8. TikTok ROM customers all time
    const ttCust = await count([{filters:[
      {operator:'EQ',propertyName:'lifecyclestage',value:'customer'},
      {operator:'CONTAINS_TOKEN',propertyName:'hs_analytics_first_url',value:'Smartcampaign_ROM'},
    ]}]);

    const row = {
      date: today,
      total_leads: 0,
      kollarom_total: newKolla + oldKolla + ttKolla,
      customers_total: newCust + oldCust + ttCust,
      new_camp_kollarom: newKolla,
      new_camp_customers: newCust,
      old_camp_kollarom: oldKolla,
      old_camp_customers: oldCust,
      new_camp_leads: 0,
      old_camp_leads: 0,
      superheta_month: superheta,
      tiktok_leads_month: ttLeadsMonth,
      tiktok_kollarom: ttKolla,
      tiktok_customers: ttCust,
    };

    const r = await fetch(`${SUPABASE_URL}/rest/v1/hubspot_funnel?on_conflict=date`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) { const e = await r.text(); throw new Error('Supabase: ' + e); }

    return res.status(200).json({ ok: true, date: today, data: row });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
