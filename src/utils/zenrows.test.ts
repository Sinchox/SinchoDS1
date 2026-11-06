import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  getZenRowsApiKey,
  isZenRowsConfigured,
  fetchWithZenRows,
  testZenRowsConnection,
} from './zenrows.js';

describe('ZenRows Centralized REST API Provider', () => {
  const originalEnv = process.env.ZENROWS_API_KEY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env.ZENROWS_API_KEY = originalEnv;
    globalThis.fetch = originalFetch;
  });

  test('reports unconfigured when ZENROWS_API_KEY is not set', () => {
    delete process.env.ZENROWS_API_KEY;
    assert.strictEqual(isZenRowsConfigured(), false);
    assert.strictEqual(getZenRowsApiKey(), '');
  });

  test('reports configured when ZENROWS_API_KEY is present', () => {
    process.env.ZENROWS_API_KEY = 'zen_test_secret_key_12345';
    assert.strictEqual(isZenRowsConfigured(), true);
    assert.strictEqual(getZenRowsApiKey(), 'zen_test_secret_key_12345');
  });

  test('fetchWithZenRows returns 401 when unconfigured without calling network', async () => {
    delete process.env.ZENROWS_API_KEY;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('ok');
    }) as any;

    const result = await fetchWithZenRows('https://www.pluspowersupplements.com/test-product');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 401);
    assert.match(result.error || '', /ZENROWS_API_KEY environment variable is not configured/);
    assert.strictEqual(fetchCalled, false, 'Network fetch must not be invoked when key is missing');
  });

  test('fetchWithZenRows conserves credits by defaulting js_render to false', async () => {
    process.env.ZENROWS_API_KEY = 'zen_active_mock_key';

    let requestedEndpoint = '';
    globalThis.fetch = (async (url: string) => {
      requestedEndpoint = String(url);
      return new Response('<html><head><title>Mocked Product</title></head><body><h1>Sample</h1></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }) as any;

    const result = await fetchWithZenRows('https://www.pluspowersupplements.com/creatine-powder');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 200);

    const parsedUrl = new URL(requestedEndpoint);
    assert.strictEqual(parsedUrl.origin, 'https://api.zenrows.com');
    assert.strictEqual(parsedUrl.pathname, '/v1/');
    assert.strictEqual(parsedUrl.searchParams.get('apikey'), 'zen_active_mock_key');
    assert.strictEqual(parsedUrl.searchParams.get('url'), 'https://www.pluspowersupplements.com/creatine-powder');
    // Ensure js_render is NOT present (credit conservation)
    assert.strictEqual(parsedUrl.searchParams.get('js_render'), null);
  });

  test('fetchWithZenRows adds js_render=true only when explicitly requested', async () => {
    process.env.ZENROWS_API_KEY = 'zen_active_mock_key';

    let requestedEndpoint = '';
    globalThis.fetch = (async (url: string) => {
      requestedEndpoint = String(url);
      return new Response('<html><head><title>JS Product</title></head><body></body></html>', {
        status: 200,
      });
    }) as any;

    const result = await fetchWithZenRows('https://www.pluspowersupplements.com/dynamic-product', {
      jsRender: true,
    });
    assert.strictEqual(result.ok, true);

    const parsedUrl = new URL(requestedEndpoint);
    assert.strictEqual(parsedUrl.searchParams.get('js_render'), 'true');
  });

  test('testZenRowsConnection reports guidance when unconfigured', async () => {
    delete process.env.ZENROWS_API_KEY;
    const res = await testZenRowsConnection();
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 401);
    assert.match(res.message, /ZENROWS_API_KEY is not set/);
  });

  test('testZenRowsConnection extracts title on successful connection test', async () => {
    process.env.ZENROWS_API_KEY = 'zen_test_key_sample';
    globalThis.fetch = (async () => {
      return new Response('<html><head><title>HTTPBin HTML Mock Title</title></head><body>Test</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as any;

    const res = await testZenRowsConnection('https://httpbin.org/html');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sampleTitle, 'HTTPBin HTML Mock Title');
    assert.match(res.message, /ZenRows API connection successful/);
  });
});
