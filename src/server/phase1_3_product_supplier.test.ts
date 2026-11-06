import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWorkspaceStore,
  listWorkspaceProducts,
  saveWorkspaceProduct,
  archiveWorkspaceProduct,
  restoreWorkspaceProduct,
  bulkArchiveWorkspaceProducts,
  bulkRestoreWorkspaceProducts,
  addWorkspaceProductVariant,
  updateWorkspaceProductVariant,
  deleteWorkspaceProductVariant,
  listWorkspaceSuppliers,
  saveWorkspaceSupplier,
  deleteWorkspaceSupplier,
  toggleWorkspaceSupplierConnection,
  importSingleProductUrl,
  createWorkspaceImportJob,
  getWorkspaceImportJob,
  getWorkspaceImportJobs,
} from './workspaceStore.js';
import {
  extractUniversalProductFromHtml,
  parseProductWithSupplierFallback,
  detectSupplierFromUrl,
} from '../utils/parser.js';
import { Product, Supplier } from '../types.js';

test('Phase 1.3: Universal Fallback Parser extracts JSON-LD Schema.org and OpenGraph data', () => {
  const jsonLdHtml = `
    <!doctype html>
    <html>
      <head>
        <title>Creatine Monohydrate 500g - Pure Power</title>
        <meta property="og:title" content="Pure Creatine 500g" />
        <meta property="og:image" content="https://purepower.example.com/images/creatine.jpg" />
        <meta property="og:description" content="Ultra pure micronized creatine monohydrate." />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Pure Creatine Monohydrate 500g",
            "brand": { "@type": "Brand", "name": "PurePower Nutrition" },
            "sku": "PP-CREATINE-500",
            "gtin13": "8011223344556",
            "category": "Sport Nutrition > Creatine",
            "description": "Premium grade creatine monohydrate powder for muscle power.",
            "offers": {
              "@type": "Offer",
              "price": "24.90",
              "priceCurrency": "EUR",
              "availability": "https://schema.org/InStock"
            }
          }
        </script>
      </head>
      <body>
        <h1>Pure Creatine Monohydrate 500g</h1>
      </body>
    </html>
  `;

  const product = extractUniversalProductFromHtml(
    jsonLdHtml,
    'https://purepower.example.com/pure-creatine-500g',
    { id: 'purepower', name: 'PurePower Nutrition' }
  );

  assert.equal(product.title, 'Pure Creatine Monohydrate 500g');
  assert.equal(product.brand, 'PurePower Nutrition');
  assert.equal(product.category, 'Sport Nutrition > Creatine');
  assert.equal(product.sku, 'PP-CREATINE-500');
  assert.equal(product.ean, '8011223344556');
  assert.equal(product.price, 24.90);
  assert.equal(product.currency, 'EUR');
  assert.equal(product.status, 'draft', 'Universal parser must set status to draft');
  assert.equal(product.ebay_status, 'not_listed');
  assert.ok(product.images.includes('https://purepower.example.com/images/creatine.jpg'));
});

test('Phase 1.3: Universal Fallback Parser extracts variants from Schema.org ProductGroup hasVariant without flattening', () => {
  const multiVariantHtml = `
    <!doctype html>
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "ProductGroup",
            "name": "Whey Protein 1kg",
            "brand": "Optimum Nutrition",
            "hasVariant": [
              {
                "@type": "Product",
                "name": "Whey Protein 1kg - Double Rich Chocolate",
                "sku": "ON-WHEY-CHOC",
                "gtin13": "5060123456789",
                "offers": {
                  "@type": "Offer",
                  "price": "39.99",
                  "availability": "https://schema.org/InStock"
                }
              },
              {
                "@type": "Product",
                "name": "Whey Protein 1kg - French Vanilla",
                "sku": "ON-WHEY-VAN",
                "gtin13": "5060123456790",
                "offers": {
                  "@type": "Offer",
                  "price": "39.99",
                  "availability": "https://schema.org/OutOfStock"
                }
              }
            ]
          }
        </script>
      </head>
      <body>
        <h1>Whey Protein 1kg</h1>
      </body>
    </html>
  `;

  const product = extractUniversalProductFromHtml(multiVariantHtml, 'https://on.example.com/whey-1kg');
  assert.equal(product.variants.length, 2);

  const choc = product.variants.find((v) => v.sku === 'ON-WHEY-CHOC');
  assert.ok(choc);
  assert.equal(choc.name, 'Whey Protein 1kg - Double Rich Chocolate');
  assert.equal(choc.ean, '5060123456789');
  assert.equal(choc.price, 39.99);
  assert.equal(choc.availability, 'InStock');

  const van = product.variants.find((v) => v.sku === 'ON-WHEY-VAN');
  assert.ok(van);
  assert.equal(van.name, 'Whey Protein 1kg - French Vanilla');
  assert.equal(van.ean, '5060123456790');
  assert.equal(van.availability, 'OutOfStock');
});

test('Phase 1.3: Universal Fallback Parser applies custom CSS selectors if configured on supplier', () => {
  const customMarkup = `
    <html>
      <body>
        <div class="custom-title-heading">Anabolic Mass Gainer 3kg</div>
        <div class="custom-money">€ 42,50</div>
        <div class="custom-item-sku">GAIN-3000</div>
        <div class="custom-barcode">8022446688001</div>
        <div class="custom-desc-box">High calorie bulking formulation with oats and whey.</div>
      </body>
    </html>
  `;

  const customSupplier: Partial<Supplier> = {
    id: 'mass_supplier',
    name: 'Mass Wholesale',
    parserConfig: {
      titleSelector: '.custom-title-heading',
      priceSelector: '.custom-money',
      skuSelector: '.custom-item-sku',
      eanSelector: '.custom-barcode',
      descriptionSelector: '.custom-desc-box',
    },
  };

  const product = extractUniversalProductFromHtml(customMarkup, 'https://mass.example.com/gainer', customSupplier);
  assert.equal(product.title, 'Anabolic Mass Gainer 3kg');
  assert.equal(product.price, 42.50);
  assert.equal(product.sku, 'GAIN-3000');
  assert.equal(product.ean, '8022446688001');
  assert.equal(product.description, 'High calorie bulking formulation with oats and whey.');
});

test('Phase 1.3: detectSupplierFromUrl accurately identifies PlusPower and custom suppliers', () => {
  const customSuppliers: Supplier[] = [
    {
      id: 'gymbeam',
      name: 'GymBeam B2B',
      baseUrl: 'https://gymbeam.com',
      logoText: 'GB',
      status: 'active',
      lastSyncAt: null,
      productCount: 0,
      failedCount: 0,
      description: 'GymBeam supplier',
      supportedFeatures: { sitemap: false, variants: true, lotExpiry: false, liveScraping: true, htmlImport: true },
    },
  ];

  // PlusPower detection
  const pp = detectSupplierFromUrl('https://www.pluspowersupplements.com/proteine-del-siero', customSuppliers);
  assert.ok(pp);
  assert.equal(pp.id, 'pluspower');

  // Custom supplier detection
  const gb = detectSupplierFromUrl('https://gymbeam.com/just-whey-1000g.html', customSuppliers);
  assert.ok(gb);
  assert.equal(gb.id, 'gymbeam');

  // Unknown domain
  const unknown = detectSupplierFromUrl('https://unregistered-domain.com/item', customSuppliers);
  assert.equal(unknown, null);
});

test('Phase 1.3: parseProductWithSupplierFallback preserves specialized PlusPower parser when host matches', () => {
  const plusPowerHtml = `
    <html>
      <head>
        <title>100% Whey Isolate - PlusPower</title>
      </head>
      <body>
        <h1>100% Whey Isolate</h1>
        <script>
          var varianti = {
            "1": [{"id": 77, "codice": "PP-WHEY-CHO", "ean": "8055667788990", "prezzo_ivato": "59,90", "quant": 12, "lotti": [{"scadenza": "31/12/2026", "quant": 12, "disponibile_web": 1}]}]
          };
          var descvar1 = [{"id": 1, "descrizione": "Cioccolato Fondente"}];
        </script>
      </body>
    </html>
  `;

  const product = parseProductWithSupplierFallback(
    plusPowerHtml,
    'https://www.pluspowersupplements.com/100-whey-isolate'
  );

  assert.equal(product.supplier_id, 'pluspower');
  assert.equal(product.title, '100% Whey Isolate');
  assert.equal(product.status, 'draft', 'Imported products must be saved as draft');
  assert.equal(product.variants.length, 1);
  assert.equal(product.variants[0].name, 'Cioccolato Fondente');
  assert.equal(product.variants[0].expiry_date, '31/12/2026');
});

test('Phase 1.3: Duplicate detection prevents duplicate imports within the same workspace while allowing cross-workspace imports', async () => {
  clearWorkspaceStore();

  const wsA = 'ws-test-a-1111';
  const wsB = 'ws-test-b-2222';

  const testProduct: Product = {
    id: 'prod-unique-1',
    supplier_id: 'pluspower',
    supplier_name: 'PlusPower',
    url: 'https://www.pluspowersupplements.com/bcaa-pure',
    title: 'BCAA Pure 500g',
    brand: 'Yamamoto',
    category: 'Aminoacidi',
    price: 29.90,
    original_price: 34.90,
    currency: 'EUR',
    sku: 'YAM-BCAA-500',
    ean: '8033221199887',
    availability: 'InStock',
    stock_quantity: 25,
    description: 'Branched chain amino acids',
    ingredients: 'L-Leucine, L-Isoleucine, L-Valine',
    nutrition: 'Per 5g: 5g BCAA',
    images: ['https://www.pluspowersupplements.com/images/bcaa.jpg'],
    variants: [],
    import_source: 'live_scraper',
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Save to Workspace A
  const saveA = await saveWorkspaceProduct(wsA, testProduct);
  assert.equal(saveA.ok, true);

  // Attempt duplicate import into Workspace A
  const dupCheckA = await importSingleProductUrl(wsA, 'https://www.pluspowersupplements.com/bcaa-pure');
  assert.equal(dupCheckA.ok, false);
  assert.equal(dupCheckA.isDuplicate, true);
  assert.ok(dupCheckA.error?.includes('Duplicate product'));

  // Verify Workspace B does not have it and allows import
  const listB = await listWorkspaceProducts(wsB);
  assert.equal(listB.length, 0);

  // Save to Workspace B is isolated and allowed
  const saveB = await saveWorkspaceProduct(wsB, { ...testProduct, id: 'prod-unique-2' });
  assert.equal(saveB.ok, true);

  const listBAfter = await listWorkspaceProducts(wsB);
  assert.equal(listBAfter.length, 1);
});

test('Phase 1.3: Product archiving and restoring works individually and in bulk', async () => {
  clearWorkspaceStore();
  const ws = 'ws-archive-test';

  const p1: Product = {
    id: 'prod-arch-1',
    supplier_id: 'pluspower',
    url: 'https://www.pluspowersupplements.com/prod-1',
    title: 'Product One',
    brand: 'Brand',
    category: 'Cat',
    price: 20,
    original_price: null,
    currency: 'EUR',
    sku: 'SKU-1',
    ean: 'EAN-1',
    availability: 'InStock',
    stock_quantity: 5,
    description: 'Desc',
    ingredients: null,
    nutrition: null,
    images: [],
    variants: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const p2: Product = {
    ...p1,
    id: 'prod-arch-2',
    url: 'https://www.pluspowersupplements.com/prod-2',
    title: 'Product Two',
    sku: 'SKU-2',
  };

  await saveWorkspaceProduct(ws, p1);
  await saveWorkspaceProduct(ws, p2);

  // Individual Archive
  const arch1 = await archiveWorkspaceProduct(ws, 'prod-arch-1');
  assert.ok(arch1);
  assert.equal(arch1.status, 'archived');
  assert.equal(arch1.is_archived, true);

  // Individual Restore
  const rest1 = await restoreWorkspaceProduct(ws, 'prod-arch-1');
  assert.ok(rest1);
  assert.equal(rest1.status, 'draft');
  assert.equal(rest1.is_archived, false);

  // Bulk Archive
  const bulkArchCount = await bulkArchiveWorkspaceProducts(ws, ['prod-arch-1', 'prod-arch-2']);
  assert.equal(bulkArchCount, 2);

  const listAfterBulk = await listWorkspaceProducts(ws);
  assert.equal(listAfterBulk.filter((p) => p.status === 'archived').length, 2);

  // Bulk Restore
  const bulkRestCount = await bulkRestoreWorkspaceProducts(ws, ['prod-arch-1', 'prod-arch-2']);
  assert.equal(bulkRestCount, 2);

  const listAfterRest = await listWorkspaceProducts(ws);
  assert.equal(listAfterRest.filter((p) => p.status === 'draft').length, 2);
});

test('Phase 1.3: Variant management maintains independent SKU, EAN, price, stock and preserves relationships', async () => {
  clearWorkspaceStore();
  const ws = 'ws-variants-test';

  const baseProduct: Product = {
    id: 'prod-with-vars',
    supplier_id: 'pluspower',
    url: 'https://www.pluspowersupplements.com/protein-complex',
    title: 'Protein Complex Multi-Stage',
    brand: 'Yamamoto',
    category: 'Proteine',
    price: 49.90,
    original_price: null,
    currency: 'EUR',
    sku: 'YAM-CMPLX-PARENT',
    ean: '8033221100000',
    availability: 'InStock',
    stock_quantity: 30,
    description: 'Multi source protein',
    ingredients: null,
    nutrition: null,
    images: [],
    variants: [],
    import_source: 'html_import',
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await saveWorkspaceProduct(ws, baseProduct);

  // Add Variant 1
  const addV1 = await addWorkspaceProductVariant(ws, 'prod-with-vars', {
    name: 'Gusto Biscotto',
    sku: 'YAM-CMPLX-BISCUIT',
    ean: '8033221100001',
    price: 49.90,
    stock_quantity: 18,
    expiry_date: '31/05/2027',
  });
  assert.equal(addV1.ok, true);
  assert.equal(addV1.product?.variants.length, 1);

  // Add Variant 2
  const addV2 = await addWorkspaceProductVariant(ws, 'prod-with-vars', {
    name: 'Gusto Pistacchio',
    sku: 'YAM-CMPLX-PISTACHIO',
    ean: '8033221100002',
    price: 52.90, // Independent price!
    stock_quantity: 12,
    expiry_date: '30/08/2027',
  });
  assert.equal(addV2.ok, true);
  assert.equal(addV2.product?.variants.length, 2);

  const pistV = addV2.product?.variants.find((v) => v.name === 'Gusto Pistacchio');
  assert.ok(pistV);
  assert.equal(pistV.price, 52.90);
  assert.equal(pistV.stock_quantity, 12);

  // Update Variant 2 stock & price independently
  const updV2 = await updateWorkspaceProductVariant(ws, 'prod-with-vars', pistV.id, {
    stock_quantity: 0,
    price: 54.90,
  });
  assert.equal(updV2.ok, true);
  const updatedPist = updV2.product?.variants.find((v) => v.id === pistV.id);
  assert.equal(updatedPist?.stock_quantity, 0);
  assert.equal(updatedPist?.availability, 'OutOfStock');
  assert.equal(updatedPist?.price, 54.90);

  // Delete Variant 1
  const biscV = addV2.product?.variants.find((v) => v.name === 'Gusto Biscotto');
  const delV1 = await deleteWorkspaceProductVariant(ws, 'prod-with-vars', biscV!.id);
  assert.equal(delV1.ok, true);
  assert.equal(delV1.product?.variants.length, 1);
  assert.equal(delV1.product?.variants[0].name, 'Gusto Pistacchio');
});

test('Phase 1.3: Custom supplier lifecycle, connection toggles, and protection of global PlusPower', async () => {
  clearWorkspaceStore();
  const ws = 'ws-suppliers-test';

  const customSupplier: Supplier = {
    id: 'supp_tsunami',
    name: 'Tsunami Nutrition',
    baseUrl: 'https://tsunaminutrition.it',
    logoText: 'TN',
    status: 'active',
    connected: true,
    lastSyncAt: null,
    productCount: 0,
    failedCount: 0,
    description: 'Custom sports nutrition supplier',
    isGlobal: false,
    fetchMethod: 'zenrows',
    jsRender: true,
    shippingCost: 5.90,
    stockThreshold: 3,
    pricingRule: { targetMarginPercent: 30, targetFixedProfit: 6 },
    supportedFeatures: { sitemap: false, variants: true, lotExpiry: false, liveScraping: true, htmlImport: true },
  };

  // Add custom supplier
  const saveRes = await saveWorkspaceSupplier(ws, customSupplier, 'admin');
  assert.equal(saveRes.ok, true);

  const suppliers = await listWorkspaceSuppliers(ws);
  // Contains global PlusPower + custom Tsunami
  assert.ok(suppliers.some((s) => s.id === 'pluspower'));
  const foundTsunami = suppliers.find((s) => s.id === 'supp_tsunami');
  assert.ok(foundTsunami);
  assert.equal(foundTsunami.fetchMethod, 'zenrows');
  assert.equal(foundTsunami.shippingCost, 5.90);

  // Toggle connection disconnect
  const disc = await toggleWorkspaceSupplierConnection(ws, 'supp_tsunami', false, 'manager');
  assert.equal(disc.ok, true);
  assert.equal(disc.supplier?.connected, false);

  // Toggle connection reconnect
  const conn = await toggleWorkspaceSupplierConnection(ws, 'supp_tsunami', true, 'manager');
  assert.equal(conn.ok, true);
  assert.equal(conn.supplier?.connected, true);

  // Attempt to delete global PlusPower -> must be REJECTED
  const delGlobal = await deleteWorkspaceSupplier(ws, 'pluspower', 'admin');
  assert.equal(delGlobal.ok, false);
  assert.ok(delGlobal.error?.includes('Global reusable suppliers cannot be deleted'));

  // Delete custom supplier -> allowed for admin
  const delCustom = await deleteWorkspaceSupplier(ws, 'supp_tsunami', 'admin');
  assert.equal(delCustom.ok, true);

  const suppliersAfter = await listWorkspaceSuppliers(ws);
  assert.equal(suppliersAfter.some((s) => s.id === 'supp_tsunami'), false);
});

test('Phase 1.3: Background import job lifecycle creates and tracks jobs asynchronously', async () => {
  clearWorkspaceStore();
  const ws = 'ws-jobs-test';

  const urls = [
    'https://www.pluspowersupplements.com/prod-job-1',
    'https://www.pluspowersupplements.com/prod-job-2',
  ];

  const job = createWorkspaceImportJob(ws, urls, 'pluspower', 'direct', false);
  assert.ok(job.id.startsWith('job_'));
  assert.equal(job.total, 2);
  assert.equal(job.workspaceId, ws);

  // Retrieve by ID
  const retrieved = getWorkspaceImportJob(ws, job.id);
  assert.ok(retrieved);
  assert.equal(retrieved.id, job.id);

  // Retrieve list of workspace jobs
  const allJobs = getWorkspaceImportJobs(ws);
  assert.equal(allJobs.length, 1);
  assert.equal(allJobs[0].id, job.id);
});
