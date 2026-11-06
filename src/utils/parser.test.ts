import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCloudflareChallenge,
  isValidProductUrl,
  extractJsAssignment,
  parsePrice,
  extractPlusPowerVariants,
  extractProductFromHtml,
  CLOUDFLARE_ERROR_MESSAGE,
} from './parser.js';

test('CLOUDFLARE_ERROR_MESSAGE contains the exact required English text', () => {
  assert.equal(
    CLOUDFLARE_ERROR_MESSAGE,
    'Cloudflare protection detected. Automatic extraction is unavailable for this page. Please use HTML Import to import the product information manually.'
  );
});

test('isCloudflareChallenge detects various Cloudflare challenge signatures', () => {
  // Turnstile script
  const turnstileHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Just a moment...</title></head>
      <body>
        <div id="challenge-platform">Checking your browser before accessing site.</div>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
      </body>
    </html>
  `;
  assert.equal(isCloudflareChallenge(turnstileHtml), true);

  // cf-mitigated signature in header or text
  const mitigatedHtml = `<html><head><title>Access denied</title></head><body>cf-mitigated: challenge</body></html>`;
  assert.equal(isCloudflareChallenge(mitigatedHtml), true);

  // cf-browser-verification
  const verificationHtml = `<html><body><div class="cf-browser-verification">Please wait...</div></body></html>`;
  assert.equal(isCloudflareChallenge(verificationHtml), true);

  // Normal product HTML
  const normalHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>100% Hydro Isolate 2kg - PlusPower</title></head>
      <body><h1>100% Hydro Isolate 2kg</h1></body>
    </html>
  `;
  assert.equal(isCloudflareChallenge(normalHtml), false);
});

test('isCloudflareChallenge detects HTTP 403 / 429 / 503 status with Cloudflare signatures', () => {
  assert.equal(isCloudflareChallenge('', 403, { server: 'cloudflare' }), true);
  assert.equal(isCloudflareChallenge('', 429, { server: 'cloudflare' }), true);
  assert.equal(isCloudflareChallenge('', 503, { server: 'cloudflare' }), true);
  assert.equal(isCloudflareChallenge('', 200, { server: 'cloudflare' }), false);
  assert.equal(isCloudflareChallenge('', 403, { 'cf-mitigated': 'challenge' }), true);
});

test('extractProductFromHtml throws exact CLOUDFLARE_ERROR_MESSAGE and rejects challenge pages', () => {
  const challengeHtml = `
    <html>
      <head><title>Just a moment...</title></head>
      <body><div id="turnstile-wrapper">Please wait while we verify your browser...</div></body>
    </html>
  `;

  assert.throws(
    () => {
      extractProductFromHtml(challengeHtml, 'https://www.pluspowersupplements.com/test-prod', 'html_import');
    },
    (err: any) => {
      return err.message === CLOUDFLARE_ERROR_MESSAGE;
    }
  );
});

test('isValidProductUrl correctly filters valid vs non-product URLs', () => {
  assert.equal(
    isValidProductUrl('https://www.pluspowersupplements.com/100-hydro-isolate-2kg'),
    true
  );
  assert.equal(
    isValidProductUrl('https://www.pluspowersupplements.com/blog/nutrition-tips'),
    false
  );
  assert.equal(
    isValidProductUrl('https://www.pluspowersupplements.com/cart'),
    false
  );
  assert.equal(
    isValidProductUrl('https://external-site.com/product-123'),
    false
  );
});

test('parsePrice handles European format and various inputs correctly', () => {
  assert.equal(parsePrice('€ 34,90'), 34.90);
  assert.equal(parsePrice('49,99 €'), 49.99);
  assert.equal(parsePrice('1.250,50'), 1250.50);
  assert.equal(parsePrice('19.99'), 19.99);
  assert.equal(parsePrice(25.5), 25.5);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice(null), null);
});

test('extractJsAssignment parses JS objects and arrays accurately', () => {
  const sampleScript = `
    var randomVar = 123;
    var varianti = {"1":[{"id":101,"codice":"WHEY-VAN-2KG","ean":"8051234567890","prezzo_ivato":"59.90","prezzo_sconto_ivato":"49.90","quant":15,"lotti":[{"scadenza":"2027-05-30","quant":15,"disponibile_web":1}]}]};
    var descvar1 = [{"id":1,"descrizione":"Vaniglia"}];
  `;

  const varianti = extractJsAssignment(sampleScript, 'varianti');
  assert.ok(varianti);
  assert.ok(varianti['1']);
  assert.equal(varianti['1'][0].codice, 'WHEY-VAN-2KG');

  const descvar1 = extractJsAssignment(sampleScript, 'descvar1');
  assert.ok(Array.isArray(descvar1));
  assert.equal(descvar1[0].descrizione, 'Vaniglia');
});

test('extractPlusPowerVariants correctly binds varianti and descvar1 into variant records', () => {
  const html = `
    <html>
      <head></head>
      <body>
        <script>
          var varianti = {
            "1": [
              {
                "id": 501,
                "codice": "HYDRO-VAN",
                "ean": "8033221144551",
                "prezzo_ivato": "64,90",
                "prezzo_sconto_ivato": "54,90",
                "quant": 10,
                "lotti": [{"scadenza": "30/06/2027", "quant": 10, "disponibile_web": 1}]
              }
            ],
            "2": [
              {
                "id": 502,
                "codice": "HYDRO-CHOC",
                "ean": "8033221144552",
                "prezzo_ivato": "64,90",
                "prezzo_sconto_ivato": "54,90",
                "quant": 0,
                "lotti": [{"scadenza": "15/04/2027", "quant": 0, "disponibile_web": 0}]
              }
            ]
          };
          var descvar1 = [
            {"id": 1, "descrizione": "Vaniglia Deliziosa"},
            {"id": 2, "descrizione": "Cioccolato Belga"}
          ];
        </script>
      </body>
    </html>
  `;

  const variants = extractPlusPowerVariants(html);
  assert.equal(variants.length, 2);

  const v1 = variants.find((v) => v.name === 'Vaniglia Deliziosa');
  assert.ok(v1);
  assert.equal(v1.sku, 'HYDRO-VAN');
  assert.equal(v1.ean, '8033221144551');
  assert.equal(v1.price, 54.90);
  assert.equal(v1.original_price, 64.90);
  assert.equal(v1.stock_quantity, 10);
  assert.equal(v1.availability, 'InStock');
  assert.equal(v1.expiry_date, '30/06/2027');

  const v2 = variants.find((v) => v.name === 'Cioccolato Belga');
  assert.ok(v2);
  assert.equal(v2.stock_quantity, 0);
  assert.equal(v2.availability, 'OutOfStock');
});

test('extractProductFromHtml produces a complete Product object with zero hallucinated data', () => {
  const fullHtml = `
    <!doctype html>
    <html lang="it">
      <head>
        <title>100% Hydro Isolate 2kg - PlusPower Supplements</title>
        <link rel="canonical" href="https://www.pluspowersupplements.com/100-hydro-isolate-2kg" />
        <link rel="image" itemprop="image" href="/images/hydro-isolate.jpg" />
        <div itemprop="brand"><meta itemprop="name" content="Yamamoto Nutrition" /></div>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "100% Hydro Isolate 2kg",
            "brand": { "@type": "Brand", "name": "Yamamoto Nutrition" },
            "sku": "YAM-HYDRO-2KG",
            "gtin13": "8033221144550",
            "offers": {
              "@type": "Offer",
              "price": "54.90",
              "priceCurrency": "EUR",
              "availability": "https://schema.org/InStock"
            }
          }
        </script>
      </head>
      <body>
        <h1>100% Hydro Isolate 2kg</h1>
        <div id="description">Isolate proteiche del siero del latte idrolizzate per rapido assorbimento.</div>
        <div id="ingredients">Proteine del siero del latte idrolizzate (Optipep 90), aroma, edulcorante.</div>
        <script>
          var varianti = {
            "1": [{ "id": 10, "codice": "YAM-HYDRO-VAN", "ean": "8033221144551", "prezzo_ivato": "64.90", "prezzo_sconto_ivato": "54.90", "quant": 25 }]
          };
          var descvar1 = [{ "id": 1, "descrizione": "Vaniglia" }];
        </script>
      </body>
    </html>
  `;

  const product = extractProductFromHtml(fullHtml, 'https://www.pluspowersupplements.com/100-hydro-isolate-2kg', 'html_import');

  assert.equal(product.title, '100% Hydro Isolate 2kg');
  assert.equal(product.brand, 'Yamamoto Nutrition');
  assert.equal(product.price, 54.90);
  assert.equal(product.currency, 'EUR');
  assert.equal(product.sku, 'YAM-HYDRO-2KG');
  assert.equal(product.ean, '8033221144550');
  assert.equal(product.variants.length, 1);
  assert.equal(product.variants[0].name, 'Vaniglia');
  assert.equal(product.variants[0].sku, 'YAM-HYDRO-VAN');
  assert.equal(product.status, 'ready');
  assert.equal(product.images.length > 0, true);
  assert.equal(product.images[0], 'https://www.pluspowersupplements.com/images/hydro-isolate.jpg');
});
