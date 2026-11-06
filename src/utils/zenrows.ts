/**
 * ZenRows Centralized REST API Fetching Provider
 * Official API: https://api.zenrows.com/v1/
 *
 * Provides centralized, supplier-independent HTML extraction using ZenRows.
 * Reads API key securely from backend environment variable ZENROWS_API_KEY.
 * Never exposes the API key to the frontend client.
 */

export interface ZenRowsFetchOptions {
  jsRender?: boolean;
  waitMs?: number;
  premiumProxy?: boolean;
}

export interface ZenRowsFetchResult {
  ok: boolean;
  status: number;
  html?: string;
  headers?: Record<string, string>;
  error?: string;
  statusCode?: number;
}

/**
 * Returns the ZenRows API key securely on the server side.
 */
export function getZenRowsApiKey(): string {
  return (process.env.ZENROWS_API_KEY || '').trim();
}

/**
 * Checks whether ZenRows is configured with a valid API key.
 */
export function isZenRowsConfigured(): boolean {
  const key = getZenRowsApiKey();
  return Boolean(key && key.length > 5);
}

/**
 * Fetches HTML using the official ZenRows REST API.
 * Uses js_render=false by default to prevent unnecessary credit consumption.
 */
export async function fetchWithZenRows(
  targetUrl: string,
  options: ZenRowsFetchOptions = {}
): Promise<ZenRowsFetchResult> {
  const apiKey = getZenRowsApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: 401,
      error: 'ZENROWS_API_KEY environment variable is not configured on the server.',
    };
  }

  try {
    const params = new URLSearchParams();
    params.set('apikey', apiKey);
    params.set('url', targetUrl);

    // Only enable JS rendering when explicitly requested to conserve credits (Requirement 9)
    if (options.jsRender) {
      params.set('js_render', 'true');
    }

    if (options.premiumProxy) {
      params.set('premium_proxy', 'true');
    }

    if (options.waitMs && options.waitMs > 0) {
      params.set('wait', String(options.waitMs));
    }

    const endpoint = `https://api.zenrows.com/v1/?${params.toString()}`;

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
    });

    const headersRecord: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headersRecord[key.toLowerCase()] = value;
    });

    const text = await res.text();

    if (!res.ok) {
      let friendlyError = text.substring(0, 300);
      try {
        const parsedJson = JSON.parse(text);
        if (parsedJson.title) {
          friendlyError = parsedJson.title;
        } else if (parsedJson.message) {
          friendlyError = parsedJson.message;
        }
      } catch {
        // use friendlyError string
      }

      return {
        ok: false,
        status: res.status,
        statusCode: res.status,
        error: `ZenRows API error (HTTP ${res.status}): ${friendlyError}`,
        headers: headersRecord,
      };
    }

    return {
      ok: true,
      status: res.status,
      statusCode: res.status,
      html: text,
      headers: headersRecord,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 500,
      statusCode: 500,
      error: `Network failure connecting to ZenRows API: ${err.message || 'Unknown error'}`,
    };
  }
}

/**
 * Tests the ZenRows API connection using a public test URL first.
 */
export async function testZenRowsConnection(
  testUrl: string = 'https://httpbin.org/html'
): Promise<{ ok: boolean; message: string; status: number; sampleTitle?: string }> {
  if (!isZenRowsConfigured()) {
    return {
      ok: false,
      status: 401,
      message: 'ZENROWS_API_KEY is not set. Add ZENROWS_API_KEY in your server environment variables.',
    };
  }

  const result = await fetchWithZenRows(testUrl, { jsRender: false });

  if (result.ok && result.html) {
    const titleMatch = result.html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const sampleTitle = titleMatch ? titleMatch[1].trim() : 'Document retrieved';
    return {
      ok: true,
      status: result.status,
      message: `ZenRows API connection successful! Retrieved ${result.html.length} bytes from ${testUrl}.`,
      sampleTitle,
    };
  }

  return {
    ok: false,
    status: result.status,
    message: result.error || `Failed to fetch test URL via ZenRows (status: ${result.status}).`,
  };
}
