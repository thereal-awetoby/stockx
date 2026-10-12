/**
 * Company logos for the stock behind a token. They come from the company, never from a chain or an
 * issuer, so they carry no Binance (or other chain) watermark and stay valid when stockX adds more chains.
 * The browser only ever asks OUR server (/api/logo?ticker=...); the server fetches and caches the image.
 * A ticker with no known source gets a letter avatar, never another project's icon.
 */
export const BRAND_LOGO_BASE = "https://cdn.simpleicons.org";

/** simpleicons.org slugs: crisp vector logos in the company's own colour. */
export const ICON_SLUGS: Record<string, string> = {
  AAPL: "apple", ADBE: "adobe", AMD: "amd", AMZN: "amazon", ARM: "arm", ASML: "asml", AVGO: "broadcom",
  COIN: "coinbase", CRM: "salesforce", CRWD: "crowdstrike", DELL: "dell", GME: "gamestop", GOOGL: "google",
  HOOD: "robinhood", IBM: "ibm", INTC: "intel", META: "meta", MSTR: "microstrategy", NFLX: "netflix",
  NVDA: "nvidia", ORCL: "oracle", PLTR: "palantir", PYPL: "paypal", QCOM: "qualcomm", RDDT: "reddit",
  TSLA: "tesla", ZM: "zoom",
};

/** Company websites, used to fetch the company's own favicon when there is no simpleicons logo. */
export const LOGO_DOMAINS: Record<string, string> = {
  AAPL: "apple.com", ADBE: "adobe.com", AMAT: "appliedmaterials.com", AMC: "amctheatres.com", AMD: "amd.com",
  AMZN: "amazon.com", ARM: "arm.com", ASML: "asml.com", ASTS: "ast-science.com", AVGO: "broadcom.com",
  BABA: "alibaba.com", BE: "bloomenergy.com", COIN: "coinbase.com", CRDO: "credosemi.com", CRM: "salesforce.com",
  CRWD: "crowdstrike.com", CRWV: "coreweave.com", DELL: "dell.com", DJT: "tmtgcorp.com", EWY: "ishares.com",
  FLNC: "fluenceenergy.com", GLW: "corning.com", GME: "gamestop.com", GOOGL: "google.com", GS: "goldmansachs.com",
  HIMS: "hims.com", HOOD: "robinhood.com", IBM: "ibm.com", INTC: "intel.com", JPM: "jpmorganchase.com",
  LITE: "lumentum.com", LLY: "lilly.com", META: "meta.com", MRVL: "marvell.com", MSFT: "microsoft.com",
  MSTR: "strategy.com", MU: "micron.com", NBIS: "nebius.com", NFLX: "netflix.com", NVDA: "nvidia.com",
  ORCL: "oracle.com", PLTR: "palantir.com", PYPL: "paypal.com", QCOM: "qualcomm.com", QQQ: "invesco.com",
  RDDT: "reddit.com", RKLB: "rocketlabusa.com", SECZ: "securitize.io", SKHY: "skhynix.com", SMCI: "supermicro.com",
  SPCX: "spacex.com", SPY: "ssga.com", STX: "seagate.com", TSLA: "tesla.com", TSM: "tsmc.com",
  USAR: "usarareearth.com", WDC: "westerndigital.com", WEN: "wendys.com", ZM: "zoom.us",
};

const norm = (ticker: string) => ticker.trim().toUpperCase();

export const simpleIconUrl = (ticker: string): string | null => {
  const slug = ICON_SLUGS[norm(ticker)];
  return slug ? `${BRAND_LOGO_BASE}/${slug}` : null;
};

export const logoDomain = (ticker: string): string | null => LOGO_DOMAINS[norm(ticker)] ?? null;

/** Same-origin logo URL for a ticker, or null when we have no company source for it (show a letter instead). */
export function brandLogoUrl(ticker: string): string | null {
  const t = norm(ticker);
  return ICON_SLUGS[t] || LOGO_DOMAINS[t] ? `/api/logo?ticker=${encodeURIComponent(t)}` : null;
}
