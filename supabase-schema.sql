-- ─── CAMPAIGN PERFORMANCE (Facebook + TikTok daily snapshots) ──────────────
create table if not exists campaign_snapshots (
  id              bigserial primary key,
  synced_at       timestamptz default now(),
  date            date not null,
  platform        text not null,          -- 'facebook' | 'tiktok'
  campaign_id     text not null,
  campaign_name   text not null,
  spend           numeric(12,2) default 0,
  impressions     bigint default 0,
  reach           bigint default 0,
  clicks          bigint default 0,
  leads           bigint default 0,
  cpm             numeric(10,2),
  ctr             numeric(8,4),
  cpc             numeric(10,2),
  cost_per_lead   numeric(10,2),
  frequency       numeric(8,2),
  unique(date, platform, campaign_id)
);

-- ─── AD PERFORMANCE (Facebook + TikTok daily snapshots) ───────────────────
create table if not exists ad_snapshots (
  id              bigserial primary key,
  synced_at       timestamptz default now(),
  date            date not null,
  platform        text not null,
  campaign_id     text not null,
  campaign_name   text not null,
  ad_id           text not null,
  ad_name         text not null,
  spend           numeric(12,2) default 0,
  impressions     bigint default 0,
  reach           bigint default 0,
  clicks          bigint default 0,
  leads           bigint default 0,
  cpm             numeric(10,2),
  ctr             numeric(8,4),
  cpc             numeric(10,2),
  cost_per_lead   numeric(10,2),
  frequency       numeric(8,2),
  unique(date, platform, ad_id)
);

-- ─── HUBSPOT FUNNEL (daily snapshots) ─────────────────────────────────────
create table if not exists hubspot_funnel (
  id              bigserial primary key,
  synced_at       timestamptz default now(),
  date            date not null unique,
  total_leads     bigint default 0,
  kollarom_total  bigint default 0,
  customers_total bigint default 0,
  -- new campaign (HuvudkampanjAPI)
  new_camp_leads     bigint default 0,
  new_camp_kollarom  bigint default 0,
  new_camp_customers bigint default 0,
  -- old campaign
  old_camp_leads     bigint default 0,
  old_camp_kollarom  bigint default 0,
  old_camp_customers bigint default 0,
  -- superheta leads this month
  superheta_month    bigint default 0
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────
create index if not exists idx_camp_date_platform on campaign_snapshots(date, platform);
create index if not exists idx_ad_date_platform   on ad_snapshots(date, platform);
create index if not exists idx_funnel_date        on hubspot_funnel(date);
