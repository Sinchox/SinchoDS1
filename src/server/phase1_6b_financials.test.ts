import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFinancialReport } from '../utils/financials.js';
import { generateFinancialOrdersCsv } from '../utils/csv.js';
import {
  clearWorkspaceStore,
  createWorkspaceOrder,
  getWorkspaceFinancialReport,
  exportWorkspaceFinancialOrdersCsv,
} from './workspaceStore.js';
import { Order, OrderLineItem } from '../types.js';

function makeMockOrder(overrides: Partial<Order>): Order {
  const defaultItems: OrderLineItem[] = [
    {
      id: 'item-1',
      title: 'Whey Isolate 2kg',
      variant_name: 'Vaniglia',
      sku: 'WHEY-VAN-2',
      quantity: 1,
      selling_price: 59.9,
      purchase_cost: 32.0,
      supplier_id: 'pluspower',
      supplier_name: 'PlusPower Supplements',
    },
  ];

  return {
    id: overrides.id || `ord-${Math.random().toString(36).slice(2, 9)}`,
    workspace_id: overrides.workspace_id || 'ws-test',
    order_number: overrides.order_number || 'ORD-001',
    external_order_id: overrides.external_order_id || null,
    ebay_order_id: overrides.ebay_order_id || null,
    order_source: overrides.order_source || 'manual',
    buyer_username: overrides.buyer_username || 'buyer123',
    buyer_name: overrides.buyer_name || 'Mario Rossi',
    buyer_email: overrides.buyer_email || 'mario@example.com',
    buyer_phone: overrides.buyer_phone || '+393331234567',
    shipping_address: overrides.shipping_address || {
      name: 'Mario Rossi',
      address_line1: 'Via Roma 10',
      city: 'Milano',
      postal_code: '20121',
      country: 'IT',
    },
    status: overrides.status || 'delivered',
    supplier_purchasing_status: overrides.supplier_purchasing_status || 'ordered',
    delivery_status: overrides.delivery_status || 'delivered',
    items: overrides.items || defaultItems,
    currency: overrides.currency || 'EUR',
    total_paid: overrides.total_paid !== undefined ? overrides.total_paid : 59.9,
    shipping_charged_to_buyer: overrides.shipping_charged_to_buyer !== undefined ? overrides.shipping_charged_to_buyer : 0,
    supplier_shipping_cost: overrides.supplier_shipping_cost !== undefined ? overrides.supplier_shipping_cost : 4.5,
    packaging_cost: overrides.packaging_cost !== undefined ? overrides.packaging_cost : 1.5,
    estimated_ebay_fees: overrides.estimated_ebay_fees !== undefined ? overrides.estimated_ebay_fees : 7.24,
    total_cost: overrides.total_cost !== undefined ? overrides.total_cost : 38.0,
    net_profit: overrides.net_profit !== undefined ? overrides.net_profit : 14.66,
    profit_margin: overrides.profit_margin !== undefined ? overrides.profit_margin : 24.47,
    supplier_id: overrides.supplier_id || 'pluspower',
    supplier_name: overrides.supplier_name || 'PlusPower Supplements',
    supplier_order_reference: overrides.supplier_order_reference || 'SUPP-99',
    supplier_purchased_at: overrides.supplier_purchased_at || new Date().toISOString(),
    carrier: overrides.carrier || 'GLS',
    tracking_number: overrides.tracking_number || 'GLS123456',
    tracking_url: null,
    dispatched_at: overrides.dispatched_at || new Date().toISOString(),
    delivered_at: overrides.delivered_at || new Date().toISOString(),
    cancellation_reason: overrides.cancellation_reason || null,
    cancelled_at: overrides.cancelled_at || null,
    return_status: overrides.return_status || 'none',
    return_reason: null,
    returned_at: null,
    refund_amount: overrides.refund_amount !== undefined ? overrides.refund_amount : 0,
    refund_reason: null,
    refunded_at: null,
    refunds: overrides.refunds || [],
    events: [],
    notes: null,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
  };
}

test('Phase 1.6B: computeFinancialReport calculates accurate revenue, costs, fees, refunds and margins', () => {
  const refDate = new Date('2026-05-15T12:00:00Z');

  // Order 1: delivered (positive profit)
  const o1 = makeMockOrder({
    id: 'ord-1',
    created_at: '2026-05-10T10:00:00Z',
    status: 'delivered',
    total_paid: 100.0,
    supplier_shipping_cost: 5.0,
    packaging_cost: 2.0,
    estimated_ebay_fees: 11.85,
    refund_amount: 0,
    net_profit: 31.15,
    items: [
      {
        id: 'i1',
        title: 'Creatina Creapure 500g',
        variant_name: 'Neutro',
        sku: 'CREA-500',
        quantity: 2,
        selling_price: 50.0,
        purchase_cost: 25.0,
        supplier_id: 'pluspower',
        supplier_name: 'PlusPower Supplements',
      },
    ],
  });

  // Order 2: shipped (positive profit with partial refund)
  const o2 = makeMockOrder({
    id: 'ord-2',
    created_at: '2026-05-12T14:00:00Z',
    status: 'shipped',
    total_paid: 60.0,
    supplier_shipping_cost: 4.0,
    packaging_cost: 1.0,
    estimated_ebay_fees: 7.25,
    refund_amount: 10.0,
    net_profit: 7.75,
    items: [
      {
        id: 'i2',
        title: 'BCAA 8:1:1 300cpr',
        variant_name: 'Compresse',
        sku: 'BCAA-300',
        quantity: 1,
        selling_price: 60.0,
        purchase_cost: 30.0,
        supplier_id: 'pluspower',
        supplier_name: 'PlusPower Supplements',
      },
    ],
  });

  // Order 3: cancelled order (MUST NOT be included in completed revenue or net profit)
  const o3 = makeMockOrder({
    id: 'ord-3',
    created_at: '2026-05-14T09:00:00Z',
    status: 'cancelled',
    cancellation_reason: 'Buyer requested cancellation',
    cancelled_at: '2026-05-14T10:00:00Z',
    total_paid: 150.0,
    supplier_shipping_cost: 0,
    packaging_cost: 0,
    estimated_ebay_fees: 0,
    refund_amount: 150.0,
    items: [
      {
        id: 'i3',
        title: 'Mass Gainer 5kg',
        variant_name: 'Vaniglia',
        sku: 'GAIN-5K',
        quantity: 2,
        selling_price: 75.0,
        purchase_cost: 45.0,
        supplier_id: 'pluspower',
        supplier_name: 'PlusPower Supplements',
      },
    ],
  });

  const report = computeFinancialReport([o1, o2, o3], 'this_month', undefined, undefined, refDate);

  // Completed orders: o1 & o2 (total_paid: 100 + 60 = 160)
  assert.equal(report.summary.totalRevenue, 160.0);
  assert.equal(report.summary.completedOrdersCount, 2);

  // Supplier purchase costs: o1 (50.00) + o2 (30.00) = 80.00
  assert.equal(report.summary.totalSupplierCost, 80.0);

  // Supplier shipping: 5.0 + 4.0 = 9.0
  assert.equal(report.summary.supplierShippingCost, 9.0);

  // Packaging: 2.0 + 1.0 = 3.0
  assert.equal(report.summary.packagingCost, 3.0);

  // Estimated eBay fees: 11.85 + 7.25 = 19.10
  assert.equal(report.summary.estimatedEbayFees, 19.1);

  // Total refunds on completed/returned orders: 10.0
  assert.equal(report.summary.totalRefunds, 10.0);

  // Net profit = Revenue (160) - Purchase (80) - Shipping (9) - Packaging (3) - Fees (19.10) - Refunds (10)
  // 160 - 80 - 9 - 3 - 19.10 - 10 = 38.90
  assert.equal(report.summary.netProfit, 38.9);

  // Profit Margin = (38.90 / 160) * 100 = 24.31%
  assert.equal(report.summary.profitMargin, 24.31);

  // Average Order Value = 160 / 2 = 80.00
  assert.equal(report.summary.averageOrderValue, 80.0);

  // Cancellation analysis
  assert.equal(report.cancellationAnalysis.cancelledOrdersCount, 1);
  assert.equal(report.cancellationAnalysis.potentialRevenueLost, 150.0);
  assert.ok(report.cancellationAnalysis.cancellationRate > 0);
});

test('Phase 1.6B: Loss-making orders are accurately identified and isolated', () => {
  const refDate = new Date('2026-05-15T12:00:00Z');

  // Order with loss (selling price lower than cost + shipping + fees)
  const lossOrder = makeMockOrder({
    id: 'loss-1',
    order_number: 'ORD-LOSS',
    created_at: '2026-05-10T10:00:00Z',
    status: 'delivered',
    total_paid: 20.0,
    supplier_shipping_cost: 6.0,
    packaging_cost: 2.0,
    estimated_ebay_fees: 2.65,
    refund_amount: 0,
    net_profit: -5.65,
    items: [
      {
        id: 'i-loss',
        title: 'Shaker Bottle',
        variant_name: 'Nero',
        sku: 'SHK-BLK',
        quantity: 1,
        selling_price: 20.0,
        purchase_cost: 15.0,
        supplier_id: 'pluspower',
        supplier_name: 'PlusPower Supplements',
      },
    ],
  });

  const report = computeFinancialReport([lossOrder], 'this_month', undefined, undefined, refDate);

  assert.equal(report.summary.lossMakingOrdersCount, 1);
  assert.equal(report.lossMakingOrders.length, 1);
  assert.equal(report.lossMakingOrders[0].orderNumber, 'ORD-LOSS');
  assert.ok(report.lossMakingOrders[0].netLoss > 0);
  assert.ok(report.lossMakingOrders[0].lossReason.length > 0);
});

test('Phase 1.6B: Date range preset filters work correctly (today, this_week, this_month, previous_month, custom)', () => {
  const refDate = new Date('2026-05-20T12:00:00Z');

  // Today's order
  const ordToday = makeMockOrder({
    id: 'ord-today',
    created_at: '2026-05-20T08:00:00Z',
    total_paid: 50.0,
  });

  // Earlier this week
  const ordThisWeek = makeMockOrder({
    id: 'ord-week',
    created_at: '2026-05-18T10:00:00Z',
    total_paid: 70.0,
  });

  // Earlier this month
  const ordThisMonth = makeMockOrder({
    id: 'ord-month',
    created_at: '2026-05-02T10:00:00Z',
    total_paid: 100.0,
  });

  // Previous month (April 2026)
  const ordPrevMonth = makeMockOrder({
    id: 'ord-prev',
    created_at: '2026-04-15T10:00:00Z',
    total_paid: 120.0,
  });

  const allOrders = [ordToday, ordThisWeek, ordThisMonth, ordPrevMonth];

  // Test "today"
  const repToday = computeFinancialReport(allOrders, 'today', undefined, undefined, refDate);
  assert.equal(repToday.summary.completedOrdersCount, 1);
  assert.equal(repToday.summary.totalRevenue, 50.0);

  // Test "this_month"
  const repMonth = computeFinancialReport(allOrders, 'this_month', undefined, undefined, refDate);
  assert.equal(repMonth.summary.completedOrdersCount, 3);
  assert.equal(repMonth.summary.totalRevenue, 220.0);

  // Test "previous_month"
  const repPrev = computeFinancialReport(allOrders, 'previous_month', undefined, undefined, refDate);
  assert.equal(repPrev.summary.completedOrdersCount, 1);
  assert.equal(repPrev.summary.totalRevenue, 120.0);

  // Test "custom"
  const repCustom = computeFinancialReport(allOrders, 'custom', '2026-05-01', '2026-05-19', refDate);
  assert.equal(repCustom.summary.completedOrdersCount, 2);
  assert.equal(repCustom.summary.totalRevenue, 170.0);
});

test('Phase 1.6B: Best-selling and most profitable products aggregation', () => {
  const refDate = new Date('2026-05-15T12:00:00Z');

  const orderA = makeMockOrder({
    id: 'ord-a',
    created_at: '2026-05-10T10:00:00Z',
    items: [
      {
        id: 'i-a1',
        title: 'Iso Whey 90',
        variant_name: 'Cioccolato',
        sku: 'ISO-90',
        quantity: 3,
        selling_price: 40.0,
        purchase_cost: 20.0,
        supplier_id: 'pluspower',
      },
      {
        id: 'i-a2',
        title: 'Multivitaminico Daily',
        variant_name: 'Capsule',
        sku: 'MULTI-100',
        quantity: 1,
        selling_price: 15.0,
        purchase_cost: 5.0,
        supplier_id: 'pluspower',
      },
    ],
  });

  const orderB = makeMockOrder({
    id: 'ord-b',
    created_at: '2026-05-11T10:00:00Z',
    items: [
      {
        id: 'i-b1',
        title: 'Iso Whey 90',
        variant_name: 'Cioccolato',
        sku: 'ISO-90',
        quantity: 2,
        selling_price: 40.0,
        purchase_cost: 20.0,
        supplier_id: 'pluspower',
      },
    ],
  });

  const report = computeFinancialReport([orderA, orderB], 'this_month', undefined, undefined, refDate);

  // Iso Whey 90 should be #1 best seller (5 units sold, 200 EUR revenue)
  assert.ok(report.bestSellingProducts.length >= 2);
  assert.equal(report.bestSellingProducts[0].title, 'Iso Whey 90');
  assert.equal(report.bestSellingProducts[0].unitsSold, 5);
  assert.equal(report.bestSellingProducts[0].totalRevenue, 200.0);

  // Iso Whey 90 should also be top profit: 200 revenue - 100 cost - 23 ebay fee (11.5%) = 77 profit
  assert.equal(report.mostProfitableProducts[0].title, 'Iso Whey 90');
  assert.equal(report.mostProfitableProducts[0].totalProfit, 77.0);
});

test('Phase 1.6B: RFC 4180 CSV export generates clean, valid CSV records', () => {
  const o = makeMockOrder({
    id: 'csv-ord-1',
    order_number: 'ORD-CSV-TEST',
    external_order_id: 'EXT-12345',
    ebay_order_id: '20-11992-33441',
    created_at: '2026-05-15T10:30:00Z',
    status: 'delivered',
    buyer_name: 'Rossi, Mario "Special"',
    total_paid: 89.9,
    supplier_shipping_cost: 4.5,
    packaging_cost: 1.5,
    estimated_ebay_fees: 10.69,
    refund_amount: 5.0,
    net_profit: 36.21,
    profit_margin: 40.28,
    carrier: 'DHL',
    tracking_number: 'DHL987654321',
    items: [
      {
        id: 'item-1',
        title: 'Hydrolysed Protein 2kg',
        variant_name: 'Fragola',
        sku: 'HYD-FRA-2',
        quantity: 1,
        selling_price: 89.9,
        purchase_cost: 32.0,
        supplier_id: 'pluspower',
        supplier_name: 'PlusPower Supplements',
      },
    ],
  });

  const csv = generateFinancialOrdersCsv([o]);

  // Headers check (Italian localized RFC 4180 headers)
  assert.ok(csv.includes('Numero Ordine,ID Ordine Esterno,Data Ordine,Stato Ordine'));
  assert.ok(csv.includes('Ricavi Ordine (EUR)'));
  assert.ok(csv.includes('Costo Acquisto Prodotti (EUR)'));
  assert.ok(csv.includes('Spedizione Fornitore (EUR)'));
  assert.ok(csv.includes('Packaging (EUR)'));
  assert.ok(csv.includes('Commissioni eBay Stimate (EUR)'));
  assert.ok(csv.includes('Rimborsi Emessi (EUR)'));
  assert.ok(csv.includes('Utile Netto Finale (EUR)'));
  assert.ok(csv.includes('Margine Profitto %'));

  // Data row check with RFC 4180 escaping for quotes and commas
  assert.ok(csv.includes('ORD-CSV-TEST'));
  assert.ok(csv.includes('89.90'));
  assert.ok(csv.includes('32.00'));
  assert.ok(csv.includes('4.50'));
  assert.ok(csv.includes('1.50'));
  assert.ok(csv.includes('10.69'));
  assert.ok(csv.includes('5.00'));
  assert.ok(csv.includes('36.21'));
  assert.ok(csv.includes('40.28%'));
  // Escaped buyer name
  assert.ok(csv.includes('"Rossi, Mario ""Special"""'));
});

test('Phase 1.6B: Workspace isolation is strictly enforced for financial reports and CSV exports', async () => {
  clearWorkspaceStore();

  const wsAlpha = 'ws-alpha-financials';
  const wsBeta = 'ws-beta-financials';

  // Create order in Workspace Alpha
  await createWorkspaceOrder(
    wsAlpha,
    {
      order_number: 'ALPHA-ORD-1',
      buyer_name: 'Alpha Customer',
      status: 'delivered',
      total_paid: 200.0,
      supplier_shipping_cost: 10.0,
      packaging_cost: 2.0,
      estimated_ebay_fees: 23.35,
      items: [
        {
          id: 'item-alpha',
          title: 'Alpha Mass 5kg',
          variant_name: 'Default',
          sku: 'ALP-5K',
          quantity: 2,
          selling_price: 100.0,
          purchase_cost: 50.0,
          supplier_id: 'pluspower',
          supplier_name: 'PlusPower Supplements',
        },
      ],
    },
    'alpha-manager'
  );

  // Create order in Workspace Beta
  await createWorkspaceOrder(
    wsBeta,
    {
      order_number: 'BETA-ORD-1',
      buyer_name: 'Beta Customer',
      status: 'delivered',
      total_paid: 50.0,
      supplier_shipping_cost: 5.0,
      packaging_cost: 1.0,
      estimated_ebay_fees: 6.1,
      items: [
        {
          id: 'item-beta',
          title: 'Beta Amino 300g',
          variant_name: 'Default',
          sku: 'BET-300',
          quantity: 1,
          selling_price: 50.0,
          purchase_cost: 20.0,
          supplier_id: 'pluspower',
          supplier_name: 'PlusPower Supplements',
        },
      ],
    },
    'beta-manager'
  );

  // Fetch report for Alpha
  const alphaReport = await getWorkspaceFinancialReport(wsAlpha, { range: 'all' });
  assert.equal(alphaReport.summary.completedOrdersCount, 1);
  assert.equal(alphaReport.summary.totalRevenue, 200.0);
  assert.equal(alphaReport.bestSellingProducts[0].title, 'Alpha Mass 5kg');

  // Fetch report for Beta
  const betaReport = await getWorkspaceFinancialReport(wsBeta, { range: 'all' });
  assert.equal(betaReport.summary.completedOrdersCount, 1);
  assert.equal(betaReport.summary.totalRevenue, 50.0);
  assert.equal(betaReport.bestSellingProducts[0].title, 'Beta Amino 300g');

  // Export CSV for Alpha
  const alphaCsvResult = await exportWorkspaceFinancialOrdersCsv(wsAlpha, { range: 'all' });
  assert.equal(alphaCsvResult.count, 1);
  assert.ok(alphaCsvResult.csv.includes('ALPHA-ORD-1'));
  assert.ok(!alphaCsvResult.csv.includes('BETA-ORD-1'));

  // Export CSV for Beta
  const betaCsvResult = await exportWorkspaceFinancialOrdersCsv(wsBeta, { range: 'all' });
  assert.equal(betaCsvResult.count, 1);
  assert.ok(betaCsvResult.csv.includes('BETA-ORD-1'));
  assert.ok(!betaCsvResult.csv.includes('ALPHA-ORD-1'));
});
