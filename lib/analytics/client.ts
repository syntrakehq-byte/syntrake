type TrackData = Record<string, unknown>;

export type CampaignData = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  ref?: string;
};

declare global {
  interface Window {
    // Matches the global type injected by Next/third-party analytics.
    // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    dataLayer?: Object[];
    __scCampaign?: CampaignData;
  }
}

const CAMPAIGN_KEY = "sc_campaign";

function readCampaignFromStorage(): CampaignData {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CampaignData;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function getCampaign(): CampaignData {
  if (typeof window === "undefined") return {};
  return window.__scCampaign ?? readCampaignFromStorage();
}

export function getCampaignData(): CampaignData {
  return getCampaign();
}

export function track(event: string, data: TrackData = {}) {
  if (typeof window === "undefined") return;

  const payload = {
    event,
    path: window.location.pathname,
    ts: new Date().toISOString(),
    ...getCampaign(),
    ...data,
  };

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(payload);
}
