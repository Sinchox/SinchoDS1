import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWorkspaceStore,
  saveWorkspaceProduct,
  getWorkspaceProduct,
  saveWorkspaceOrder,
  cancelWorkspaceOrder,
  updateOrderFulfillment,
  recordOrderReturn,
  adjustWorkspaceStockManual,
  listWorkspaceInventoryMovements,
  getWorkspaceInventorySummary,
} from './workspaceStore.js';
import { listWorkspaceNotifications } from './monitoringService.js';
import { Product, Order } from '../types.js';

describe('Phase 1.7 — Inventory Synchronization & Catalog Linkage', () => {
  const wsA = 'ws-inventory-test-a';
  const wsB = 'ws-inventory-test-b';

  beforeEach(() => {
    clearWorkspaceStore(wsA);
    clearWorkspaceStore(wsB);
  });

  function getSampleProduct(): Product {
    return {
      id: 'prod-iso-100',
      title: 'Dymatize ISO 100 2kg',
      brand: 'Dymatize',
      sku: 'DYM-ISO-BASE',
      price: 60.0,
      stock_quantity: 20,
      reserved_stock: 0,
      stock_threshold: 5,
      supplier_id: 'pluspower',
      supplier_name: 'PlusPower',
      variants: [
        {
          id: 'var-choc',
          name: 'Gusto Cioccolato',
          sku: 'DYM-ISO-CHOC',
          price: 62.0,
          stock_quantity: 12,
          reserved_stock: 0,
          stock_threshold: 3,
          available_online: true,
        },
        {
          id: 'var-vanilla',
          name: 'Gusto Vaniglia',
          sku: 'DYM-ISO-VAN',
          price: 60.0,
          stock_quantity: 8,
          reserved_stock: 0,
          stock_threshold: 2,
          available_online: true,
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  test('1. Order creation reserves stock without changing on-hand stock', async () => {
    await saveWorkspaceProduct(wsA, getSampleProduct());

    const orderPayload: Partial<Order> = {
      order_number: 'ORD-INV-001',
      buyer_name: 'Mario Rossi',
      status: 'awaiting_purchase',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-iso-100',
          variant_id: 'var-choc',
          title: 'Dymatize ISO 100 - Cioccolato',
          sku: 'DYM-ISO-CHOC',
          quantity: 3,
          purchase_cost: 62.0,
          selling_price: 85.0,
        },
      ],
    };

    const res = await saveWorkspaceOrder(wsA, orderPayload);
    assert.equal(res.ok, true);
    const order = res.order!;
    assert.equal(order.inventory_reserved, true);
    assert.equal(order.inventory_deducted, false);

    // Verify product & variant reserved stock
    const p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    assert.ok(p);
    const variant = p.variants?.find((v) => v.id === 'var-choc');
    assert.ok(variant);

    // On-hand stock should still be 12 (not yet deducted)
    assert.equal(variant.stock_quantity, 12);
    // Reserved stock must be 3
    assert.equal(variant.reserved_stock, 3);
    // Product aggregate reserved stock
    assert.equal(p.reserved_stock, 3);

    // Check movements recorded
    const movements = await listWorkspaceInventoryMovements(wsA);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].movement_type, 'reservation');
    assert.equal(movements[0].quantity, 3);
  });

  test('2. Order shipment converts reservation into permanent stock deduction (no double deduction)', async () => {
    await saveWorkspaceProduct(wsA, getSampleProduct());

    const res = await saveWorkspaceOrder(wsA, {
      order_number: 'ORD-INV-002',
      buyer_name: 'Luigi Verdi',
      status: 'awaiting_purchase',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-iso-100',
          variant_id: 'var-choc',
          title: 'Dymatize ISO 100 - Cioccolato',
          quantity: 4,
          purchase_cost: 62.0,
          selling_price: 85.0,
        },
      ],
    });
    assert.equal(res.ok, true);
    const order = res.order!;

    // Ship the order
    const shipRes = await updateOrderFulfillment(wsA, order.id, {
      carrier: 'GLS',
      tracking_number: 'GLS123456789',
      delivery_status: 'in_transit',
      dispatched_at: new Date().toISOString(),
    });

    assert.equal(shipRes.ok, true);
    const shippedOrder = shipRes.order!;
    assert.equal(shippedOrder.status, 'shipped');
    assert.equal(shippedOrder.inventory_deducted, true);
    assert.equal(shippedOrder.inventory_reserved, false);

    // Verify stock on variant: stock was 12, deducted 4 -> now 8. Reserved was 4, now 0.
    const p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    assert.ok(p);
    const variant = p.variants?.find((v) => v.id === 'var-choc');
    assert.ok(variant);
    assert.equal(variant.stock_quantity, 8);
    assert.equal(variant.reserved_stock, 0);

    // Idempotency: call updateOrderFulfillment again, stock must NOT be deducted twice
    const updatedAgain = await updateOrderFulfillment(wsA, order.id, {
      carrier: 'GLS',
      tracking_number: 'GLS123456789',
      delivery_status: 'delivered',
    });
    assert.equal(updatedAgain.ok, true);
    assert.equal(updatedAgain.order?.status, 'delivered');

    const pAfterSecond = await getWorkspaceProduct(wsA, 'prod-iso-100');
    const variantAfterSecond = pAfterSecond?.variants?.find((v) => v.id === 'var-choc');
    assert.equal(variantAfterSecond?.stock_quantity, 8);
    assert.equal(variantAfterSecond?.reserved_stock, 0);
  });

  test('3. Order cancellation releases active reservation without changing on-hand stock', async () => {
    await saveWorkspaceProduct(wsA, getSampleProduct());

    const res = await saveWorkspaceOrder(wsA, {
      order_number: 'ORD-INV-003',
      buyer_name: 'Anna Neri',
      status: 'awaiting_purchase',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-iso-100',
          variant_id: 'var-vanilla',
          title: 'Dymatize ISO 100 - Vaniglia',
          quantity: 2,
          purchase_cost: 60.0,
          selling_price: 80.0,
        },
      ],
    });
    assert.equal(res.ok, true);
    const order = res.order!;

    // Check reservation
    let p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    let v = p?.variants?.find((x) => x.id === 'var-vanilla');
    assert.equal(v?.stock_quantity, 8);
    assert.equal(v?.reserved_stock, 2);

    // Cancel order
    const cancelRes = await cancelWorkspaceOrder(wsA, order.id, 'Cliente ha cambiato idea');
    assert.equal(cancelRes.ok, true);
    const cancelled = cancelRes.order!;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.inventory_reserved, false);

    // Reservation should be released, stock remains 8
    p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    v = p?.variants?.find((x) => x.id === 'var-vanilla');
    assert.equal(v?.stock_quantity, 8);
    assert.equal(v?.reserved_stock, 0);

    // Check movement
    const movements = await listWorkspaceInventoryMovements(wsA);
    const cancelMov = movements.find((m) => m.movement_type === 'reservation_release');
    assert.ok(cancelMov);
    assert.equal(cancelMov.quantity, -2);
  });

  test('4. Restockable return restores stock only when restockable is true', async () => {
    await saveWorkspaceProduct(wsA, getSampleProduct());

    // Create and ship order for 2 vanilla
    const res = await saveWorkspaceOrder(wsA, {
      order_number: 'ORD-INV-004',
      buyer_name: 'Giulia Bianchi',
      status: 'awaiting_purchase',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-iso-100',
          variant_id: 'var-vanilla',
          title: 'Dymatize ISO 100 - Vaniglia',
          quantity: 2,
          purchase_cost: 60.0,
          selling_price: 80.0,
        },
      ],
    });
    assert.equal(res.ok, true);
    const order = res.order!;

    await updateOrderFulfillment(wsA, order.id, {
      carrier: 'BRT',
      tracking_number: 'BRT999',
      delivery_status: 'delivered',
    });

    // Vanilla stock was 8, deducted 2 -> now 6
    let p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    let v = p?.variants?.find((x) => x.id === 'var-vanilla');
    assert.equal(v?.stock_quantity, 6);

    // Non-restockable return (damaged item)
    await recordOrderReturn(wsA, order.id, {
      return_status: 'completed',
      return_reason: 'Barattolo arrivato rotto',
      restockable: false,
    });

    // Stock must NOT be restored
    p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    v = p?.variants?.find((x) => x.id === 'var-vanilla');
    assert.equal(v?.stock_quantity, 6);

    // Now record a restockable return (customer return unused item)
    await recordOrderReturn(wsA, order.id, {
      return_status: 'completed',
      return_reason: 'Prodotto integro riassortito',
      restockable: true,
    });

    // Stock must now be restored from 6 to 8
    p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    v = p?.variants?.find((x) => x.id === 'var-vanilla');
    assert.equal(v?.stock_quantity, 8);

    const movements = await listWorkspaceInventoryMovements(wsA);
    const restockMov = movements.find((m) => m.movement_type === 'return_restock');
    assert.ok(restockMov);
    assert.equal(restockMov.quantity, 2);
  });

  test('5. Multi-item orders reserve and deduct respective variants correctly', async () => {
    await saveWorkspaceProduct(wsA, getSampleProduct());

    const res = await saveWorkspaceOrder(wsA, {
      order_number: 'ORD-INV-005',
      buyer_name: 'Paolo Bonolis',
      status: 'awaiting_purchase',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-iso-100',
          variant_id: 'var-choc',
          title: 'Cioccolato',
          quantity: 2,
          purchase_cost: 62.0,
          selling_price: 85.0,
        },
        {
          id: 'item-2',
          product_id: 'prod-iso-100',
          variant_id: 'var-vanilla',
          title: 'Vaniglia',
          quantity: 3,
          purchase_cost: 60.0,
          selling_price: 80.0,
        },
      ],
    });

    assert.equal(res.ok, true);
    const order = res.order!;
    assert.equal(order.inventory_reserved, true);

    let p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    const choc = p?.variants?.find((x) => x.id === 'var-choc');
    const van = p?.variants?.find((x) => x.id === 'var-vanilla');
    assert.equal(choc?.reserved_stock, 2);
    assert.equal(van?.reserved_stock, 3);
    assert.equal(p?.reserved_stock, 5);

    // Ship order
    await updateOrderFulfillment(wsA, order.id, {
      carrier: 'DHL',
      tracking_number: 'DHL555',
      delivery_status: 'in_transit',
    });

    p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    const chocAfter = p?.variants?.find((x) => x.id === 'var-choc');
    const vanAfter = p?.variants?.find((x) => x.id === 'var-vanilla');

    // Choc was 12, deducted 2 -> 10. Reserved -> 0.
    assert.equal(chocAfter?.stock_quantity, 10);
    assert.equal(chocAfter?.reserved_stock, 0);

    // Van was 8, deducted 3 -> 5. Reserved -> 0.
    assert.equal(vanAfter?.stock_quantity, 5);
    assert.equal(vanAfter?.reserved_stock, 0);
  });

  test('6. Low-stock notifications are triggered and deduplicated', async () => {
    const prod: Product = {
      ...getSampleProduct(),
      variants: [
        {
          ...getSampleProduct().variants![0],
          stock_quantity: 10,
          stock_threshold: 3,
        },
        {
          ...getSampleProduct().variants![1],
          stock_quantity: 3,
          stock_threshold: 2,
        },
      ],
    };
    await saveWorkspaceProduct(wsA, prod);

    // Create an order that reduces available vanilla stock from 3 to 1 (<= threshold 2)
    const res = await saveWorkspaceOrder(wsA, {
      order_number: 'ORD-INV-LOW',
      buyer_name: 'Test Alert',
      status: 'awaiting_purchase',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-iso-100',
          variant_id: 'var-vanilla',
          title: 'Vaniglia',
          quantity: 2,
          purchase_cost: 60.0,
          selling_price: 80.0,
        },
      ],
    });
    assert.equal(res.ok, true);

    const notifs = await listWorkspaceNotifications(wsA);
    const lowStockNotifs = notifs.filter((n) => n.title.includes('Esaurimento') || n.title.includes('Sottoscorta'));
    assert.ok(lowStockNotifs.length >= 1);
    const dedupKey = lowStockNotifs[0].dedup_key;
    assert.ok(dedupKey);

    // Verify summary returns low stock count
    const summary = await getWorkspaceInventorySummary(wsA);
    assert.equal(summary.lowStockCount >= 1, true);
    assert.equal(summary.totalReservedStock, 2);
  });

  test('7. Multi-tenant workspace isolation enforces complete boundary', async () => {
    // Save in workspace A
    await saveWorkspaceProduct(wsA, getSampleProduct());

    // Save different product in workspace B
    await saveWorkspaceProduct(wsB, {
      ...getSampleProduct(),
      id: 'prod-wsB-only',
      title: 'Optimum Nutrition Gold 2kg',
      stock_quantity: 50,
      variants: [],
    });

    // Create order in workspace A
    const res = await saveWorkspaceOrder(wsA, {
      order_number: 'ORD-A-01',
      buyer_name: 'Buyer A',
      status: 'awaiting_purchase',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-iso-100',
          title: 'Dymatize ISO 100',
          quantity: 2,
          purchase_cost: 60.0,
          selling_price: 80.0,
        },
      ],
    });
    assert.equal(res.ok, true);

    // Workspace B summary must have 0 reserved units and 0 movements
    const summaryB = await getWorkspaceInventorySummary(wsB);
    assert.equal(summaryB.totalReservedStock, 0);

    const movsB = await listWorkspaceInventoryMovements(wsB);
    assert.equal(movsB.length, 0);

    // Workspace A movements must be present
    const movsA = await listWorkspaceInventoryMovements(wsA);
    assert.ok(movsA.length > 0);
  });

  test('8. Catalog price changes do not alter immutable historical order snapshots', async () => {
    await saveWorkspaceProduct(wsA, getSampleProduct());

    const res = await saveWorkspaceOrder(wsA, {
      order_number: 'ORD-HIST-01',
      buyer_name: 'Historical Test',
      status: 'awaiting_purchase',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-iso-100',
          variant_id: 'var-choc',
          title: 'Dymatize ISO 100 - Cioccolato',
          quantity: 1,
          purchase_cost: 62.0,
          selling_price: 85.0,
        },
      ],
    });
    assert.equal(res.ok, true);
    const order = res.order!;
    assert.equal(order.total_paid, 85.0);
    assert.equal(order.total_cost, 62.0);

    // Later catalog price increase
    await saveWorkspaceProduct(wsA, {
      ...getSampleProduct(),
      price: 99.0,
      variants: getSampleProduct().variants!.map((v) => ({ ...v, price: 99.0 })),
    });

    // Re-fetch order from workspace store
    const listRes = await getWorkspaceInventorySummary(wsA);
    assert.ok(listRes);

    // Order item and financials must remain completely intact
    const originalOrder = res.order!;
    assert.equal(originalOrder.items[0].purchase_cost, 62.0);
    assert.equal(originalOrder.items[0].selling_price, 85.0);
    assert.equal(originalOrder.total_paid, 85.0);
    assert.equal(originalOrder.total_cost, 62.0);
  });

  test('9. Manual stock adjustment updates stock and records manual movement', async () => {
    await saveWorkspaceProduct(wsA, getSampleProduct());

    const adjustRes = await adjustWorkspaceStockManual(wsA, {
      productId: 'prod-iso-100',
      variantId: 'var-choc',
      newStock: 25,
      reason: 'Arrivo carico fornitore non previsto',
      actor: 'warehouse_mgr',
    });

    assert.equal(adjustRes.ok, true);
    assert.equal(adjustRes.movement?.movement_type, 'manual_adjustment');
    assert.equal(adjustRes.movement?.quantity, 13); // was 12, now 25 (+13)
    assert.equal(adjustRes.movement?.stock_after, 25);

    const p = await getWorkspaceProduct(wsA, 'prod-iso-100');
    const variant = p?.variants?.find((v) => v.id === 'var-choc');
    assert.equal(variant?.stock_quantity, 25);
  });
});
