import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderFinancials } from '../utils/pricing.js';
import {
  clearWorkspaceStore,
  listWorkspaceOrders,
  getWorkspaceOrder,
  saveWorkspaceOrder,
  createWorkspaceOrder,
  cancelWorkspaceOrder,
  updateOrderFulfillment,
  updateOrderSupplierPurchase,
  recordOrderReturn,
  recordOrderRefund,
  deleteWorkspaceOrder,
  getWorkspaceOrderSummaryStats,
} from './workspaceStore.js';
import {
  clearInMemoryMemberships,
  hasMinimumRole,
} from './workspaceMiddleware.js';
import { Order, OrderLineItem } from '../types.js';

test('Phase 1.6A: calculateOrderFinancials accurately computes revenue, costs, fees, refunds and net profit', () => {
  const items: OrderLineItem[] = [
    {
      id: 'item-1',
      title: 'Whey Protein 2kg',
      variant_name: 'Cioccolato',
      sku: 'WHEY-CHOC',
      quantity: 2,
      selling_price: 39.9, // 79.80
      purchase_cost: 24.5, // 49.00
      supplier_id: 'pluspower',
    },
    {
      id: 'item-2',
      title: 'BCAA 500g',
      variant_name: 'Neutro',
      sku: 'BCAA-500',
      quantity: 1,
      selling_price: 19.9, // 19.90
      purchase_cost: 11.2, // 11.20
      supplier_id: 'pluspower',
    },
  ];

  // Total items revenue = 79.80 + 19.90 = 99.70
  // Shipping charged to buyer = 4.90
  // Total paid = 99.70 + 4.90 = 104.60
  // Total purchase cost = 49.00 + 11.20 = 60.20
  // Supplier shipping = 5.00, packaging = 1.50
  // Total cost = 60.20 + 5.00 + 1.50 = 66.70
  // Estimated eBay fee = (104.60 * 11.5%) + 0.35 = 12.029 + 0.35 = 12.379 -> 12.38
  // Net profit = 104.60 - 66.70 - 12.38 = 25.52
  // Profit margin = (25.52 / 104.60) * 100 = 24.397% -> 24.4%

  const fin = calculateOrderFinancials({
    items,
    shippingChargedToBuyer: 4.9,
    supplierShippingCost: 5.0,
    packagingCost: 1.5,
  });

  assert.equal(fin.total_revenue, 104.6);
  assert.equal(fin.total_supplier_cost, 60.2);
  assert.equal(fin.total_cost, 66.7);
  assert.equal(fin.estimated_ebay_fees, 12.38);
  assert.equal(fin.refunds_amount, 0);
  assert.equal(fin.net_profit, 25.52);
  assert.equal(fin.profit_margin, 24.4);

  // When refund is applied:
  const finWithRefund = calculateOrderFinancials({
    items,
    shippingChargedToBuyer: 4.9,
    supplierShippingCost: 5.0,
    packagingCost: 1.5,
    refunds: [{ amount: 15.0, reason: 'Parziale - ritardo', timestamp: new Date().toISOString() }],
  });

  assert.equal(finWithRefund.refunds_amount, 15.0);
  // Net profit decreases by 15.0: 25.52 - 15.0 = 10.52
  assert.equal(finWithRefund.net_profit, 10.52);
  assert.equal(finWithRefund.profit_margin, 10.06);
});

test('Phase 1.6A: Manual order creation with line items, variants, and event history', async () => {
  clearWorkspaceStore();
  const wsId = 'ws-orders-1';

  const orderData: Partial<Order> = {
    order_number: 'ORD-2026-9001',
    external_order_id: 'EXT-9001',
    order_source: 'manual',
    status: 'pending',
    buyer_name: 'Mario Rossi',
    buyer_email: 'mario.rossi@example.it',
    shipping_address: {
      name: 'Mario Rossi',
      address_line1: 'Via Roma 10',
      city: 'Torino',
      postal_code: '10121',
      country: 'Italia',
    },
    items: [
      {
        id: 'li-1',
        title: 'Creatina Micronizzata 300g',
        variant_name: 'Neutro',
        sku: 'CREA-300G',
        quantity: 2,
        purchase_cost: 12.0,
        selling_price: 24.0,
        supplier_id: 'pluspower',
        supplier_name: 'PlusPower Supplements',
      },
    ],
    shipping_charged_to_buyer: 3.99,
    supplier_shipping_cost: 2.5,
    packaging_cost: 0.5,
  };

  const res = await createWorkspaceOrder(wsId, orderData, 'user-admin');
  assert.equal(res.ok, true);
  assert.ok(res.order);

  const created = res.order;
  assert.ok(created.id);
  assert.equal(created.order_number, 'ORD-2026-9001');
  assert.equal(created.external_order_id, 'EXT-9001');
  assert.equal(created.status, 'pending');
  assert.equal(created.delivery_status, 'unfulfilled');
  assert.equal(created.supplier_purchasing_status, 'not_purchased');
  assert.equal(created.items.length, 1);
  assert.equal(created.items[0].sku, 'CREA-300G');

  // Verify financial auto-calculation
  // total paid = (24 * 2) + 3.99 = 51.99
  // total cost = (12 * 2) + 2.5 + 0.5 = 27.00
  // ebay fee = (51.99 * 0.115) + 0.35 = 5.97885 + 0.35 = 6.32885 -> 6.33
  // net profit = 51.99 - 27.00 - 6.33 = 18.66
  assert.equal(created.total_paid, 51.99);
  assert.equal(created.total_cost, 27.0);
  assert.equal(created.estimated_ebay_fees, 6.33);
  assert.equal(created.net_profit, 18.66);

  // Verify initial event history
  assert.ok(created.events && created.events.length >= 1);
  assert.equal(created.events![0].event_type, 'created');
  assert.equal(created.events![0].actor, 'user-admin');
});

test('Phase 1.6A: Duplicate external_order_id within same workspace is rejected', async () => {
  clearWorkspaceStore();
  const wsId = 'ws-orders-dup';

  const first = await createWorkspaceOrder(wsId, {
    order_number: 'ORD-DUP-1',
    external_order_id: 'EXT-UNIQUE-100',
    buyer_name: 'Buyer 1',
    items: [{ id: '1', title: 'Product 1', quantity: 1, purchase_cost: 10, selling_price: 20 }],
  });
  assert.equal(first.ok, true);

  // Attempting to create another order with the same external_order_id in wsId must fail
  const duplicate = await createWorkspaceOrder(wsId, {
    order_number: 'ORD-DUP-2',
    external_order_id: 'EXT-UNIQUE-100',
    buyer_name: 'Buyer 2',
    items: [{ id: '2', title: 'Product 2', quantity: 1, purchase_cost: 15, selling_price: 30 }],
  });

  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.error?.includes('Duplicate external order ID'));
});

test('Phase 1.6A: Same external_order_id allowed across different workspaces', async () => {
  clearWorkspaceStore();
  const wsA = 'ws-company-a';
  const wsB = 'ws-company-b';

  const resA = await createWorkspaceOrder(wsA, {
    order_number: 'ORD-WS-A',
    external_order_id: 'EXT-SHARED-ID-999',
    buyer_name: 'Buyer in WS A',
    items: [{ id: '1', title: 'Product A', quantity: 1, purchase_cost: 10, selling_price: 20 }],
  });

  const resB = await createWorkspaceOrder(wsB, {
    order_number: 'ORD-WS-B',
    external_order_id: 'EXT-SHARED-ID-999',
    buyer_name: 'Buyer in WS B',
    items: [{ id: '2', title: 'Product B', quantity: 1, purchase_cost: 12, selling_price: 24 }],
  });

  assert.equal(resA.ok, true);
  assert.equal(resB.ok, true);
  assert.ok(resA.order?.id);
  assert.ok(resB.order?.id);
  assert.notEqual(resA.order?.id, resB.order?.id);
  assert.equal(resA.order?.external_order_id, 'EXT-SHARED-ID-999');
  assert.equal(resB.order?.external_order_id, 'EXT-SHARED-ID-999');
});

test('Phase 1.6A: Order lifecycle transitions, supplier purchasing, fulfillment, and event tracking', async () => {
  clearWorkspaceStore();
  const wsId = 'ws-lifecycle';

  // 1. Create order
  const createRes = await createWorkspaceOrder(wsId, {
    order_number: 'ORD-LC-01',
    buyer_name: 'Giuseppe Verdi',
    items: [
      {
        id: 'li-lc-1',
        title: 'Proteine Isolate 1kg',
        quantity: 1,
        purchase_cost: 30.0,
        selling_price: 50.0,
        supplier_id: 'pluspower',
      },
    ],
  });

  assert.equal(createRes.ok, true);
  const order = createRes.order!;
  assert.equal(order.status, 'pending');

  // 2. Update supplier purchase
  const purchaseRes = await updateOrderSupplierPurchase(
    wsId,
    order.id,
    {
      supplier_order_reference: 'SUP-REF-8841',
      supplier_purchasing_status: 'ordered',
      supplier_cost: 32.0, // adjusted supplier invoice cost
    },
    'operator-1'
  );

  assert.equal(purchaseRes.ok, true);
  const purchased = purchaseRes.order!;
  assert.equal(purchased.supplier_order_reference, 'SUP-REF-8841');
  assert.equal(purchased.supplier_purchasing_status, 'ordered');
  assert.equal(purchased.status, 'purchased');
  assert.ok(purchased.events!.some((e) => e.event_type === 'supplier_updated'));

  // 3. Update fulfillment with carrier and tracking
  const fulfillRes = await updateOrderFulfillment(
    wsId,
    order.id,
    {
      carrier: 'BRT',
      tracking_number: 'BRT1234567890IT',
      delivery_status: 'in_transit',
    },
    'fulfillment-agent'
  );

  assert.equal(fulfillRes.ok, true);
  const fulfilled = fulfillRes.order!;
  assert.equal(fulfilled.carrier, 'BRT');
  assert.equal(fulfilled.tracking_number, 'BRT1234567890IT');
  assert.equal(fulfilled.delivery_status, 'in_transit');
  assert.equal(fulfilled.status, 'shipped');
  assert.ok(fulfilled.dispatched_at);
  assert.ok(fulfilled.events!.some((e) => e.event_type === 'tracking_added' || e.event_type === 'fulfillment_updated'));

  // 4. Mark as delivered
  const deliverRes = await updateOrderFulfillment(
    wsId,
    order.id,
    {
      carrier: 'BRT',
      tracking_number: 'BRT1234567890IT',
      delivery_status: 'delivered',
    },
    'system-webhook'
  );

  assert.equal(deliverRes.ok, true);
  const delivered = deliverRes.order!;
  assert.equal(delivered.delivery_status, 'delivered');
  assert.equal(delivered.status, 'delivered');
  assert.ok(delivered.delivered_at);
  assert.ok(delivered.events!.some((e) => e.event_type === 'delivered'));
});

test('Phase 1.6A: Order returns and refunds logging recalculates profit and updates audit history', async () => {
  clearWorkspaceStore();
  const wsId = 'ws-refunds';

  const createRes = await createWorkspaceOrder(wsId, {
    order_number: 'ORD-REF-01',
    buyer_name: 'Anna Neri',
    items: [
      {
        id: 'li-r-1',
        title: 'Omega 3 120 softgels',
        quantity: 2,
        purchase_cost: 10.0,
        selling_price: 25.0,
      },
    ],
  });

  assert.equal(createRes.ok, true);
  const order = createRes.order!;

  // initial net profit:
  // rev: 50.0, cost: 20.0, ebay fee: (50 * 0.115) + 0.35 = 6.10, profit = 50 - 20 - 6.10 = 23.90
  assert.equal(order.net_profit, 23.9);

  // 1. Record return request
  const returnRes = await recordOrderReturn(
    wsId,
    order.id,
    {
      return_reason: 'Prodotto non conforme alle aspettative',
      restock_items: true,
    },
    'support-rep'
  );

  assert.equal(returnRes.ok, true);
  const returned = returnRes.order!;
  assert.equal(returned.return_status, 'requested');
  assert.equal(returned.status, 'returned');
  assert.ok(returned.events!.some((e) => e.event_type === 'return_requested'));

  // 2. Record partial refund
  const refundRes = await recordOrderRefund(
    wsId,
    order.id,
    {
      amount: 15.0,
      reason: 'Rimborso parziale concordato col cliente',
    },
    'support-rep'
  );

  assert.equal(refundRes.ok, true);
  const refunded = refundRes.order!;
  assert.equal(refunded.refunds?.length, 1);
  assert.equal(refunded.refunds?.[0].amount, 15.0);
  assert.equal(refunded.refund_amount, 15.0);
  // Net profit must decrease by 15.0: 23.90 - 15.0 = 8.90
  assert.equal(refunded.net_profit, 8.9);
  assert.ok(refunded.events!.some((e) => e.event_type === 'refund_issued'));
});

test('Phase 1.6A: Order cancellation requires reason and updates status and event log', async () => {
  clearWorkspaceStore();
  const wsId = 'ws-cancel';

  const createRes = await createWorkspaceOrder(wsId, {
    order_number: 'ORD-CANCEL-01',
    buyer_name: 'Marco Gialli',
    items: [{ id: '1', title: 'Articolo', quantity: 1, purchase_cost: 10, selling_price: 20 }],
  });

  assert.equal(createRes.ok, true);
  const order = createRes.order!;
  assert.equal(order.status, 'pending');

  // Cancellation without reason must fail
  const emptyCancel = await cancelWorkspaceOrder(wsId, order.id, '', 'admin');
  assert.equal(emptyCancel.ok, false);
  assert.ok(emptyCancel.error?.includes('reason'));

  // Cancellation with valid reason
  const cancelRes = await cancelWorkspaceOrder(
    wsId,
    order.id,
    'Cliente ha richiesto annullamento per acquisto errato',
    'admin'
  );

  assert.equal(cancelRes.ok, true);
  const cancelled = cancelRes.order!;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellation_reason, 'Cliente ha richiesto annullamento per acquisto errato');
  assert.ok(cancelled.cancelled_at);
  assert.ok(cancelled.events!.some((e) => e.event_type === 'cancelled'));
});

test('Phase 1.6A: Order filtering and dashboard summary stats', async () => {
  clearWorkspaceStore();
  const wsId = 'ws-filters';

  // Seed 4 orders with different statuses and suppliers
  await createWorkspaceOrder(wsId, {
    order_number: 'ORD-F1',
    status: 'pending',
    supplier_id: 'pluspower',
    supplier_purchasing_status: 'not_purchased',
    delivery_status: 'unfulfilled',
    buyer_name: 'User 1',
    items: [{ id: '1', title: 'Item 1', quantity: 1, purchase_cost: 10, selling_price: 25 }],
  });

  await createWorkspaceOrder(wsId, {
    order_number: 'ORD-F2',
    status: 'awaiting_dispatch',
    supplier_id: 'pluspower',
    supplier_purchasing_status: 'ordered',
    delivery_status: 'unfulfilled',
    buyer_name: 'User 2',
    items: [{ id: '2', title: 'Item 2', quantity: 1, purchase_cost: 20, selling_price: 40 }],
  });

  await createWorkspaceOrder(wsId, {
    order_number: 'ORD-F3',
    status: 'shipped',
    supplier_id: 'other_supplier',
    supplier_purchasing_status: 'confirmed',
    delivery_status: 'in_transit',
    buyer_name: 'User 3',
    carrier: 'GLS',
    tracking_number: 'GLS999',
    items: [{ id: '3', title: 'Item 3', quantity: 1, purchase_cost: 15, selling_price: 35 }],
  });

  await createWorkspaceOrder(wsId, {
    order_number: 'ORD-F4',
    status: 'returned',
    supplier_id: 'pluspower',
    supplier_purchasing_status: 'confirmed',
    delivery_status: 'returned',
    buyer_name: 'User 4',
    return_status: 'completed',
    items: [{ id: '4', title: 'Item 4', quantity: 1, purchase_cost: 30, selling_price: 60 }],
  });

  // Test status filter
  const pendingOrders = await listWorkspaceOrders(wsId, { status: 'pending' });
  assert.equal(pendingOrders.length, 1);
  assert.equal(pendingOrders[0].order_number, 'ORD-F1');

  // Test supplier filter
  const plusOrders = await listWorkspaceOrders(wsId, { supplierId: 'pluspower' });
  assert.equal(plusOrders.length, 3);

  // Test delivery status filter
  const inTransitOrders = await listWorkspaceOrders(wsId, { deliveryStatus: 'in_transit' });
  assert.equal(inTransitOrders.length, 1);
  assert.equal(inTransitOrders[0].order_number, 'ORD-F3');

  // Test Summary Stats
  const stats = await getWorkspaceOrderSummaryStats(wsId);
  assert.equal(stats.total_orders, 4);
  assert.equal(stats.pending_orders, 1);
  assert.equal(stats.awaiting_supplier_purchase, 1); // ORD-F1 is not_purchased
  assert.equal(stats.awaiting_dispatch, 1); // ORD-F2
  assert.equal(stats.shipped_orders, 1); // ORD-F3
  assert.equal(stats.returned_orders, 1); // ORD-F4
  assert.ok(stats.total_revenue! > 0);
  assert.ok(stats.total_net_profit! > 0);
});

test('Phase 1.6A: Cross-workspace order isolation', async () => {
  clearWorkspaceStore();
  const wsAlpha = 'ws-alpha';
  const wsBeta = 'ws-beta';

  const createRes = await createWorkspaceOrder(wsAlpha, {
    order_number: 'ORD-ALPHA-101',
    buyer_name: 'Alpha Customer',
    items: [{ id: '1', title: 'Item Alpha', quantity: 1, purchase_cost: 10, selling_price: 20 }],
  });

  assert.equal(createRes.ok, true);
  const orderAlpha = createRes.order!;

  // Verify listWorkspaceOrders isolates completely
  const listBeta = await listWorkspaceOrders(wsBeta);
  assert.equal(listBeta.length, 0);

  // Beta cannot fetch Alpha order
  const fetchBeta = await getWorkspaceOrder(wsBeta, orderAlpha.id);
  assert.equal(fetchBeta, null);

  // Beta cannot update fulfillment of Alpha order
  const updateBeta = await updateOrderFulfillment(wsBeta, orderAlpha.id, { carrier: 'DHL', tracking_number: '123' });
  assert.equal(updateBeta.ok, false);
  assert.ok(updateBeta.error?.includes('not found'));

  // Beta cannot cancel Alpha order
  const cancelBeta = await cancelWorkspaceOrder(wsBeta, orderAlpha.id, 'Illegal cross-workspace cancellation');
  assert.equal(cancelBeta.ok, false);
  assert.ok(cancelBeta.error?.includes('not found'));

  // Beta cannot delete Alpha order
  const deletedByBeta = await deleteWorkspaceOrder(wsBeta, orderAlpha.id);
  assert.equal(deletedByBeta, false);

  // Alpha order remains intact
  const fetchAlpha = await getWorkspaceOrder(wsAlpha, orderAlpha.id);
  assert.ok(fetchAlpha);
  assert.equal(fetchAlpha.status, 'pending');
});

test('Phase 1.6A: RBAC enforcement on order operations (viewer vs manager vs admin)', () => {
  // 1. Reading / filtering orders requires viewer (accessible to all roles)
  assert.equal(hasMinimumRole('viewer', 'viewer'), true);
  assert.equal(hasMinimumRole('manager', 'viewer'), true);
  assert.equal(hasMinimumRole('admin', 'viewer'), true);
  assert.equal(hasMinimumRole('owner', 'viewer'), true);

  // 2. Order creation, updates, fulfillment, returns, refunds, cancellations require manager
  assert.equal(hasMinimumRole('viewer', 'manager'), false); // viewer blocked
  assert.equal(hasMinimumRole('manager', 'manager'), true);  // manager allowed
  assert.equal(hasMinimumRole('admin', 'manager'), true);    // admin allowed
  assert.equal(hasMinimumRole('owner', 'manager'), true);    // owner allowed

  // 3. Deleting an order requires admin
  assert.equal(hasMinimumRole('viewer', 'admin'), false);   // viewer blocked
  assert.equal(hasMinimumRole('manager', 'admin'), false);  // manager blocked
  assert.equal(hasMinimumRole('admin', 'admin'), true);     // admin allowed
  assert.equal(hasMinimumRole('owner', 'admin'), true);     // owner allowed
});
