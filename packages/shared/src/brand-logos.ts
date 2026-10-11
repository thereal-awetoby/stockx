/**
 * Company logos for the stock behind a token. They come from the company, not from a chain or an
 * issuer, so they carry no chain watermark and stay valid when stockX adds other chains.
 * Only tickers listed here get one; everything else falls back to the token icon or a letter.
 */
export const BRAND_LOGO_BASE = "https://cdn.simpleicons.org";

const SLUGS: Record<string, string> = {
  AAPL: "apple", ADBE: "adobe", AMD: "amd", AMZN: "amazon", ARM: "arm", ASML: "asml", AVGO: "broadcom",
  COIN: "coinbase", CRM: "salesforce", CRWD: "crowdstrike", DELL: "dell", GME: "gamestop", GOOGL: "google",
  HOOD: "robinhood", IBM: "ibm", INTC: "intel", META: "meta", MSTR: "microstrategy", NFLX: "netflix",
  NVDA: "nvidia", ORCL: "oracle", PLTR: "palantir", PYPL: "paypal", QCOM: "qualcomm", RDDT: "reddit",
  TSLA: "tesla", ZM: "zoom",
};

export function brandLogoUrl(ticker: string): string | null {
  const slug = SLUGS[ticker.trim().toUpperCase()];
  return slug ? `${BRAND_LOGO_BASE}/${slug}` : null;
}
