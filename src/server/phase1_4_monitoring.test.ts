import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEbayPricing, evaluatePriceChange, DEFAULT_PRICING_RULE } from '../utils/pricing.js';
import {
  checkProductNow,
  activeMonitoringProductLocks,
  createWorkspaceNotification,
  resolveWorkspaceNotification,
  listWorkspaceNotifications,
  listWorkspaceChangeReviews,
  approveWorkspaceChangeReview,
  rejectWorkspaceChangeReview,
  listWorkspaceEbaySyncEvents,
  getWorkspaceMonitoringSettings,
  saveWorkspaceMonitoringSettings,
} from './monitoringService.js';
import {
  getWorkspaceProduct,
  saveWorkspaceProduct,
  recordWorkspacePriceChange,
  approveWorkspacePriceChange,
  rejectWorkspacePriceChange,
  saveWorkspaceSupplier,
} from './workspaceStore.js';
import { Product, Supplier, PricingRule } from '../types.js';

test('calculateEbayPricing incorporates packaging and additional costs into full cost and fee breakdown', () => {
  const baseCost = 25.0;
  const ruleWithoutPackaging: PricingRule = {
    ...DEFAULT_PRICING_RULE,
    supplierShippingCost: 4.5,
    packagingCost: 0,
    targetMarginPercent: 20,
    targetFixedProfit: 5,
  };

  const ruleWithPackaging: PricingRule = {
    ...ruleWithoutPackaging,
    packagingCost: 2.5,
  };

  const calcWithout = calculateEbayPricing(baseCost, ruleWithoutPackaging);
  const calcWith = calculateEbayPricing(baseCost, ruleWithPackaging);

  assert.equal(calcWithout.packagingCost, 0);
  assert.equal(calcWith.packagingCost, 2.5);
  // Total cost must reflect base + shipping + packaging
  assert.equal(calcWith.totalCost, 25.0 + 4.5 + 2.5);
  // Break-even and recommended price must be higher when packaging is included
  assert.ok(calcWith.breakEvenPrice > calcWithout.breakEvenPrice);
  assert.ok(calcWith.recommendedPrice > calcWithout.recommendedPrice);
  // Expected profit must be maintained
  assert.ok(calcWith.expectedNetProfit >= 5);
});

test('evaluatePriceChange automatically recalculates selling price on supplier price increase when minimum profit is preserved', () => {
  const oldCost = 20.0;
  const newCost = 22.0;
  const oldSelling = 29.50;
  const rule: PricingRule = {
    ...DEFAULT_PRICING_RULE,
    minDropshipProfit: 4.0,
    targetFixedProfit: 5.0,
    targetMarginPercent: 20,
  };

  const result = evaluatePriceChange({
    currentSupplierCost: oldCost,
    newSupplierCost: newCost,
    currentSellingPrice: oldSelling,
    pricingRule: rule,
    minimumProfitThreshold: 4.0,
  });

  assert.equal(result.action, 'auto_recalculated');
  assert.equal(result.isPriceIncrease, true);
  assert.equal(result.isPriceDecrease, false);
  assert.equal(result.minProfitPreserved, true);
  assert.ok(result.newSellingPrice > oldSelling);
  assert.ok(result.calculation.expectedNetProfit >= 4.0);
  assert.ok(result.reason.includes('Supplier cost increased'));
});

test('evaluatePriceChange holds price and flags needs_approval when supplier price increase violates minimum profit threshold', () => {
  const oldCost = 20.0;
  const newCost = 60.0; // massive jump
  const oldSelling = 35.0;
  const rule: PricingRule = {
    ...DEFAULT_PRICING_RULE,
    minDropshipProfit: 50.0, // impossible to preserve with default target margin
    targetFixedProfit: 2.0,
    targetMarginPercent: 5,
  };

  const result = evaluatePriceChange({
    currentSupplierCost: oldCost,
    newSupplierCost: newCost,
    currentSellingPrice: oldSelling,
    pricingRule: rule,
    minimumProfitThreshold: 50.0,
  });

  assert.equal(result.action, 'needs_approval');
  assert.equal(result.isPriceIncrease, true);
  assert.equal(result.minProfitPreserved, false);
  // Crucial: Selling price must NOT be auto-applied! Existing price preserved.
  assert.equal(result.newSellingPrice, oldSelling);
  assert.ok(result.reason.includes('minimum profit threshold'));
});

test('evaluatePriceChange marks supplier price decrease as pending_approval requiring manual review', () => {
  const oldCost = 30.0;
  const newCost = 24.0;
  const oldSelling = 48.0;
  const rule = DEFAULT_PRICING_RULE;

  const result = evaluatePriceChange({
    currentSupplierCost: oldCost,
    newSupplierCost: newCost,
    currentSellingPrice: oldSelling,
    pricingRule: rule,
  });

  assert.equal(result.action, 'pending_approval');
  assert.equal(result.isPriceDecrease, true);
  assert.equal(result.isPriceIncrease, false);
  assert.ok(result.newSellingPrice < oldSelling);
  assert.ok(result.reason.includes('requires manual approval'));
});

test('evaluatePriceChange rejects invalid, zero, or negative supplier prices', () => {
  const rule = DEFAULT_PRICING_RULE;
  const oldSelling = 40.0;

  const zeroResult = evaluatePriceChange({
    currentSupplierCost: 25.0,
    newSupplierCost: 0,
    currentSellingPrice: oldSelling,
    pricingRule: rule,
  });
  assert.equal(zeroResult.action, 'rejected_invalid');
  assert.equal(zeroResult.newSellingPrice, oldSelling);

  const negResult = evaluatePriceChange({
    currentSupplierCost: 25.0,
    newSupplierCost: -10.5,
    currentSellingPrice: oldSelling,
    pricingRule: rule,
  });
  assert.equal(negResult.action, 'rejected_invalid');
  assert.equal(negResult.newSellingPrice, oldSelling);

  const nanResult = evaluatePriceChange({
    currentSupplierCost: 25.0,
    newSupplierCost: NaN,
    currentSellingPrice: oldSelling,
    pricingRule: rule,
  });
  assert.equal(nanResult.action, 'rejected_invalid');
  assert.equal(nanResult.newSellingPrice, oldSelling);
});

test('Stock depletion sets calculated eBay quantity to 0 without ending or deleting listing', async () => {
  const testWorkspaceId = 'ws-test-stock-deplete';

  // Seed test supplier
  const supplier: Supplier = {
    id: 'supp-stock-1',
    workspace_id: testWorkspaceId,
    name: 'Stock Test Supplier',
    type: 'custom',
    slug: 'stock-test',
    status: 'active',
    base_url: 'https://stocktest.example.com',
    fetch_method: 'direct',
    js_rendering: false,
    shipping_cost: 0,
    packaging_cost: 1.0,
    default_ebay_quantity: 3,
    monitoring_interval_minutes: 360,
    parser_config: {
      price_selector: '.price',
      stock_selector: '.stock',
      title_selector: 'h1',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveWorkspaceSupplier(testWorkspaceId, supplier);

  // Seed product with active stock
  const product: Product = {
    id: 'prod-stock-deplete-1',
    workspace_id: testWorkspaceId,
    supplier_id: supplier.id,
    url: 'https://stocktest.example.com/product-1',
    title: 'Protein Isolate 1kg',
    price: 30.0,
    stock_quantity: 10,
    availability: 'InStock',
    status: 'ready',
    calculated_quantity: 3,
    calculated_selling_price: 49.99,
    variants: [],
    images: ['https://example.com/p1.jpg'],
    import_source: 'html_import',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveWorkspaceProduct(testWorkspaceId, product);

  // Run mock monitoring check where supplier reports OutOfStock / quantity 0
  const checkResult = await checkProductNow(testWorkspaceId, product.id, async () => {
    return {
      price: 30.0,
      stock_quantity: 0,
      availability: 'OutOfStock',
      title: product.title,
    };
  });

  assert.equal(checkResult.ok, true);
  assert.equal(checkResult.product?.stock_quantity, 0);
  assert.equal(checkResult.product?.availability, 'OutOfStock');
  // Quantity set to 0 for eBay
  assert.equal(checkResult.product?.calculated_quantity, 0);
  // Listing status preserved (NOT deleted, NOT ended)
  assert.equal(checkResult.product?.status, 'ready');

  // Verify an out-of-stock notification was created
  const notifs = await listWorkspaceNotifications(testWorkspaceId);
  const outOfStockNotif = notifs.find(
    (n) => n.product_id === product.id && n.type === 'out_of_stock' && !n.is_resolved
  );
  assert.ok(outOfStockNotif, 'Active out_of_stock notification must be created');
  assert.equal(outOfStockNotif.severity, 'warning');

  // Verify ebay_sync_events recorded quantity update to 0
  const syncEvents = await listWorkspaceEbaySyncEvents(testWorkspaceId, product.id);
  const qtySync = syncEvents.find((e) => e.event_type === 'out_of_stock');
  assert.ok(qtySync, 'Ebay sync event for stock update must be logged');
  assert.equal(qtySync.payload.calculatedQuantity, 0);
});

test('Stock restoration restores configured fixed eBay quantity (3 or 5) and auto-resolves out-of-stock notification', async () => {
  const testWorkspaceId = 'ws-test-stock-restore';

  const supplier: Supplier = {
    id: 'supp-stock-restore-1',
    workspace_id: testWorkspaceId,
    name: 'Stock Restore Supplier',
    type: 'custom',
    slug: 'stock-restore',
    status: 'active',
    base_url: 'https://stockrestore.example.com',
    fetch_method: 'direct',
    js_rendering: false,
    shipping_cost: 0,
    packaging_cost: 0,
    default_ebay_quantity: 5, // configured for 5
    monitoring_interval_minutes: 360,
    parser_config: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveWorkspaceSupplier(testWorkspaceId, supplier);

  const product: Product = {
    id: 'prod-stock-restore-1',
    workspace_id: testWorkspaceId,
    supplier_id: supplier.id,
    url: 'https://stockrestore.example.com/product-2',
    title: 'BCAA Powder 500g',
    price: 25.0,
    stock_quantity: 0,
    availability: 'OutOfStock',
    status: 'ready',
    calculated_quantity: 0,
    calculated_selling_price: 39.99,
    variants: [],
    images: [],
    import_source: 'html_import',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveWorkspaceProduct(testWorkspaceId, product);

  // Pre-seed an active out_of_stock notification
  await createWorkspaceNotification(testWorkspaceId, {
    product_id: product.id,
    type: 'out_of_stock',
    severity: 'warning',
    title: 'Out of Stock Alert',
    message: 'Supplier stock depleted',
    dedup_key: `stock_zero_${product.id}`,
  });

  // Verify active notification exists
  let notifs = await listWorkspaceNotifications(testWorkspaceId);
  assert.ok(notifs.some((n) => n.product_id === product.id && !n.is_resolved));

  // Scrape returns stock = 20
  const checkResult = await checkProductNow(testWorkspaceId, product.id, async () => {
    return {
      price: 25.0,
      stock_quantity: 20,
      availability: 'InStock',
      title: product.title,
    };
  });

  assert.equal(checkResult.ok, true);
  assert.equal(checkResult.product?.stock_quantity, 20);
  assert.equal(checkResult.product?.availability, 'InStock');
  // Fixed eBay quantity restored to configured 5
  assert.equal(checkResult.product?.calculated_quantity, 5);

  // Out-of-stock notification should now be automatically resolved
  notifs = await listWorkspaceNotifications(testWorkspaceId);
  const resolvedNotif = notifs.find((n) => n.product_id === product.id && n.type === 'out_of_stock');
  assert.ok(resolvedNotif, 'Notification should still exist in history');
  assert.equal(resolvedNotif.is_resolved, true, 'Notification status must be resolved when stock returns');
});

test('Independent variant-level stock management', async () => {
  const testWorkspaceId = 'ws-test-variant-stock';

  const product: Product = {
    id: 'prod-variant-1',
    workspace_id: testWorkspaceId,
    supplier_id: 'pluspower',
    url: 'https://example.com/variants',
    title: 'Whey Protein Flavours',
    price: 30.0,
    stock_quantity: 35,
    availability: 'InStock',
    status: 'ready',
    variants: [
      {
        id: 'var-1',
        product_id: 'prod-variant-1',
        variant_id: 'v1',
        name: 'Chocolate',
        price: 30.0,
        stock_quantity: 25,
        availability: 'InStock',
      },
      {
        id: 'var-2',
        product_id: 'prod-variant-1',
        variant_id: 'v2',
        name: 'Vanilla',
        price: 30.0,
        stock_quantity: 10,
        availability: 'InStock',
      },
    ],
    images: [],
    import_source: 'html_import',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveWorkspaceProduct(testWorkspaceId, product);

  // Scraper returns variant 1 depleted (stock 0), variant 2 still in stock (stock 15)
  const checkResult = await checkProductNow(testWorkspaceId, product.id, async () => {
    return {
      price: 30.0,
      stock_quantity: 15,
      availability: 'InStock',
      variants: [
        {
          id: 'var-1',
          product_id: 'prod-variant-1',
          variant_id: 'v1',
          name: 'Chocolate',
          price: 30.0,
          stock_quantity: 0,
          availability: 'OutOfStock',
        },
        {
          id: 'var-2',
          product_id: 'prod-variant-1',
          variant_id: 'v2',
          name: 'Vanilla',
          price: 30.0,
          stock_quantity: 15,
          availability: 'InStock',
        },
      ],
    };
  });

  assert.equal(checkResult.ok, true);
  const updatedVariants = checkResult.product?.variants;
  assert.ok(updatedVariants && updatedVariants.length === 2);

  const chocolate = updatedVariants.find((v) => v.name === 'Chocolate');
  const vanilla = updatedVariants.find((v) => v.name === 'Vanilla');

  assert.equal(chocolate?.stock_quantity, 0);
  assert.equal(chocolate?.availability, 'OutOfStock');

  assert.equal(vanilla?.stock_quantity, 15);
  assert.equal(vanilla?.availability, 'InStock');
});

test('Scrape errors and parser failures preserve last reliable stock and price without setting stock to 0', async () => {
  const testWorkspaceId = 'ws-test-error-preservation';

  const product: Product = {
    id: 'prod-err-1',
    workspace_id: testWorkspaceId,
    supplier_id: 'pluspower',
    url: 'https://example.com/cloudflare-protected',
    title: 'Energy Booster',
    price: 45.0,
    stock_quantity: 18,
    availability: 'InStock',
    status: 'ready',
    calculated_quantity: 3,
    calculated_selling_price: 69.90,
    consecutive_failures: 0,
    variants: [],
    images: [],
    import_source: 'html_import',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveWorkspaceProduct(testWorkspaceId, product);

  // Scraper throws network timeout / Cloudflare challenge
  const checkResult = await checkProductNow(testWorkspaceId, product.id, async () => {
    throw new Error('503 Service Unavailable: Cloudflare Challenge');
  });

  assert.equal(checkResult.ok, false);
  assert.ok(checkResult.error?.includes('Cloudflare Challenge'));

  // Fetch product from store
  const stored = await getWorkspaceProduct(testWorkspaceId, product.id);
  assert.ok(stored);
  // Last reliable stock and price must NOT be zeroed out
  assert.equal(stored.stock_quantity, 18);
  assert.equal(stored.price, 45.0);
  assert.equal(stored.calculated_quantity, 3);
  assert.equal(stored.availability, 'InStock');
  // Error telemetry updated
  assert.equal(stored.consecutive_failures, 1);
  assert.equal(stored.monitoring_status, 'error');
  assert.ok(stored.last_monitoring_error?.includes('Cloudflare Challenge'));
});

test('Product content changes (title, description, images) are queued for review and never auto-overwritten', async () => {
  const testWorkspaceId = 'ws-test-content-review';

  const product: Product = {
    id: 'prod-content-1',
    workspace_id: testWorkspaceId,
    supplier_id: 'pluspower',
    url: 'https://example.com/content-test',
    title: 'Original Title',
    description: 'Original Description',
    price: 20.0,
    stock_quantity: 10,
    images: ['https://example.com/img1.jpg'],
    variants: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveWorkspaceProduct(testWorkspaceId, product);

  // Supplier changed title and description on their website
  const checkResult = await checkProductNow(testWorkspaceId, product.id, async () => {
    return {
      price: 20.0,
      stock_quantity: 10,
      title: 'New Supplier Title 2026',
      description: 'Brand new supplier description with extra marketing claims.',
      images: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
    };
  });

  assert.equal(checkResult.ok, true);
  // Product content must NOT be overwritten!
  assert.equal(checkResult.product?.title, 'Original Title');
  assert.equal(checkResult.product?.description, 'Original Description');

  // Change review items must be created
  const reviews = await listWorkspaceChangeReviews(testWorkspaceId, { productId: product.id });
  assert.ok(reviews.length >= 2, 'Should create review items for title and description');

  const titleReview = reviews.find((r) => r.field_name === 'title');
  assert.ok(titleReview);
  assert.equal(titleReview.old_value, 'Original Title');
  assert.equal(titleReview.new_value, 'New Supplier Title 2026');
  assert.equal(titleReview.status, 'pending');

  // Test approving the title change
  const approvalRes = await approveWorkspaceChangeReview(testWorkspaceId, titleReview.id);
  assert.equal(approvalRes.ok, true);
  assert.equal(approvalRes.review?.status, 'approved');

  // Now the product title should be updated
  const updatedProduct = await getWorkspaceProduct(testWorkspaceId, product.id);
  assert.equal(updatedProduct?.title, 'New Supplier Title 2026');
});

test('Concurrency lock prevents overlapping monitoring checks for the same product', async () => {
  const testWorkspaceId = 'ws-test-concurrency';
  const productId = 'prod-concurrent-1';

  await saveWorkspaceProduct(testWorkspaceId, {
    id: productId,
    workspace_id: testWorkspaceId,
    supplier_id: 'pluspower',
    url: 'https://example.com/slow',
    title: 'Slow Product',
    price: 10.0,
    stock_quantity: 5,
    variants: [],
    images: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Manually acquire lock as if check is ongoing
  activeMonitoringProductLocks.add(productId);

  try {
    const secondCall = await checkProductNow(testWorkspaceId, productId);
    assert.equal(secondCall.ok, false);
    assert.ok(secondCall.error?.includes('already in progress'));
  } finally {
    activeMonitoringProductLocks.delete(productId);
  }
});

test('Manual approval and rejection of price changes in workspaceStore', async () => {
  const testWorkspaceId = 'ws-test-price-approval';
  const productId = 'prod-price-app-1';

  const product: Product = {
    id: productId,
    workspace_id: testWorkspaceId,
    supplier_id: 'pluspower',
    url: 'https://example.com/price-app',
    title: 'Creatine Monohydrate',
    price: 15.0,
    calculated_selling_price: 27.90,
    stock_quantity: 20,
    variants: [],
    images: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await saveWorkspaceProduct(testWorkspaceId, product);

  // Pre-seed pending history items
  await recordWorkspacePriceChange(testWorkspaceId, {
    id: 'hist-pending-1',
    workspace_id: testWorkspaceId,
    product_id: productId,
    supplier_id: 'pluspower',
    old_price: 15.0,
    new_price: 12.0,
    old_selling_price: 27.90,
    new_selling_price: 22.90,
    change_type: 'price_decrease',
    status: 'pending_approval',
    reason: 'Price decrease',
    changed_at: new Date().toISOString(),
  });

  await recordWorkspacePriceChange(testWorkspaceId, {
    id: 'hist-pending-2',
    workspace_id: testWorkspaceId,
    product_id: productId,
    supplier_id: 'pluspower',
    old_price: 15.0,
    new_price: 13.0,
    old_selling_price: 27.90,
    new_selling_price: 24.50,
    change_type: 'price_decrease',
    status: 'pending_approval',
    reason: 'Alternative price decrease',
    changed_at: new Date().toISOString(),
  });

  // Reject the first price change
  const rejectRes = await rejectWorkspacePriceChange(
    testWorkspaceId,
    'hist-pending-1'
  );
  assert.equal(rejectRes.ok, true);
  assert.equal(rejectRes.historyItem?.status, 'rejected');

  // Verify product selling price was NOT changed
  let stored = await getWorkspaceProduct(testWorkspaceId, productId);
  assert.equal(stored?.calculated_selling_price, 27.90);

  // Now simulate an approval of the second price
  const approveRes = await approveWorkspacePriceChange(
    testWorkspaceId,
    'hist-pending-2'
  );
  assert.equal(approveRes.ok, true);
  assert.equal(approveRes.historyItem?.status, 'approved');

  // Stored product now reflects approved new selling price
  stored = await getWorkspaceProduct(testWorkspaceId, productId);
  assert.equal(stored?.calculated_selling_price, 24.50);
});

test('Workspace data isolation: notifications are isolated between workspaces', async () => {
  const ws1 = 'ws-isolation-1';
  const ws2 = 'ws-isolation-2';

  await createWorkspaceNotification(ws1, {
    product_id: 'p1',
    type: 'price_increase',
    severity: 'warning',
    title: 'WS1 Alert',
    message: 'Message 1',
  });

  await createWorkspaceNotification(ws2, {
    product_id: 'p2',
    type: 'out_of_stock',
    severity: 'error',
    title: 'WS2 Alert',
    message: 'Message 2',
  });

  const ws1Notifs = await listWorkspaceNotifications(ws1);
  const ws2Notifs = await listWorkspaceNotifications(ws2);

  assert.ok(ws1Notifs.every((n) => n.workspace_id === ws1));
  assert.ok(ws2Notifs.every((n) => n.workspace_id === ws2));
  assert.ok(!ws1Notifs.some((n) => n.title === 'WS2 Alert'));
  assert.ok(!ws2Notifs.some((n) => n.title === 'WS1 Alert'));
});
