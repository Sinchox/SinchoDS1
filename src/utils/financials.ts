import {
  Order,
  DateRangePreset,
  FinancialReport,
  FinancialSummary,
  FinancialTrendItem,
  ProductPerformanceItem,
  SupplierCostBreakdown,
  LossMakingOrder,
  CancellationAnalysis,
  CancellationReasonBreakdown,
  FinancialComparisonPeriod,
  FinancialDateRange,
} from '../types.js';

/**
 * Calculates start and end timestamps for financial date presets.
 */
export function getDateRangeBoundaries(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  referenceDate: Date = new Date()
): { startDate: Date; endDate: Date; label: string } {
  const ref = new Date(referenceDate);

  switch (preset) {
    case 'today': {
      const startDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
      const endDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
      return { startDate, endDate, label: 'Oggi' };
    }
    case 'this_week': {
      // European week starts on Monday
      const day = ref.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      const startDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + diffToMonday, 0, 0, 0, 0);
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 6, 23, 59, 59, 999);
      return { startDate, endDate, label: 'Questa Settimana' };
    }
    case 'this_month': {
      const startDate = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
      const endDate = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
      return { startDate, endDate, label: 'Questo Mese' };
    }
    case 'previous_month': {
      const startDate = new Date(ref.getFullYear(), ref.getMonth() - 1, 1, 0, 0, 0, 0);
      const endDate = new Date(ref.getFullYear(), ref.getMonth(), 0, 23, 59, 59, 999);
      return { startDate, endDate, label: 'Mese Scorso' };
    }
    case 'custom': {
      let startDate: Date;
      let endDate: Date;
      if (customStart) {
        startDate = new Date(customStart);
        startDate.setHours(0, 0, 0, 0);
      } else {
        startDate = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
      }
      if (customEnd) {
        endDate = new Date(customEnd);
        endDate.setHours(23, 59, 59, 999);
      } else {
        endDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
      }
      return {
        startDate,
        endDate,
        label: `Personalizzato (${startDate.toISOString().slice(0, 10)} - ${endDate.toISOString().slice(0, 10)})`,
      };
    }
    case 'all':
    default: {
      const startDate = new Date('2020-01-01T00:00:00.000Z');
      const endDate = new Date(ref.getFullYear() + 2, 11, 31, 23, 59, 59, 999);
      return { startDate, endDate, label: 'Tutti i Dati' };
    }
  }
}

/**
 * Core Financial Analytics Calculation Engine
 * Strictly follows actual stored values without fabricating missing numbers.
 * Excludes cancelled orders from completed revenue and profits.
 */
export function computeFinancialReport(
  orders: Order[],
  rangePreset: DateRangePreset = 'this_month',
  customStart?: string,
  customEnd?: string,
  referenceDate: Date = new Date()
): FinancialReport {
  const { startDate, endDate, label } = getDateRangeBoundaries(
    rangePreset,
    customStart,
    customEnd,
    referenceDate
  );

  const startTime = startDate.getTime();
  const endTime = endDate.getTime();

  // 1. Filter orders strictly in date range
  const scopedOrders = orders.filter((o) => {
    const orderTime = new Date(o.created_at).getTime();
    return orderTime >= startTime && orderTime <= endTime;
  });

  // 2. Separate completed/active orders from cancelled orders
  const cancelledOrders: Order[] = [];
  const completedOrders: Order[] = [];

  for (const o of scopedOrders) {
    if (o.status === 'cancelled') {
      cancelledOrders.push(o);
    } else {
      completedOrders.push(o);
    }
  }

  // 3. Summaries
  let totalRevenue = 0;
  let totalSupplierCost = 0;
  let shippingChargedToBuyer = 0;
  let supplierShippingCost = 0;
  let packagingCost = 0;
  let estimatedEbayFees = 0;
  let totalRefunds = 0;
  let netProfit = 0;

  for (const o of completedOrders) {
    totalRevenue += Number(o.total_paid) || 0;
    shippingChargedToBuyer += Number(o.shipping_charged_to_buyer) || 0;
    supplierShippingCost += Number(o.supplier_shipping_cost) || 0;
    packagingCost += Number(o.packaging_cost) || 0;
    estimatedEbayFees += Number(o.estimated_ebay_fees) || 0;
    totalRefunds += Number(o.refund_amount) || 0;
    netProfit += Number(o.net_profit) || 0;

    // Line items purchase costs
    if (Array.isArray(o.items)) {
      for (const item of o.items) {
        const qty = Math.max(1, Number(item.quantity) || 1);
        const itemCost = Number(item.purchase_cost ?? item.supplier_cost) || 0;
        totalSupplierCost += itemCost * qty;
      }
    }
  }

  const totalShippingPackagingCost = supplierShippingCost + packagingCost;
  const completedOrdersCount = completedOrders.length;
  const cancelledOrdersCount = cancelledOrders.length;
  const totalOrders = scopedOrders.length;

  const profitMargin = totalRevenue > 0
    ? Math.round((netProfit / totalRevenue) * 10000) / 100
    : 0;

  const averageOrderValue = completedOrdersCount > 0
    ? Math.round((totalRevenue / completedOrdersCount) * 100) / 100
    : 0;

  const averageOrderProfit = completedOrdersCount > 0
    ? Math.round((netProfit / completedOrdersCount) * 100) / 100
    : 0;

  // 4. Loss-Making Orders Detection
  const lossMakingOrders: LossMakingOrder[] = [];

  for (const o of completedOrders) {
    const profit = Number(o.net_profit) || 0;
    if (profit < 0) {
      let lossReason = 'Margine negativo complessivo';
      const refunds = Number(o.refund_amount) || 0;
      const rev = Number(o.total_paid) || 0;
      const cost = Number(o.total_cost) || 0;

      if (refunds > 0 && rev - cost > 0) {
        lossReason = `Rimborsi emessi (€${refunds.toFixed(2)}) superiori al margine iniziale`;
      } else if (cost > rev) {
        lossReason = `Costo fornitore/spedizione (€${cost.toFixed(2)}) superiore ai ricavi (€${rev.toFixed(2)})`;
      } else {
        lossReason = 'Commissioni marketplace e costi accessori hanno eroso il profitto';
      }

      lossMakingOrders.push({
        orderId: o.id,
        orderNumber: o.order_number || `ORD-${o.id.slice(0, 8)}`,
        buyerName: o.buyer_name || o.buyer_username || 'Cliente',
        date: o.created_at,
        revenue: Math.round(rev * 100) / 100,
        supplierCost: Math.round(((Number(o.total_cost) || 0) - (Number(o.supplier_shipping_cost) || 0) - (Number(o.packaging_cost) || 0)) * 100) / 100,
        shippingAndPackagingCost: Math.round(((Number(o.supplier_shipping_cost) || 0) + (Number(o.packaging_cost) || 0)) * 100) / 100,
        estimatedEbayFees: Number(o.estimated_ebay_fees) || 0,
        refunds,
        netLoss: Math.abs(Math.round(profit * 100) / 100),
        lossReason,
      });
    }
  }

  // 5. Best-Selling and Most Profitable Products
  const productMap = new Map<string, ProductPerformanceItem>();

  for (const o of completedOrders) {
    if (Array.isArray(o.items)) {
      for (const item of o.items) {
        const key = item.sku || item.product_id || item.title;
        const qty = Math.max(1, Number(item.quantity) || 1);
        const sellPrice = Number(item.selling_price ?? item.sale_price) || 0;
        const costPrice = Number(item.purchase_cost ?? item.supplier_cost) || 0;
        const itemRevenue = sellPrice * qty;
        const itemCost = costPrice * qty;
        // Estimated fee per line item: proportional to selling price
        const itemFee = itemRevenue * 0.115;
        const itemProfit = itemRevenue - itemCost - itemFee;

        const existing = productMap.get(key) || {
          productId: item.product_id,
          sku: item.sku,
          title: item.title,
          variantName: item.variant_name,
          supplierId: item.supplier_id || o.supplier_id,
          supplierName: item.supplier_name || o.supplier_name,
          unitsSold: 0,
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          profitMargin: 0,
        };

        existing.unitsSold += qty;
        existing.totalRevenue += itemRevenue;
        existing.totalCost += itemCost;
        existing.totalProfit += itemProfit;
        productMap.set(key, existing);
      }
    }
  }

  const allProductsPerformance = Array.from(productMap.values()).map((p) => ({
    ...p,
    totalRevenue: Math.round(p.totalRevenue * 100) / 100,
    totalCost: Math.round(p.totalCost * 100) / 100,
    totalProfit: Math.round(p.totalProfit * 100) / 100,
    profitMargin: p.totalRevenue > 0
      ? Math.round((p.totalProfit / p.totalRevenue) * 10000) / 100
      : 0,
  }));

  const bestSellingProducts = [...allProductsPerformance]
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 10);

  const mostProfitableProducts = [...allProductsPerformance]
    .sort((a, b) => b.totalProfit - a.totalProfit)
    .slice(0, 10);

  // 6. Supplier Cost & Profit Breakdown
  const supplierMap = new Map<string, SupplierCostBreakdown>();

  for (const o of completedOrders) {
    const sId = o.supplier_id || 'unknown';
    const sName = o.supplier_name || 'Fornitore non specificato';

    const existing = supplierMap.get(sId) || {
      supplierId: sId,
      supplierName: sName,
      ordersCount: 0,
      unitsSold: 0,
      totalRevenue: 0,
      totalCost: 0,
      totalProfit: 0,
      profitMargin: 0,
    };

    existing.ordersCount += 1;
    existing.totalRevenue += Number(o.total_paid) || 0;
    existing.totalCost += Number(o.total_cost) || 0;
    existing.totalProfit += Number(o.net_profit) || 0;

    if (Array.isArray(o.items)) {
      for (const i of o.items) {
        existing.unitsSold += Math.max(1, Number(i.quantity) || 1);
      }
    }

    supplierMap.set(sId, existing);
  }

  const supplierComparisons = Array.from(supplierMap.values()).map((s) => ({
    ...s,
    totalRevenue: Math.round(s.totalRevenue * 100) / 100,
    totalCost: Math.round(s.totalCost * 100) / 100,
    totalProfit: Math.round(s.totalProfit * 100) / 100,
    profitMargin: s.totalRevenue > 0
      ? Math.round((s.totalProfit / s.totalRevenue) * 10000) / 100
      : 0,
  })).sort((a, b) => b.totalProfit - a.totalProfit);

  // 7. Cancellation & Refund Analysis
  let potentialRevenueLost = 0;
  const reasonMap = new Map<string, { count: number; lost: number }>();

  for (const c of cancelledOrders) {
    const orderRev = Number(c.total_paid) || 0;
    potentialRevenueLost += orderRev;
    const reason = (c.cancellation_reason || 'Motivo non specificato').trim();

    const current = reasonMap.get(reason) || { count: 0, lost: 0 };
    current.count += 1;
    current.lost += orderRev;
    reasonMap.set(reason, current);
  }

  const cancellationReasons: CancellationReasonBreakdown[] = Array.from(reasonMap.entries()).map(
    ([reason, data]) => ({
      reason,
      count: data.count,
      percentage: cancelledOrdersCount > 0 ? Math.round((data.count / cancelledOrdersCount) * 10000) / 100 : 0,
      potentialRevenueLost: Math.round(data.lost * 100) / 100,
    })
  ).sort((a, b) => b.count - a.count);

  const cancellationRate = totalOrders > 0
    ? Math.round((cancelledOrdersCount / totalOrders) * 10000) / 100
    : 0;

  // Refunds count across all orders in range
  let refundsCount = 0;
  for (const o of scopedOrders) {
    if (Array.isArray(o.refunds) && o.refunds.length > 0) {
      refundsCount += o.refunds.length;
    } else if ((Number(o.refund_amount) || 0) > 0) {
      refundsCount += 1;
    }
  }

  const cancellationAnalysis: CancellationAnalysis = {
    cancelledOrdersCount,
    completedOrdersCount,
    cancellationRate,
    potentialRevenueLost: Math.round(potentialRevenueLost * 100) / 100,
    reasons: cancellationReasons,
    totalRefundsAmount: Math.round(totalRefunds * 100) / 100,
    refundsCount,
  };

  // 8. Trends & Daily Breakdown
  const trendMap = new Map<string, FinancialTrendItem>();

  // Determine span in days
  const dayMs = 24 * 3600 * 1000;
  const daysDiff = Math.max(1, Math.min(60, Math.ceil((endTime - startTime) / dayMs)));

  // Prepopulate days
  for (let i = 0; i < daysDiff; i++) {
    const d = new Date(startTime + i * dayMs);
    const dateStr = d.toISOString().slice(0, 10);
    const labelStr = d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    trendMap.set(dateStr, {
      date: dateStr,
      label: labelStr,
      revenue: 0,
      costs: 0,
      profit: 0,
      ordersCount: 0,
    });
  }

  for (const o of completedOrders) {
    const dStr = o.created_at.slice(0, 10);
    const entry = trendMap.get(dStr);
    if (entry) {
      entry.revenue += Number(o.total_paid) || 0;
      entry.costs += Number(o.total_cost) || 0;
      entry.profit += Number(o.net_profit) || 0;
      entry.ordersCount += 1;
    } else {
      // For any date outside prepopulated range
      trendMap.set(dStr, {
        date: dStr,
        label: dStr,
        revenue: Number(o.total_paid) || 0,
        costs: Number(o.total_cost) || 0,
        profit: Number(o.net_profit) || 0,
        ordersCount: 1,
      });
    }
  }

  const trends: FinancialTrendItem[] = Array.from(trendMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      ...t,
      revenue: Math.round(t.revenue * 100) / 100,
      costs: Math.round(t.costs * 100) / 100,
      profit: Math.round(t.profit * 100) / 100,
    }));

  // 9. Comparison with prior period
  let comparison: FinancialComparisonPeriod | undefined;
  if (rangePreset !== 'all' && rangePreset !== 'custom') {
    const durationMs = endTime - startTime;
    const prevStart = new Date(startTime - durationMs);
    const prevEnd = new Date(endTime - durationMs);

    const prevOrders = orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= prevStart.getTime() && t <= prevEnd.getTime() && o.status !== 'cancelled';
    });

    let prevRev = 0;
    let prevProf = 0;
    for (const p of prevOrders) {
      prevRev += Number(p.total_paid) || 0;
      prevProf += Number(p.net_profit) || 0;
    }

    const revGrowth = prevRev > 0
      ? Math.round(((totalRevenue - prevRev) / prevRev) * 10000) / 100
      : totalRevenue > 0 ? 100 : 0;

    const profGrowth = prevProf > 0
      ? Math.round(((netProfit - prevProf) / prevProf) * 10000) / 100
      : netProfit > 0 ? 100 : 0;

    const ordGrowth = prevOrders.length > 0
      ? Math.round(((completedOrdersCount - prevOrders.length) / prevOrders.length) * 10000) / 100
      : completedOrdersCount > 0 ? 100 : 0;

    comparison = {
      currentRevenue: Math.round(totalRevenue * 100) / 100,
      previousRevenue: Math.round(prevRev * 100) / 100,
      revenueGrowthPercent: revGrowth,
      currentProfit: Math.round(netProfit * 100) / 100,
      previousProfit: Math.round(prevProf * 100) / 100,
      profitGrowthPercent: profGrowth,
      currentOrdersCount: completedOrdersCount,
      previousOrdersCount: prevOrders.length,
      ordersGrowthPercent: ordGrowth,
    };
  }

  const summary: FinancialSummary = {
    currency: 'EUR',
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalSupplierCost: Math.round(totalSupplierCost * 100) / 100,
    shippingChargedToBuyer: Math.round(shippingChargedToBuyer * 100) / 100,
    supplierShippingCost: Math.round(supplierShippingCost * 100) / 100,
    packagingCost: Math.round(packagingCost * 100) / 100,
    totalShippingPackagingCost: Math.round(totalShippingPackagingCost * 100) / 100,
    estimatedEbayFees: Math.round(estimatedEbayFees * 100) / 100,
    confirmedEbayFees: 0,
    totalRefunds: Math.round(totalRefunds * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    profitMargin,
    totalOrders,
    completedOrdersCount,
    cancelledOrdersCount,
    averageOrderValue,
    averageOrderProfit,
    lossMakingOrdersCount: lossMakingOrders.length,
  };

  const dateRange: FinancialDateRange = {
    preset: rangePreset,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    label,
  };

  return {
    generatedAt: new Date().toISOString(),
    currency: 'EUR',
    dateRange,
    summary,
    trends,
    comparison,
    bestSellingProducts,
    mostProfitableProducts,
    supplierComparisons,
    lossMakingOrders,
    cancellationAnalysis,
  };
}
