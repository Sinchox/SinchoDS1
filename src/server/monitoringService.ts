import {
  Product,
  ProductVariant,
  Supplier,
  PricingRule,
  PriceHistoryItem,
  ProductChangeReview,
  Notification,
  MonitoringJob,
  EbaySyncEvent,
  MonitoringSettings,
} from '../types.js';
import {
  listWorkspaceProducts,
  getWorkspaceProduct,
  saveWorkspaceProduct,
  listWorkspaceSuppliers,
  recordWorkspacePriceChange,
  fetchHtmlForWorkspace,
  getAllWorkspaceIds,
} from './workspaceStore.js';
import { parseProductWithSupplierFallback } from '../utils/parser.js';
import { evaluatePriceChange, calculateEbayPricing, DEFAULT_PRICING_RULE } from '../utils/pricing.js';

// Default global monitoring configuration
export const DEFAULT_MONITORING_SETTINGS: MonitoringSettings = {
  globalIntervalMinutes: 360, // 6 hours
  defaultEbayQuantity: 3, // Configurable 3 or 5
  minimumProfitEur: 3.0,
  packagingCost: 0.0,
  concurrencyLimit: 2,
  maxRetries: 3,
};

// Workspace Scoped Storage for Notifications, Reviews, Jobs, and Sync Events
export const workspaceNotificationsStore = new Map<string, Notification[]>();
export const workspaceChangeReviewsStore = new Map<string, ProductChangeReview[]>();
export const workspaceMonitoringJobsStore = new Map<string, MonitoringJob[]>();
export const workspaceEbaySyncEventsStore = new Map<string, EbaySyncEvent[]>();
export const workspaceMonitoringSettingsStore = new Map<string, MonitoringSettings>();

// In-memory active locks to prevent overlapping monitoring runs for the same product
export const activeMonitoringProductLocks = new Set<string>();

export function clearMonitoringStore(): void {
  workspaceNotificationsStore.clear();
  workspaceChangeReviewsStore.clear();
  workspaceMonitoringJobsStore.clear();
  workspaceEbaySyncEventsStore.clear();
  workspaceMonitoringSettingsStore.clear();
  activeMonitoringProductLocks.clear();
}

export function getWorkspaceMonitoringSettings(workspaceId: string): MonitoringSettings {
  return workspaceMonitoringSettingsStore.get(workspaceId) || { ...DEFAULT_MONITORING_SETTINGS };
}

export function saveWorkspaceMonitoringSettings(workspaceId: string, settings: Partial<MonitoringSettings>): MonitoringSettings {
  const current = getWorkspaceMonitoringSettings(workspaceId);
  const updated: MonitoringSettings = {
    ...current,
    ...settings,
    defaultEbayQuantity: settings.defaultEbayQuantity === 5 ? 5 : (settings.defaultEbayQuantity === 3 ? 3 : current.defaultEbayQuantity),
  };
  workspaceMonitoringSettingsStore.set(workspaceId, updated);
  return updated;
}

// ==============================================================================
// 1. NOTIFICATIONS ENGINE (Workspace-Isolated, Deduplicated, Persistent)
// ==============================================================================

export async function listWorkspaceNotifications(
  workspaceId: string,
  filter?: { unreadOnly?: boolean; severity?: string }
): Promise<Notification[]> {
  const all = workspaceNotificationsStore.get(workspaceId) || [];
  return all.filter((n) => {
    if (filter?.unreadOnly && n.is_read) return false;
    if (filter?.severity && n.severity !== filter.severity) return false;
    return true;
  });
}

export async function createWorkspaceNotification(
  workspaceId: string,
  notif: Omit<Notification, 'id' | 'workspace_id' | 'created_at' | 'is_read' | 'is_resolved' | 'dedup_key'> & { dedup_key?: string }
): Promise<Notification> {
  const list = workspaceNotificationsStore.get(workspaceId) || [];
  const dedupKey = notif.dedup_key || `${notif.type}-${notif.product_id || 'global'}-${Date.now()}`;

  // Deduplication: if an active (unresolved) notification with the same dedup_key exists, update timestamp and message
  const existingIdx = list.findIndex((n) => n.dedup_key === dedupKey && !n.is_resolved);
  if (existingIdx >= 0) {
    const updated: Notification = {
      ...list[existingIdx],
      title: notif.title,
      message: notif.message,
      severity: notif.severity,
      metadata: notif.metadata || list[existingIdx].metadata,
      is_read: false,
    };
    list[existingIdx] = updated;
    workspaceNotificationsStore.set(workspaceId, list);
    return updated;
  }

  const newNotif: Notification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    workspace_id: workspaceId,
    product_id: notif.product_id,
    supplier_id: notif.supplier_id,
    type: notif.type,
    title: notif.title,
    message: notif.message,
    severity: notif.severity,
    is_read: false,
    is_resolved: false,
    dedup_key: dedupKey,
    metadata: notif.metadata || {},
    created_at: new Date().toISOString(),
  };

  list.unshift(newNotif);
  workspaceNotificationsStore.set(workspaceId, list.slice(0, 500));
  return newNotif;
}

export async function resolveWorkspaceNotification(workspaceId: string, dedupKeyOrId: string): Promise<boolean> {
  const list = workspaceNotificationsStore.get(workspaceId) || [];
  let modified = false;
  for (const n of list) {
    if ((n.id === dedupKeyOrId || n.dedup_key === dedupKeyOrId) && !n.is_resolved) {
      n.is_resolved = true;
      n.resolved_at = new Date().toISOString();
      modified = true;
    }
  }
  if (modified) {
    workspaceNotificationsStore.set(workspaceId, list);
  }
  return modified;
}

export async function markWorkspaceNotificationRead(workspaceId: string, id: string): Promise<boolean> {
  const list = workspaceNotificationsStore.get(workspaceId) || [];
  const item = list.find((n) => n.id === id);
  if (item) {
    item.is_read = true;
    workspaceNotificationsStore.set(workspaceId, list);
    return true;
  }
  return false;
}

export async function markAllWorkspaceNotificationsRead(workspaceId: string): Promise<number> {
  const list = workspaceNotificationsStore.get(workspaceId) || [];
  let count = 0;
  for (const n of list) {
    if (!n.is_read) {
      n.is_read = true;
      count++;
    }
  }
  workspaceNotificationsStore.set(workspaceId, list);
  return count;
}

// ==============================================================================
// 2. PRODUCT CHANGE REVIEW QUEUE (Content changes requiring manual review)
// ==============================================================================

export async function listWorkspaceChangeReviews(
  workspaceId: string,
  filter?: { status?: 'pending' | 'approved' | 'rejected'; productId?: string }
): Promise<ProductChangeReview[]> {
  const all = workspaceChangeReviewsStore.get(workspaceId) || [];
  return all.filter((r) => {
    if (filter?.status && r.status !== filter.status) return false;
    if (filter?.productId && r.product_id !== filter.productId) return false;
    return true;
  });
}

export async function addWorkspaceChangeReview(
  workspaceId: string,
  review: Omit<ProductChangeReview, 'id' | 'workspace_id' | 'status' | 'detected_at'>
): Promise<ProductChangeReview> {
  const list = workspaceChangeReviewsStore.get(workspaceId) || [];

  // If there is already a pending review for the same product and field, update new_value
  const existing = list.find(
    (r) => r.product_id === review.product_id && r.field_name === review.field_name && r.status === 'pending'
  );
  if (existing) {
    existing.new_value = review.new_value;
    existing.detected_at = new Date().toISOString();
    return existing;
  }

  const item: ProductChangeReview = {
    id: `rev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    workspace_id: workspaceId,
    product_id: review.product_id,
    product_title: review.product_title,
    field_name: review.field_name,
    old_value: review.old_value,
    new_value: review.new_value,
    status: 'pending',
    detected_at: new Date().toISOString(),
  };

  list.unshift(item);
  workspaceChangeReviewsStore.set(workspaceId, list.slice(0, 500));
  return item;
}

export async function approveWorkspaceChangeReview(
  workspaceId: string,
  reviewId: string
): Promise<{ ok: boolean; review?: ProductChangeReview; product?: Product; error?: string }> {
  const list = workspaceChangeReviewsStore.get(workspaceId) || [];
  const review = list.find((r) => r.id === reviewId);
  if (!review) return { ok: false, error: 'Change review item not found.' };

  const product = await getWorkspaceProduct(workspaceId, review.product_id);
  if (!product) return { ok: false, error: 'Associated product not found.' };

  // Apply approved content update to product
  switch (review.field_name) {
    case 'title':
      product.title = String(review.new_value);
      break;
    case 'description':
      product.description = String(review.new_value);
      break;
    case 'images':
      if (Array.isArray(review.new_value)) {
        product.images = review.new_value;
      }
      break;
    case 'sku':
      product.sku = review.new_value ? String(review.new_value) : null;
      break;
    case 'ean':
      product.ean = review.new_value ? String(review.new_value) : null;
      break;
    case 'variants':
      if (Array.isArray(review.new_value)) {
        product.variants = review.new_value;
      }
      break;
  }

  review.status = 'approved';
  review.reviewed_at = new Date().toISOString();

  // If no remaining pending reviews for product, return monitoring_status to idle or ready
  const remainingPending = list.filter((r) => r.product_id === product.id && r.id !== review.id && r.status === 'pending');
  if (remainingPending.length === 0 && product.monitoring_status === 'changes_detected') {
    product.monitoring_status = 'idle';
  }

  await saveWorkspaceProduct(workspaceId, product);
  workspaceChangeReviewsStore.set(workspaceId, list);

  return { ok: true, review, product };
}

export async function rejectWorkspaceChangeReview(
  workspaceId: string,
  reviewId: string
): Promise<{ ok: boolean; review?: ProductChangeReview; error?: string }> {
  const list = workspaceChangeReviewsStore.get(workspaceId) || [];
  const review = list.find((r) => r.id === reviewId);
  if (!review) return { ok: false, error: 'Change review item not found.' };

  review.status = 'rejected';
  review.reviewed_at = new Date().toISOString();

  const product = await getWorkspaceProduct(workspaceId, review.product_id);
  if (product && product.monitoring_status === 'changes_detected') {
    const remainingPending = list.filter((r) => r.product_id === product.id && r.id !== review.id && r.status === 'pending');
    if (remainingPending.length === 0) {
      product.monitoring_status = 'idle';
      await saveWorkspaceProduct(workspaceId, product);
    }
  }

  workspaceChangeReviewsStore.set(workspaceId, list);
  return { ok: true, review };
}

// ==============================================================================
// 3. EBAY SYNC EVENTS (Reliable Queue for Future Phase)
// ==============================================================================

export async function recordEbaySyncEvent(
  workspaceId: string,
  productId: string,
  eventType: 'price_update' | 'stock_update' | 'out_of_stock' | 'stock_restored',
  payload: Record<string, any>
): Promise<EbaySyncEvent> {
  const list = workspaceEbaySyncEventsStore.get(workspaceId) || [];
  const event: EbaySyncEvent = {
    id: `sync-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    workspace_id: workspaceId,
    product_id: productId,
    event_type: eventType,
    payload,
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  list.unshift(event);
  workspaceEbaySyncEventsStore.set(workspaceId, list.slice(0, 1000));
  return event;
}

export async function listWorkspaceEbaySyncEvents(workspaceId: string, productId?: string): Promise<EbaySyncEvent[]> {
  const all = workspaceEbaySyncEventsStore.get(workspaceId) || [];
  if (productId) return all.filter((e) => e.product_id === productId);
  return [...all];
}

// ==============================================================================
// 4. MONITORING JOBS & AUDITING
// ==============================================================================

export async function listWorkspaceMonitoringJobs(workspaceId: string): Promise<MonitoringJob[]> {
  return [...(workspaceMonitoringJobsStore.get(workspaceId) || [])];
}

// ==============================================================================
// 5. CORE MONITORING EVALUATION LOGIC
// ==============================================================================

export interface ProductMonitoringResult {
  ok: boolean;
  productId: string;
  url: string;
  statusCode?: number;
  priceAction: string;
  stockAction: string;
  contentChangesCount: number;
  error?: string;
  product?: Product;
}

/**
 * Executes a full monitoring check on a single product against its supplier URL.
 */
export async function checkProductNow(
  workspaceId: string,
  productId: string,
  overrideScraper?: (product: Product) => Promise<Partial<Product>>
): Promise<ProductMonitoringResult> {
  // Prevent overlapping checks for the exact same product
  if (activeMonitoringProductLocks.has(productId)) {
    const existingProd = await getWorkspaceProduct(workspaceId, productId);
    return {
      ok: false,
      productId,
      url: existingProd?.url || '',
      priceAction: 'skipped_locked',
      stockAction: 'skipped_locked',
      contentChangesCount: 0,
      error: 'Product check is already in progress.',
      product: existingProd || undefined,
    };
  }

  activeMonitoringProductLocks.add(productId);

  const product = await getWorkspaceProduct(workspaceId, productId);
  if (!product) {
    activeMonitoringProductLocks.delete(productId);
    return {
      ok: false,
      productId,
      url: '',
      priceAction: 'error',
      stockAction: 'error',
      contentChangesCount: 0,
      error: 'Product not found in this workspace.',
    };
  }

  // Load workspace suppliers and settings
  const suppliers = await listWorkspaceSuppliers(workspaceId);
  const supplier = suppliers.find((s) => s.id === product.supplier_id);
  const settings = getWorkspaceMonitoringSettings(workspaceId);

  // Determine interval
  const intervalMinutes = supplier?.monitoringIntervalMinutes || supplier?.monitoring_interval_minutes || settings.globalIntervalMinutes || 360;
  const defaultQuantity = supplier?.defaultEbayQuantity || supplier?.default_ebay_quantity || settings.defaultEbayQuantity || 3;

  // Mark product status as checking
  product.monitoring_status = 'checking';
  product.last_checked_at = new Date().toISOString();

  // Create job record
  const jobList = workspaceMonitoringJobsStore.get(workspaceId) || [];
  const job: MonitoringJob = {
    id: `mjob-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    workspace_id: workspaceId,
    product_id: product.id,
    product_title: product.title,
    status: 'running',
    attempts: (product.consecutive_failures || 0) + 1,
    max_attempts: settings.maxRetries || 3,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
  };
  jobList.unshift(job);
  workspaceMonitoringJobsStore.set(workspaceId, jobList.slice(0, 500));

  try {
    let parsed: Partial<Product> = {};
    let fetchRes = { ok: true, html: '', statusCode: 200, blocked: false, error: '' };

    if (overrideScraper) {
      try {
        parsed = await overrideScraper(product);
      } catch (err: any) {
        fetchRes = {
          ok: false,
          html: '',
          statusCode: 500,
          blocked: false,
          error: err.message || 'Scraper error',
        };
      }
    } else {
      // 1. Fetch HTML using the supplier-configured method (Direct / ZenRows with Cloudflare handling)
      const method: 'direct' | 'zenrows' = (supplier?.fetch_method || supplier?.fetchMethod) === 'zenrows' ? 'zenrows' : 'direct';
      const jsRender = Boolean(supplier?.js_rendering || supplier?.js_render || supplier?.jsRender);
      const res = await fetchHtmlForWorkspace(product.url, method, jsRender);
      fetchRes = {
        ok: res.ok,
        html: res.html || '',
        statusCode: res.ok ? 200 : 500,
        blocked: false,
        error: res.error || '',
      };
      if (fetchRes.ok && fetchRes.html) {
        parsed = parseProductWithSupplierFallback(fetchRes.html, product.url, supplier, suppliers, product.import_source);
      }
    }

    // Error or Cloudflare challenge detection
    if (!fetchRes.ok || (!overrideScraper && !fetchRes.html)) {
      const errorMsg = fetchRes.blocked
        ? 'Supplier site blocked request with Cloudflare verification challenge.'
        : fetchRes.error || `HTTP error ${fetchRes.statusCode || 500}`;

      const failures = (product.consecutive_failures || 0) + 1;
      product.consecutive_failures = failures;
      product.last_monitoring_error = errorMsg;
      product.monitoring_status = 'error';
      // Retry in 15 minutes instead of waiting the full 6 hours
      product.next_check_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      job.status = 'failed';
      job.last_error = errorMsg;
      job.finished_at = new Date().toISOString();

      // Persistent Low/Error Alert if failures reach threshold
      if (failures >= (settings.maxRetries || 3)) {
        await createWorkspaceNotification(workspaceId, {
          product_id: product.id,
          supplier_id: product.supplier_id,
          type: 'supplier_error',
          severity: 'warning',
          title: `Supplier Connection Error (${failures}x): ${product.title}`,
          message: `Monitoring failed ${failures} consecutive times for ${product.title}. Error: ${errorMsg}. Last reliable price and stock have been preserved.`,
          dedup_key: `supp_err_${product.id}`,
          metadata: { failures, error: errorMsg, url: product.url },
        });
      }

      await saveWorkspaceProduct(workspaceId, product);
      activeMonitoringProductLocks.delete(productId);

      return {
        ok: false,
        productId,
        url: product.url,
        statusCode: fetchRes.statusCode,
        priceAction: 'preserved_on_error',
        stockAction: 'preserved_on_error',
        contentChangesCount: 0,
        error: errorMsg,
        product,
      };
    }

    // Reset error counters on successful scrape
    product.consecutive_failures = 0;
    product.last_monitoring_error = null;
    product.last_successful_response_at = new Date().toISOString();
    product.next_check_at = new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();

    // 3. Price Evaluation
    const oldSupplierCost = Number(product.price) || 0;
    const newSupplierCost = Number(parsed.price) || 0;
    const currentSellingPrice = Number(product.calculated_selling_price) || 0;

    const pricingRule: Partial<PricingRule> = {
      ...(supplier?.pricingRule || supplier?.pricing_rule || {}),
      supplierShippingCost: supplier?.shippingCost ?? supplier?.shipping_cost ?? 0,
      packagingCost: supplier?.packagingCost ?? supplier?.packaging_cost ?? settings.packagingCost ?? 0,
    };

    const priceEval = evaluatePriceChange({
      currentSupplierCost: oldSupplierCost,
      newSupplierCost: newSupplierCost,
      currentSellingPrice,
      pricingRule,
      minimumProfitThreshold: settings.minimumProfitEur,
    });

    let priceHistoryStatus: 'applied' | 'pending_approval' | 'rejected' = 'applied';
    let recordPriceHistory = false;

    if (priceEval.action === 'auto_recalculated') {
      product.price = priceEval.newCost;
      product.calculated_selling_price = priceEval.newSellingPrice;
      priceHistoryStatus = 'applied';
      recordPriceHistory = true;

      // Queue eBay price update event
      await recordEbaySyncEvent(workspaceId, product.id, 'price_update', {
        oldCost: oldSupplierCost,
        newCost: priceEval.newCost,
        sellingPrice: priceEval.newSellingPrice,
        breakdown: priceEval.calculation,
      });

      // Clear any previous unprofitable alerts if now resolved
      await resolveWorkspaceNotification(workspaceId, `price_unprof_${product.id}`);
    } else if (priceEval.action === 'needs_approval') {
      // Unprofitable increase: hold change, create persistent alert
      priceHistoryStatus = 'pending_approval';
      recordPriceHistory = true;
      product.monitoring_status = 'pending_approval';

      await createWorkspaceNotification(workspaceId, {
        product_id: product.id,
        supplier_id: product.supplier_id,
        type: 'price_increase_unprofitable',
        severity: 'error',
        title: `Margin Alert: Unprofitable Supplier Price Increase for ${product.title}`,
        message: priceEval.reason,
        dedup_key: `price_unprof_${product.id}`,
        metadata: {
          oldCost: oldSupplierCost,
          newCost: priceEval.newCost,
          expectedProfit: priceEval.calculation.expectedNetProfit,
          minProfitRequired: settings.minimumProfitEur,
        },
      });
    } else if (priceEval.action === 'pending_approval') {
      // Price decrease: calculate potential, require approval
      priceHistoryStatus = 'pending_approval';
      recordPriceHistory = true;
      product.monitoring_status = 'pending_approval';

      await createWorkspaceNotification(workspaceId, {
        product_id: product.id,
        supplier_id: product.supplier_id,
        type: 'price_decrease_pending',
        severity: 'info',
        title: `Price Decrease Detected: ${product.title}`,
        message: priceEval.reason,
        dedup_key: `price_dec_${product.id}`,
        metadata: {
          oldCost: oldSupplierCost,
          newCost: priceEval.newCost,
          potentialSellingPrice: priceEval.newSellingPrice,
          potentialProfit: priceEval.calculation.expectedNetProfit,
        },
      });
    }

    if (recordPriceHistory) {
      const historyItem: PriceHistoryItem = {
        id: `ph-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        workspace_id: workspaceId,
        product_id: product.id,
        supplier_id: product.supplier_id,
        old_price: oldSupplierCost,
        new_price: priceEval.newCost,
        old_cost: oldSupplierCost,
        new_cost: priceEval.newCost,
        old_selling_price: currentSellingPrice || priceEval.oldSellingPrice,
        new_selling_price: priceEval.newSellingPrice,
        old_stock: product.stock_quantity,
        new_stock: parsed.stock_quantity,
        change_type: priceEval.isPriceIncrease
          ? (priceEval.action === 'auto_recalculated' ? 'auto_recalculated' : 'price_increase')
          : (priceEval.isPriceDecrease ? 'price_decrease' : 'manual_update'),
        status: priceHistoryStatus,
        reason: priceEval.reason,
        breakdown: {
          supplierCost: priceEval.calculation.supplierCost,
          shippingCost: priceEval.calculation.supplierShipping,
          packagingCost: priceEval.calculation.packagingCost || 0,
          ebayFees: priceEval.calculation.expectedEbayFees,
          netProfit: priceEval.calculation.expectedNetProfit,
          marginPercent: priceEval.calculation.profitMarginPercent,
          breakEvenPrice: priceEval.calculation.breakEvenPrice,
        },
        changed_at: new Date().toISOString(),
      };
      await recordWorkspacePriceChange(workspaceId, historyItem);
    }

    // 4. Stock Evaluation & Rules
    let stockAction = 'no_change';
    const oldStock = product.stock_quantity !== null && product.stock_quantity !== undefined ? product.stock_quantity : null;
    const oldAvailability = product.availability;
    const newStock = parsed.stock_quantity !== null && parsed.stock_quantity !== undefined ? parsed.stock_quantity : null;
    const newAvailability = parsed.availability;

    const isNowOutOfStock = newAvailability === 'OutOfStock' || (newStock !== null && newStock === 0);
    const wasOutOfStock = oldAvailability === 'OutOfStock' || (oldStock !== null && oldStock === 0);

    if (isNowOutOfStock) {
      product.availability = 'OutOfStock';
      product.stock_quantity = 0;
      product.calculated_quantity = 0;
      product.monitoring_status = 'out_of_stock';
      stockAction = 'depleted_to_zero';

      // Keep eBay listing active or draft (do not end or delete listing), dispatch event
      await recordEbaySyncEvent(workspaceId, product.id, 'out_of_stock', {
        calculatedQuantity: 0,
        supplierStock: newStock,
      });

      await createWorkspaceNotification(workspaceId, {
        product_id: product.id,
        supplier_id: product.supplier_id,
        type: 'out_of_stock',
        severity: 'warning',
        title: `Out of Stock: ${product.title}`,
        message: `Supplier has run out of stock for ${product.title}. eBay quantity adjusted to 0 to prevent unfulfillable orders. Listing remains preserved.`,
        dedup_key: `stock_zero_${product.id}`,
        metadata: { url: product.url, supplierId: product.supplier_id },
      });
    } else if (wasOutOfStock && !isNowOutOfStock) {
      // Stock Restored!
      product.availability = 'InStock';
      product.stock_quantity = newStock !== null ? newStock : defaultQuantity;
      product.calculated_quantity = defaultQuantity;
      if ((product.monitoring_status as string) === 'out_of_stock') {
        product.monitoring_status = 'idle';
      }
      stockAction = 'restored_fixed_quantity';

      // Automatically close previous out_of_stock alert!
      await resolveWorkspaceNotification(workspaceId, `stock_zero_${product.id}`);

      // Queue eBay stock restored event
      await recordEbaySyncEvent(workspaceId, product.id, 'stock_restored', {
        calculatedQuantity: defaultQuantity,
        supplierStock: newStock,
      });

      await createWorkspaceNotification(workspaceId, {
        product_id: product.id,
        supplier_id: product.supplier_id,
        type: 'stock_restored',
        severity: 'info',
        title: `Stock Restored: ${product.title}`,
        message: `Supplier stock has returned for ${product.title}. Listing available quantity automatically restored to ${defaultQuantity} units.`,
        dedup_key: `stock_restored_${product.id}`,
        metadata: { restoredQuantity: defaultQuantity, supplierStock: newStock },
      });
    } else {
      // Stock quantity normal update
      product.availability = newAvailability || product.availability;
      product.stock_quantity = newStock !== null ? newStock : product.stock_quantity;
      if (!product.calculated_quantity && product.availability === 'InStock') {
        product.calculated_quantity = defaultQuantity;
      }
    }

    // 4b. Variant-level stock isolation
    if (Array.isArray(product.variants) && product.variants.length > 0 && Array.isArray(parsed.variants)) {
      for (const variant of product.variants) {
        const matchingParsed = parsed.variants.find(
          (v) => (v.sku && v.sku === variant.sku) || (v.name && v.name.toLowerCase() === variant.name.toLowerCase())
        );
        if (matchingParsed) {
          const varOutOfStock = matchingParsed.availability === 'OutOfStock' || (matchingParsed.stock_quantity !== null && matchingParsed.stock_quantity === 0);
          if (varOutOfStock) {
            variant.availability = 'OutOfStock';
            variant.stock_quantity = 0;
          } else {
            variant.availability = 'InStock';
            variant.stock_quantity = matchingParsed.stock_quantity !== null ? matchingParsed.stock_quantity : defaultQuantity;
          }
        }
      }
    }

    // 5. Product Change Detection (Title, Description, Images, SKU, EAN, Variants)
    // NEVER overwrite product content automatically — enqueue review
    let contentChanges = 0;

    // Title
    if (parsed.title && parsed.title.trim() !== product.title.trim()) {
      await addWorkspaceChangeReview(workspaceId, {
        product_id: product.id,
        product_title: product.title,
        field_name: 'title',
        old_value: product.title,
        new_value: parsed.title,
      });
      contentChanges++;
    }

    // Description (check if significantly different)
    if (parsed.description && parsed.description.trim() !== (product.description || '').trim()) {
      await addWorkspaceChangeReview(workspaceId, {
        product_id: product.id,
        product_title: product.title,
        field_name: 'description',
        old_value: product.description || '',
        new_value: parsed.description,
      });
      contentChanges++;
    }

    // Images
    const oldImgs = JSON.stringify(product.images || []);
    const newImgs = JSON.stringify(parsed.images || []);
    if (parsed.images && parsed.images.length > 0 && oldImgs !== newImgs) {
      await addWorkspaceChangeReview(workspaceId, {
        product_id: product.id,
        product_title: product.title,
        field_name: 'images',
        old_value: product.images || [],
        new_value: parsed.images,
      });
      contentChanges++;
    }

    // SKU
    if (parsed.sku && parsed.sku.trim() !== (product.sku || '').trim()) {
      await addWorkspaceChangeReview(workspaceId, {
        product_id: product.id,
        product_title: product.title,
        field_name: 'sku',
        old_value: product.sku,
        new_value: parsed.sku,
      });
      contentChanges++;
    }

    // EAN
    if (parsed.ean && parsed.ean.trim() !== (product.ean || '').trim()) {
      await addWorkspaceChangeReview(workspaceId, {
        product_id: product.id,
        product_title: product.title,
        field_name: 'ean',
        old_value: product.ean,
        new_value: parsed.ean,
      });
      contentChanges++;
    }

    // Variants structure
    if (parsed.variants && parsed.variants.length > 0 && parsed.variants.length !== (product.variants?.length || 0)) {
      await addWorkspaceChangeReview(workspaceId, {
        product_id: product.id,
        product_title: product.title,
        field_name: 'variants',
        old_value: product.variants || [],
        new_value: parsed.variants,
      });
      contentChanges++;
    }

    if (contentChanges > 0) {
      product.monitoring_status = 'changes_detected';
      await createWorkspaceNotification(workspaceId, {
        product_id: product.id,
        supplier_id: product.supplier_id,
        type: 'content_changed',
        severity: 'info',
        title: `Supplier Content Changed: ${product.title}`,
        message: `Detected ${contentChanges} content field difference(s) on supplier page for ${product.title}. Held in Review Queue for manual approval.`,
        dedup_key: `content_chg_${product.id}`,
        metadata: { changesCount: contentChanges },
      });
    } else if ((product.monitoring_status as string) === 'checking' || (product.monitoring_status as string) === 'error') {
      product.monitoring_status = isNowOutOfStock ? 'out_of_stock' : (priceEval.action.includes('approval') ? 'pending_approval' : 'idle');
    }

    job.status = 'completed';
    job.finished_at = new Date().toISOString();

    await saveWorkspaceProduct(workspaceId, product);
    activeMonitoringProductLocks.delete(productId);

    return {
      ok: true,
      productId,
      url: product.url,
      statusCode: fetchRes.statusCode,
      priceAction: priceEval.action,
      stockAction,
      contentChangesCount: contentChanges,
      product,
    };
  } catch (err: any) {
    const errorMsg = err.message || 'Unexpected monitoring failure';
    product.consecutive_failures = (product.consecutive_failures || 0) + 1;
    product.last_monitoring_error = errorMsg;
    product.monitoring_status = 'error';
    product.next_check_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    job.status = 'failed';
    job.last_error = errorMsg;
    job.finished_at = new Date().toISOString();

    await saveWorkspaceProduct(workspaceId, product);
    activeMonitoringProductLocks.delete(productId);

    return {
      ok: false,
      productId,
      url: product.url,
      priceAction: 'error',
      stockAction: 'error',
      contentChangesCount: 0,
      error: errorMsg,
      product,
    };
  }
}

/**
 * Bulk "Check Now" for an array of product IDs in a workspace with concurrency limit.
 */
export async function checkProductsBulk(
  workspaceId: string,
  productIds: string[]
): Promise<ProductMonitoringResult[]> {
  const settings = getWorkspaceMonitoringSettings(workspaceId);
  const concurrency = settings.concurrencyLimit || 2;
  const results: ProductMonitoringResult[] = [];

  // Chunk by concurrency limit
  for (let i = 0; i < productIds.length; i += concurrency) {
    const batch = productIds.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((id) => checkProductNow(workspaceId, id)));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Persistent Background Scheduler: checks products across all registered workspaces that are due.
 */
export async function runMonitoringScheduledCycle(): Promise<{ checkedCount: number }> {
  // To avoid interfering with quick tests, runs gracefully without crashing
  let checkedCount = 0;
  try {
    const allIds = new Set<string>([
      ...workspaceMonitoringSettingsStore.keys(),
      ...getAllWorkspaceIds(),
    ]);

    for (const workspaceId of allIds) {
      const products = await listWorkspaceProducts(workspaceId);
      const now = Date.now();
      const dueProducts = products.filter((p) => {
        if (!p.url) return false;
        if (!p.next_check_at) return true; // never checked
        return new Date(p.next_check_at).getTime() <= now;
      });

      if (dueProducts.length > 0) {
        // Take at most 4 per cycle
        const toCheck = dueProducts.slice(0, 4);
        await checkProductsBulk(workspaceId, toCheck.map((p) => p.id));
        checkedCount += toCheck.length;
      }
    }
  } catch {
    // Keep background cycle resilient
  }
  return { checkedCount };
}
