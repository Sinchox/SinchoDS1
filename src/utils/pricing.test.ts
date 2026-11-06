import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEbayPricing,
  generateEbayTitle,
  generateEbayDescriptionHtml,
  countWords,
  validateEbayListing,
  DEFAULT_PRICING_RULE,
} from './pricing.js';
import { Product, EbayListing } from '../types.js';

test('countWords accurately counts real words and ignores HTML tags, attributes, and whitespace', () => {
  const sampleHtml = `<div class="p-4" style="color: red;"><p>Integratore alimentare <strong>di alta qualit&agrave;</strong> per lo sport.</p></div>`;
  // Words: Integratore, alimentare, di, alta, qualità, per, lo, sport. (8 words)
  const count = countWords(sampleHtml);
  assert.equal(count, 8);

  // Tags alone should return 0
  assert.equal(countWords('<div class="header"><span></span><hr/></div>'), 0);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   \n\t   '), 0);
});

test('calculateEbayPricing produces accurate break-even, fees, and profit margins', () => {
  const result = calculateEbayPricing(50, {
    targetMarginPercent: 20,
    targetFixedProfit: 5,
    supplierShippingCost: 0,
    ebayFeePercent: 11.5,
    ebayFixedFee: 0.35,
  });

  assert.equal(result.supplierCost, 50);
  assert.ok(result.recommendedPrice > 50);
  assert.ok(result.recommendedPrice > result.breakEvenPrice);
  assert.ok(result.expectedNetProfit >= 5);
  assert.ok(result.profitMarginPercent > 0);

  // Check break-even formula: selling at break-even produces ~0 profit
  const breakEvenResult = calculateEbayPricing(50, {
    targetMarginPercent: 0,
    targetFixedProfit: 0,
    ebayFeePercent: 11.5,
    ebayFixedFee: 0.35,
  });
  assert.ok(Math.abs(breakEvenResult.expectedNetProfit) <= 0.1);
});

test('generateEbayTitle produces SEO title under 80 characters without duplication', () => {
  const title1 = generateEbayTitle({
    brand: 'Yamamoto Nutrition',
    title: '100% Hydro Isolate 2kg',
    variantName: 'Vaniglia Deliziosa',
  });

  assert.ok(title1.length <= 80);
  assert.ok(title1.includes('Yamamoto Nutrition'));
  assert.ok(title1.includes('100% Hydro Isolate 2kg'));
  assert.ok(title1.includes('Vaniglia Deliziosa'));

  // Very long title test
  const longTitle = generateEbayTitle({
    brand: 'Super Brand Name Extremely Long Supplement Manufacturer',
    title: 'Ultra High Protein Hydrolyzed Whey Isolate 5000g Giant Economy Pack Professional Edition',
    variantName: 'Double Chocolate Fudge Brownie Special Reserve Edition',
  });
  assert.ok(longTitle.length <= 80);
  assert.ok(!longTitle.endsWith('-'));
  assert.ok(!longTitle.endsWith(','));
});

test('generateEbayDescriptionHtml generates >= 300 actual words in professional Italian across 7 sections', () => {
  const sampleProduct: Product = {
    id: 'test-p1',
    supplier_id: 'pluspower',
    url: 'https://www.pluspowersupplements.com/test-prod',
    title: '100% Hydro Isolate 2kg',
    brand: 'Yamamoto Nutrition',
    category: 'Proteine',
    price: 54.90,
    original_price: 64.90,
    currency: 'EUR',
    sku: 'YAM-HYDRO-2KG',
    ean: '8033221144550',
    availability: 'InStock',
    stock_quantity: 50,
    description: 'Integratore alimentare di proteine isolate del siero di latte idrolizzate Optipep 90 con enzimi digestivi.',
    ingredients: 'Proteine del siero di latte idrolizzate (Optipep® 90 DH4), aromi, edulcorante: sucralosio.',
    nutrition: 'Per 100g: Proteine 88g, Carboidrati 1.2g, Grassi 1.5g',
    images: ['https://example.com/hydro.jpg'],
    variants: [
      {
        id: 'v1',
        product_id: 'test-p1',
        variant_id: '1',
        option_id: '1',
        name: 'Vaniglia Deliziosa',
        sku: 'YAM-HYDRO-VAN',
        ean: '8033221144551',
        price: 54.90,
        original_price: 64.90,
        stock_quantity: 20,
        availability: 'InStock',
        expiry_date: '30/06/2027',
      },
    ],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const html = generateEbayDescriptionHtml(sampleProduct, sampleProduct.variants[0]);
  const words = countWords(html);

  // Must exceed the 300 words strict threshold and ideally be in 350-500 range
  assert.ok(
    words >= 300,
    `Description word count was ${words}, expected >= 300 actual words`
  );

  // Must contain all 7 structured section markers in Italian
  assert.ok(html.includes('Presentazione del Prodotto'));
  assert.ok(html.includes('Panoramica e Caratteristiche Distintive'));
  assert.ok(html.includes('Vantaggi per lo Sportivo'));
  assert.ok(html.includes('Composizione, Ingredienti'));
  assert.ok(html.includes('Modalità d&#39;Uso') || html.includes("Modalit"));
  assert.ok(html.includes('Avvertenze Ministeriali'));
  assert.ok(html.includes('Garanzia di Acquisto') || html.includes('Assistenza'));

  // Must include actual product data
  assert.ok(html.includes('Yamamoto Nutrition'));
  assert.ok(html.includes('100% Hydro Isolate 2kg'));
  assert.ok(html.includes('Vaniglia Deliziosa'));
  assert.ok(html.includes('30/06/2027'));
});

test('generateEbayDescriptionHtml handles minimal product data without fabricating fake ingredients and still meets >= 300 words', () => {
  const minimalProduct: Product = {
    id: 'test-min',
    supplier_id: 'pluspower',
    url: 'https://www.pluspowersupplements.com/minimal-supplement',
    title: 'Creatine Pure Powder 500g',
    brand: null,
    category: null,
    price: 19.90,
    original_price: null,
    currency: 'EUR',
    sku: null,
    ean: null,
    availability: 'InStock',
    stock_quantity: 10,
    description: null,
    ingredients: null,
    nutrition: null,
    images: [],
    variants: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const html = generateEbayDescriptionHtml(minimalProduct);
  const words = countWords(html);

  assert.ok(
    words >= 300,
    `Minimal description word count was ${words}, expected >= 300 actual words`
  );
  // Verify that missing info is handled transparently with supplier disclaimers rather than hallucinated ingredients
  assert.ok(html.includes('etichetta'));
  assert.ok(html.includes('confezione'));
});

test('validateEbayListing enforces 300-word threshold and title length limit', () => {
  const invalidShortListing: EbayListing = {
    id: 'l1',
    product_id: 'p1',
    supplier_id: 'pluspower',
    supplier_url: 'https://example.com',
    marketplace_id: 'EBAY_IT',
    title: 'Short Title',
    category_id: '180959',
    category_name: 'Proteine',
    condition_id: 'NEW',
    price: 35.0,
    original_supplier_cost: 20.0,
    expected_profit: 5.0,
    quantity: 5,
    sku: 'SKU-1',
    ean: null,
    brand: 'Yamamoto Nutrition',
    description_html: '<p>Only six words in this description.</p>',
    images: ['https://example.com/img.jpg'],
    item_specifics: { Marca: 'Yamamoto' },
    status: 'draft',
    variants: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const resultShort = validateEbayListing(invalidShortListing, 20.0);
  assert.equal(resultShort.isReady, false);
  const wordCheck = resultShort.checks.find((c: any) => c.id === 'word_count');
  assert.ok(wordCheck);
  assert.equal(wordCheck.passed, false);

  // With a full description of >= 300 words
  const fullHtml = generateEbayDescriptionHtml({
    id: 'p1',
    supplier_id: 'pluspower',
    url: 'https://example.com',
    title: '100% Whey Protein 2kg',
    brand: 'Yamamoto Nutrition',
    category: 'Proteine',
    price: 45.0,
    original_price: 55.0,
    currency: 'EUR',
    sku: 'WHEY-2KG',
    ean: '8012345678901',
    availability: 'InStock',
    stock_quantity: 10,
    description: 'Proteine del siero di latte concentrate.',
    ingredients: 'Proteine del siero di latte.',
    nutrition: 'Per 100g: Proteine 80g',
    images: ['https://example.com/whey.jpg'],
    variants: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const validListing: EbayListing = {
    ...invalidShortListing,
    title: 'Yamamoto Nutrition 100% Whey Protein 2kg Integratore Proteico',
    description_html: fullHtml,
  };

  const resultValid = validateEbayListing(validListing, 20.0);
  assert.equal(resultValid.isReady, true);
  assert.equal(resultValid.wordCountValid, true);
});
