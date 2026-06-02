// api/sync-hubspot.js
// Vercel cron: runs daily at midnight
// Pulls HubSpot funnel data → stores in Supabase

import { createClient } from '@supabase/supabase-js';

const HS_BASE = 'https://api.hubapi.com';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const hsToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!hsToken) return res.status(500).json({ ok: false, error: 'Missing HUBSPOT_ACCESS_TOKEN' });

  const today      = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const msTs       = new Date(monthStart).getTime();

  const headers = {
    'Authorization': `Bearer ${hsToken}`,
    'Content-Type':  'application/json',
  };

  async function searchCount(filterGroups) {
    const r = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filterGroups, limit: 1, properties: ['hs_object_id'] }),
    });
    const d = await r.json();
    return d.total || 0;
  }

  try {
    const [
      totalLeads,
      kollaromTotal,
      customersTotal,
      newCampLeads,
      newCampKolla,
      newCampCust,
      oldCampKolla,
      oldCampCust,
      superhetaMonth,
    ] = await Promise.all([
      // Total leads from ROM this month (both campaigns)
      searchCount([{filters:[
        {operator:'GTE',propertyName:'createdate',value:String(msTs)},
        {operator:'IN',propertyName:'hs_latest_source_data_2',values:['huvudkampanjapi','HuvudkampanjAPI']},
      ]}]),
      // Total in KollaROM from ROM campaigns
      searchCount([
        {filters:[{operator:'EQ',propertyName:'lifecyclestage',value:'736277986'},{operator:'EQ',propertyName:'hs_latest_source_data_2',value:'huvudkampanjapi'}]},
      ]),
      // Total customers from ROM campaigns
      searchCount([
        {filters:[{operator:'EQ',propertyName:'lifecyclestage',value:'customer'},{operator:'EQ',propertyName:'hs_latest_source_data_2',value:'huvudkampanjapi'}]},
      ]),
      // New campaign leads this month
      searchCount([{filters:[
        {operator:'GTE',propertyName:'createdate',value:String(msTs)},
        {operator:'EQ',propertyName:'hs_latest_source_data_2',value:'huvudkampanjapi'},
      ]}]),
      // New campaign KollaROM
      searchCount([{filters:[
        {operator:'EQ',propertyName:'lifecyclestage',value:'736277986'},
        {operator:'EQ',propertyName:'hs_latest_source_data_2',value:'huvudkampanjapi'},
      ]}]),
      // New campaign customers
      searchCount([{filters:[
        {operator:'EQ',propertyName:'lifecyclestage',value:'customer'},
        {operator:'EQ',propertyName:'hs_latest_source_data_2',value:'huvudkampanjapi'},
      ]}]),
      // Old campaign KollaROM
      searchCount([{filters:[
        {operator:'EQ',propertyName:'lifecyclestage',value:'736277986'},
        {operator:'CONTAINS_TOKEN',propertyName:'hs_analytics_first_url',value:'120232042406430116'},
      ]}]),
      // Old campaign customers
      searchCount([{filters:[
        {operator:'EQ',propertyName:'lifecyclestage',value:'customer'},
        {operator:'CONTAINS_TOKEN',propertyName:'hs_analytics_first_url',value:'120232042406430116'},
      ]}]),
      // Superheta leads this month
      searchCount([
        {filters:[
          {operator:'GTE',propertyName:'recent_conversion_date',value:String(msTs)},
          {operator:'EQ',propertyName:'ar_du_inskriven_pa_arbetsformedlingen_',value:'Ja'},
          {operator:'EQ',propertyName:'vill_du_att_vi_ringer_till_dig_',value:'Ja'},
          {operator:'NOT_IN',propertyName:'fodelsear',values:['2024','2023','2022','2021','2019','2020','2018','2017','2016','2015','2014','2013','2012','2011','2010','2009','2008','2007','1959','1960']},
          {operator:'IN',propertyName:'hur_manga_manader_har_du_varit_inskriven_',values:['5 månader','7 månader','6 månader','9 månader','10 månader','8 månader','Mer än 4 år','Mer än 3 år','Mer än 2 år','Mer än 1 år','12 månader','11 månader']},
        ]},
      ]),
    ]);

    const row = {
      date:               today,
      total_leads:        totalLeads,
      kollarom_total:     kollaromTotal,
      customers_total:    customersTotal,
      new_camp_leads:     newCampLeads,
      new_camp_kollarom:  newCampKolla,
      new_camp_customers: newCampCust,
      old_camp_leads:     0,
      old_camp_kollarom:  oldCampKolla,
      old_camp_customers: oldCampCust,
      superheta_month:    superhetaMonth,
    };

    const { error } = await supabase
      .from('hubspot_funnel')
      .upsert(row, { onConflict: 'date' });
    if (error) throw new Error('Supabase hubspot upsert: ' + error.message);

    return res.status(200).json({ ok: true, date: today, data: row });

  } catch (err) {
    console.error('sync-hubspot error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
