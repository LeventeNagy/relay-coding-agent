/**
 * Web search backend for the `web_search` native tool. Pluggable and
 * provider-agnostic: uses Tavily or Brave when their API key is configured
 * (injected into process.env by settingsStore.applyKeysToEnv), otherwise falls
 * back to a keyless DuckDuckGo HTML scrape so search works out of the box.
 *
 * Runs in the main process (Node global fetch). Keys never leave main.
 */

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  /** Extracted page content, when the provider returns it (Tavily). */
  content?: string;
}

export interface WebSearchResponse {
  results: WebResult[];
  /** A provider-synthesized draft answer, when available (Tavily). */
  answer?: string;
  /** Which backend served this query, for logging/diagnostics. */
  provider: "tavily" | "brave" | "duckduckgo";
  error?: string;
}

export type SearchDepth = "basic" | "advanced";

const TIMEOUT_MS = 20_000;
/** Cap extracted content so a huge page can't blow the model's context window. */
const MAX_CONTENT_CHARS = 8_000;
/** A realistic UA so DuckDuckGo's HTML endpoint doesn't reject the request. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const clampContent = (text: string): string =>
  text.length > MAX_CONTENT_CHARS ? text.slice(0, MAX_CONTENT_CHARS) : text;

/** Tavily: AI-search-grade results with extracted content + a draft answer. */
const searchTavily = async (
  query: string,
  apiKey: string,
  depth: SearchDepth,
  maxResults: number
): Promise<WebSearchResponse> => {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: depth,
      include_answer: true,
      include_raw_content: depth === "advanced",
      max_results: maxResults
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Tavily ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string }>;
  };
  const results: WebResult[] = (data.results ?? []).map((r) => ({
    title: r.title ?? r.url ?? "Untitled",
    url: r.url ?? "",
    snippet: r.content ?? "",
    content: r.raw_content ? clampContent(r.raw_content) : undefined
  }));
  return { results, answer: data.answer, provider: "tavily" };
};

/** Brave Search API: solid general web results (title/url/description). */
const searchBrave = async (
  query: string,
  apiKey: string,
  maxResults: number
): Promise<WebSearchResponse> => {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Brave ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const results: WebResult[] = (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? r.url ?? "Untitled",
    url: r.url ?? "",
    snippet: r.description ?? ""
  }));
  return { results, provider: "brave" };
};

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]*>/g, "")).trim();

/**
 * Keyless DuckDuckGo: scrape the no-JS HTML endpoint and parse result rows.
 * DDG wraps target URLs in a redirect (`/l/?uddg=<encoded>`); unwrap those.
 * Links only — the agent reads full content via the fetch_url tool.
 */
const searchDuckDuckGo = async (
  query: string,
  maxResults: number
): Promise<WebSearchResponse> => {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo ${response.status}`);
  }
  const html = await response.text();
  const results: WebResult[] = [];
  // Each result anchor: <a class="result__a" href="...">title</a>
  const anchor = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  // Snippets: <a class="result__snippet" ...>snippet</a>
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => stripTags(m[1])
  );
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = anchor.exec(html)) !== null && results.length < maxResults) {
    let href = decodeEntities(match[1]);
    // Unwrap DDG's redirect: /l/?uddg=<urlencoded>&...
    const redirect = href.match(/[?&]uddg=([^&]+)/);
    if (redirect) {
      href = decodeURIComponent(redirect[1]);
    } else if (href.startsWith("//")) {
      href = `https:${href}`;
    }
    const title = stripTags(match[2]);
    if (href.startsWith("http") && title) {
      results.push({ title, url: href, snippet: snippets[i] ?? "" });
    }
    i += 1;
  }
  return { results, provider: "duckduckgo" };
};

/**
 * Run a web search through the best available backend. Never throws — on
 * failure it returns an empty result set with an `error` string the tool can
 * surface to the model (which can then retry or answer from its own knowledge).
 */
export const searchWeb = async (
  query: string,
  opts: { depth?: SearchDepth; maxResults?: number } = {}
): Promise<WebSearchResponse> => {
  const depth = opts.depth ?? "basic";
  const maxResults = opts.maxResults ?? (depth === "advanced" ? 8 : 5);
  const tavily = process.env.TAVILY_API_KEY?.trim();
  const brave = process.env.BRAVE_API_KEY?.trim();
  const provider = tavily ? "tavily" : brave ? "brave" : "duckduckgo";
  console.log(`[relay] web_search provider=${provider} depth=${depth} q=${query}`);
  try {
    if (tavily) {
      return await searchTavily(query, tavily, depth, maxResults);
    }
    if (brave) {
      return await searchBrave(query, brave, maxResults);
    }
    return await searchDuckDuckGo(query, maxResults);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[relay] web_search failed (${provider}):`, message);
    return { results: [], provider, error: message };
  }
};
