import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parseSitemapXml,
  filterDiscoveredUrls,
  prioritizeChildSitemaps,
} from './sitemap.js';

describe('Sitemap Parsing and Discovery Engine', () => {
  test('parses a standard public XML sitemap with XML namespaces', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.pluspowersupplements.com/100-whey-protein-2kg</loc>
    <lastmod>2026-03-01T12:00:00+00:00</lastmod>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>https://www.pluspowersupplements.com/creatine-creapure-500g</loc>
    <lastmod>2026-03-02T12:00:00+00:00</lastmod>
  </url>
  <url>
    <loc>https://www.pluspowersupplements.com/chi-siamo</loc>
  </url>
  <url>
    <loc>https://www.pluspowersupplements.com/blog/i-migliori-integratori</loc>
  </url>
</urlset>`;

    const result = parseSitemapXml(xml);
    assert.strictEqual(result.isXml, true);
    assert.strictEqual(result.isIndex, false);
    assert.strictEqual(result.childSitemaps.length, 0);
    assert.strictEqual(result.rawUrls.length, 4);
    assert.ok(result.rawUrls.includes('https://www.pluspowersupplements.com/100-whey-protein-2kg'));
  });

  test('parses a sitemap index containing multiple child sitemaps', () => {
    const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://www.pluspowersupplements.com/sitemap-categories.xml</loc>
    <lastmod>2026-03-01</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.pluspowersupplements.com/sitemap-products-1.xml</loc>
    <lastmod>2026-03-02</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.pluspowersupplements.com/sitemap-products-2.xml</loc>
    <lastmod>2026-03-03</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.pluspowersupplements.com/sitemap-blog.xml</loc>
    <lastmod>2026-03-04</lastmod>
  </sitemap>
</sitemapindex>`;

    const result = parseSitemapXml(indexXml);
    assert.strictEqual(result.isXml, true);
    assert.strictEqual(result.isIndex, true);
    assert.strictEqual(result.childSitemaps.length, 4);
    assert.ok(result.childSitemaps.includes('https://www.pluspowersupplements.com/sitemap-products-1.xml'));
  });

  test('prioritizes product child sitemaps over blog and other child sitemaps', () => {
    const sitemaps = [
      'https://www.pluspowersupplements.com/sitemap-blog.xml',
      'https://www.pluspowersupplements.com/sitemap-static.xml',
      'https://www.pluspowersupplements.com/sitemap-products.xml',
      'https://www.pluspowersupplements.com/sitemap-categories.xml',
    ];

    const prioritized = prioritizeChildSitemaps(sitemaps);
    assert.strictEqual(prioritized[0], 'https://www.pluspowersupplements.com/sitemap-products.xml');
  });

  test('filters out blog URLs, articles, static pages, and media files', () => {
    const testUrls = [
      'https://www.pluspowersupplements.com/100-whey-protein-2kg',
      'https://www.pluspowersupplements.com/bcaa-powder-300g',
      'https://www.pluspowersupplements.com/blog/consigli-allenamento',
      'https://www.pluspowersupplements.com/articoli/guida-alla-creatina',
      'https://www.pluspowersupplements.com/chi-siamo',
      'https://www.pluspowersupplements.com/contatti',
      'https://www.pluspowersupplements.com/privacy',
      'https://www.pluspowersupplements.com/cart',
      'https://www.pluspowersupplements.com/checkout',
      'https://www.pluspowersupplements.com/assets/banner.jpg',
      'https://www.pluspowersupplements.com/catalogo.pdf',
      'https://www.pluspowersupplements.com/proteine', // Category
      'https://www.pluspowersupplements.com/creatina', // Category
    ];

    const filtered = filterDiscoveredUrls(testUrls);

    // Products must include real products and exclude blog, static, and assets
    assert.strictEqual(filtered.products.length, 2);
    assert.ok(filtered.products.includes('https://www.pluspowersupplements.com/100-whey-protein-2kg'));
    assert.ok(filtered.products.includes('https://www.pluspowersupplements.com/bcaa-powder-300g'));

    // Must NOT contain blog, static pages, or images
    assert.ok(!filtered.products.includes('https://www.pluspowersupplements.com/blog/consigli-allenamento'));
    assert.ok(!filtered.products.includes('https://www.pluspowersupplements.com/chi-siamo'));
    assert.ok(!filtered.products.includes('https://www.pluspowersupplements.com/assets/banner.jpg'));

    // Categories must include known categories
    assert.ok(filtered.categories.includes('https://www.pluspowersupplements.com/proteine'));
    assert.ok(filtered.categories.includes('https://www.pluspowersupplements.com/creatina'));
  });

  test('identifies non-XML / HTML error documents accurately', () => {
    const htmlResponse = `<!DOCTYPE html>
<html>
<head><title>404 Not Found</title></head>
<body><h1>Page Not Found</h1></body>
</html>`;

    const result = parseSitemapXml(htmlResponse);
    assert.strictEqual(result.isXml, false);
    assert.strictEqual(result.rawUrls.length, 0);
  });
});
