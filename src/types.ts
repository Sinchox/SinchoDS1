export interface ProductVariant {
  id: string; // uuid or internal id
  product_id?: string;
  variant_id?: string | number | null; // e.g. site internal id
  option_id?: string | null;
  name: string; // flavour, size, etc.
  sku?: string | null;
  ean?: string | null;
  price?: string | number | null;
  original_price?: string | number | null;
  stock_quantity: number | null;
  availability: 'InStock' | 'OutOfStock' | 'PreOrder' | string | null;
  expiry_date?: string | null;
  available_online?: boolean | null;
  raw_data?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface Product {
  id: string; // uuid
  workspace_id?: string;
  supplier_id: string; // e.g. 'pluspower'
  supplier_name?: string;
  supplier_product_id?: string | null;
  url: string;
  title: string;
  brand?: string | null;
  category?: string | null;
  price: string | number | null; // current supplier cost
  original_price?: string | number | null;
  discount_percentage?: number | null;
  currency?: string;
  sku?: string | null;
  ean?: string | null;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder' | string | null;
  stock_quantity?: number | null;
  description?: string | null;
  ingredients?: string | null;
  nutrition?: string | null;
  images: string[];
  variants: ProductVariant[];
  raw_jsonld?: any;
  import_source: 'live_scraper' | 'sitemap' | 'html_import' | 'manual' | 'zenrows_scraper';
  status: 'draft' | 'ready' | 'needs_review' | 'blocked' | 'error' | 'archived';
  is_archived?: boolean;
  error?: string | null;
  created_at: string;
  updated_at: string;
  // eBay relation
  ebay_listing_id?: string | null;
  ebay_status?: 'not_listed' | 'draft' | 'active' | 'ended' | 'error';
  last_synced_at?: string | null;
  // Monitoring & Calculated inventory fields (Phase 1.4)
  last_checked_at?: string | null;
  next_check_at?: string | null;
  monitoring_status?: 'idle' | 'checking' | 'error' | 'pending_approval' | 'out_of_stock' | 'changes_detected';
  last_successful_response_at?: string | null;
  consecutive_failures?: number;
  last_monitoring_error?: string | null;
  calculated_selling_price?: number | null;
  calculated_quantity?: number | null;
}

export interface SupplierParserConfig {
  titleSelector?: string;
  priceSelector?: string;
  skuSelector?: string;
  eanSelector?: string;
  imageSelector?: string;
  descriptionSelector?: string;
  title_selector?: string;
  price_selector?: string;
  stock_selector?: string;
  sku_selector?: string;
  ean_selector?: string;
  image_selector?: string;
  description_selector?: string;
}

export interface Supplier {
  id: string;
  name: string;
  baseUrl?: string;
  base_url?: string;
  logoText?: string;
  logo_text?: string;
  type?: string;
  slug?: string;
  status: 'active' | 'disabled' | 'maintenance';
  lastSyncAt?: string | null;
  last_sync_at?: string | null;
  productCount?: number;
  product_count?: number;
  failedCount?: number;
  failed_count?: number;
  description?: string;
  isGlobal?: boolean;
  is_global?: boolean;
  workspaceId?: string;
  workspace_id?: string;
  fetchMethod?: 'direct' | 'zenrows';
  fetch_method?: 'direct' | 'zenrows';
  jsRender?: boolean;
  js_render?: boolean;
  js_rendering?: boolean;
  connected?: boolean;
  shippingCost?: number;
  shipping_cost?: number;
  packagingCost?: number;
  packaging_cost?: number;
  stockThreshold?: number;
  stock_threshold?: number;
  monitoringIntervalMinutes?: number;
  monitoring_interval_minutes?: number;
  defaultEbayQuantity?: number;
  default_ebay_quantity?: number;
  pricingRule?: Partial<PricingRule>;
  pricing_rule?: Partial<PricingRule>;
  parserConfig?: SupplierParserConfig;
  parser_config?: SupplierParserConfig;
  supportedFeatures?: {
    sitemap: boolean;
    variants: boolean;
    lotExpiry: boolean;
    liveScraping: boolean;
    htmlImport: boolean;
  };
  created_at?: string;
  updated_at?: string;
}

export interface ImportJobItem {
  url: string;
  status: 'pending' | 'processing' | 'success' | 'blocked' | 'failed' | 'duplicate';
  error?: string;
  product?: Product;
  isDuplicate?: boolean;
  supplierId?: string;
}

export interface ImportJob {
  id: string;
  workspaceId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  successful: number;
  failed: number;
  duplicates: number;
  items: ImportJobItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PricingRule {
  targetMarginPercent: number; // e.g. 25 (%)
  targetFixedProfit: number; // e.g. 5 (€)
  supplierShippingCost: number; // e.g. 4.90 (€)
  packagingCost?: number; // e.g. 1.00 (€)
  ebayFeePercent: number; // e.g. 11.5 (%)
  ebayFixedFee: number; // e.g. 0.35 (€)
  paymentFeePercent: number; // e.g. 0 (%)
  vatRatePercent: number; // e.g. 22 (%)
  minDropshipProfit?: number;
}

export interface PricingCalculation {
  supplierCost: number;
  supplierShipping: number;
  packagingCost?: number;
  totalCost: number;
  recommendedPrice: number;
  expectedEbayFees: number;
  expectedNetProfit: number;
  profitMarginPercent: number;
  breakEvenPrice: number;
}

export interface EbayListingVariant {
  sku: string;
  name: string;
  ean: string | null;
  price: number;
  quantity: number;
  expiryDate?: string | null;
}

export interface EbayListing {
  id: string;
  product_id: string;
  supplier_id: string;
  supplier_url: string;
  marketplace_id: string; // 'EBAY_IT'
  title: string; // max 80 chars
  subtitle?: string;
  category_id: string;
  category_name?: string;
  condition_id: string; // 'NEW' (1000)
  price: number;
  original_supplier_cost: number;
  expected_profit: number;
  quantity: number;
  sku: string | null;
  ean: string | null;
  brand: string | null;
  description_html: string;
  images: string[];
  item_specifics: Record<string, string>;
  shipping_policy_id?: string;
  return_policy_id?: string;
  payment_policy_id?: string;
  status: 'draft' | 'active' | 'ended' | 'error';
  validation_status?: 'ready' | 'needs_review' | 'invalid';
  validation_errors?: string[];
  word_count?: number;
  ebay_item_id?: string | null;
  ebay_offer_id?: string | null;
  error_message?: string | null;
  variants: EbayListingVariant[];
  created_at: string;
  updated_at: string;
  published_at?: string | null;
}

export interface ListingValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning';
}

export interface ListingValidationResult {
  isValid: boolean;
  isReady: boolean;
  wordCount: number;
  wordCountValid: boolean;
  titleValid: boolean;
  checks: ListingValidationCheck[];
}

export interface EbayAccountConfig {
  clientId: string;
  clientSecret: string;
  ruName: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  marketplaceId: string;
  connected: boolean;
  tokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  sellerUsername?: string | null;
}

export interface PriceHistoryItem {
  id: string;
  workspace_id?: string;
  product_id: string;
  variant_id?: string | null;
  supplier_id: string;
  old_price: number | null; // old supplier cost
  new_price: number | null; // new supplier cost
  old_cost?: number | null; // alias / breakdown
  new_cost?: number | null;
  old_selling_price?: number | null;
  new_selling_price?: number | null;
  old_stock?: number | null;
  new_stock?: number | null;
  change_type: 'price_increase' | 'price_decrease' | 'stock_change' | 'auto_recalculated' | 'manual_update';
  status: 'applied' | 'approved' | 'pending_approval' | 'rejected';
  reason?: string;
  breakdown?: {
    supplierCost: number;
    shippingCost: number;
    packagingCost: number;
    ebayFees: number;
    netProfit: number;
    marginPercent: number;
    breakEvenPrice: number;
  };
  changed_at: string;
}

export interface ProductChangeReview {
  id: string;
  workspace_id: string;
  product_id: string;
  product_title?: string;
  field_name: 'title' | 'description' | 'images' | 'sku' | 'ean' | 'variants';
  old_value: any;
  new_value: any;
  status: 'pending' | 'approved' | 'rejected';
  detected_at: string;
  reviewed_at?: string | null;
}

export interface Notification {
  id: string;
  workspace_id: string;
  product_id?: string | null;
  supplier_id?: string | null;
  type:
    | 'price_increase_unprofitable'
    | 'price_decrease_pending'
    | 'price_increase'
    | 'price_decrease'
    | 'out_of_stock'
    | 'low_stock'
    | 'supplier_error'
    | 'content_changed'
    | 'stock_restored';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  is_read: boolean;
  is_resolved: boolean;
  dedup_key: string;
  metadata?: Record<string, any>;
  created_at: string;
  resolved_at?: string | null;
}

export interface MonitoringJob {
  id: string;
  workspace_id: string;
  product_id: string;
  product_title?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  attempts: number;
  max_attempts: number;
  last_error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface EbaySyncEvent {
  id: string;
  workspace_id: string;
  product_id: string;
  event_type: 'price_update' | 'stock_update' | 'out_of_stock' | 'stock_restored';
  payload: Record<string, any>;
  status: 'pending' | 'in_progress' | 'dispatched' | 'failed';
  created_at: string;
}

export interface MonitoringSettings {
  globalIntervalMinutes: number; // default 360 (6 hours)
  defaultEbayQuantity: number; // default 3, selectable 3 or 5
  minimumProfitEur: number; // default 3.00
  packagingCost: number; // default 0.00
  concurrencyLimit: number; // default 2
  maxRetries: number; // default 3
}

export type OrderStatus =
  | 'pending'
  | 'awaiting_purchase'
  | 'awaiting_dispatch'
  | 'purchased'
  | 'shipped'
  | 'delivered'
  | 'returned'
  | 'cancelled'
  | 'pending_fulfillment'
  | 'fulfilled'
  | 'refunded';

export type SupplierPurchasingStatus =
  | 'not_purchased'
  | 'ordered'
  | 'confirmed'
  | 'failed';

export type DeliveryStatus =
  | 'unfulfilled'
  | 'in_transit'
  | 'delivered'
  | 'failed_delivery'
  | 'returned';

export type ReturnStatus =
  | 'none'
  | 'requested'
  | 'approved'
  | 'item_received'
  | 'completed'
  | 'rejected';

export interface OrderLineItem {
  id: string;
  order_id?: string;
  product_id?: string;
  variant_id?: string | null;
  title: string;
  variant_name?: string;
  sku?: string;
  ean?: string;
  quantity: number;
  purchase_cost: number;
  selling_price: number;
  supplier_id?: string;
  supplier_name?: string;
  supplier_url?: string;
  supplier_order_reference?: string | null;
  supplier_status?: 'not_ordered' | 'ordered' | 'shipped' | 'cancelled';
  // Backwards compatibility aliases
  sale_price?: number;
  supplier_cost?: number;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  timestamp: string;
  actor?: string;
  event_type:
    | 'created'
    | 'status_changed'
    | 'supplier_updated'
    | 'fulfillment_updated'
    | 'tracking_added'
    | 'delivered'
    | 'return_requested'
    | 'return_status_changed'
    | 'refund_issued'
    | 'cancelled'
    | 'edited'
    | 'note_added';
  description: string;
  data?: Record<string, any>;
}

export interface OrderRefundItem {
  id: string;
  amount: number;
  reason?: string;
  timestamp: string;
  actor?: string;
}

export interface OrderShippingAddress {
  name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  phone?: string;
}

export interface OrderFinancials {
  itemsTotalSelling: number;
  items_total_selling?: number;
  shippingChargedToBuyer: number;
  shipping_charged_to_buyer?: number;
  totalRevenue: number;
  total_revenue?: number;
  itemsTotalCost: number;
  items_total_cost?: number;
  total_supplier_cost?: number;
  supplierShippingCost: number;
  supplier_shipping_cost?: number;
  packagingCost: number;
  packaging_cost?: number;
  totalCost: number;
  total_cost?: number;
  estimatedEbayFees: number;
  estimated_ebay_fees?: number;
  totalRefunds: number;
  refunds_amount?: number;
  total_refunds?: number;
  netProfit: number;
  net_profit?: number;
  profitMargin: number;
  profit_margin?: number;
}

export interface Order {
  id: string;
  workspace_id?: string;
  order_number?: string;
  external_order_id?: string | null;
  ebay_order_id?: string | null;
  order_source?: 'manual' | 'ebay_sync' | 'external';
  
  // Buyer
  buyer_username?: string;
  buyer_name?: string;
  buyer_email?: string;
  buyer_phone?: string;
  shipping_address?: OrderShippingAddress;

  // Statuses
  status: OrderStatus;
  supplier_purchasing_status?: SupplierPurchasingStatus;
  delivery_status?: DeliveryStatus;

  // Items
  items: OrderLineItem[];

  // Financials
  currency: string;
  total_paid?: number; // total revenue alias
  shipping_charged_to_buyer?: number;
  supplier_shipping_cost?: number;
  packaging_cost?: number;
  estimated_ebay_fees?: number;
  total_cost?: number;
  net_profit?: number;
  profit_margin?: number;

  // Supplier
  supplier_id?: string;
  supplier_name?: string;
  supplier_order_reference?: string | null;
  supplier_purchased_at?: string | null;
  supplier_notes?: string | null;

  // Fulfillment
  carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  dispatched_at?: string | null;
  delivered_at?: string | null;

  // Returns, Refunds & Cancellation
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  return_status?: ReturnStatus;
  return_reason?: string | null;
  returned_at?: string | null;
  refund_amount?: number;
  refund_reason?: string | null;
  refunded_at?: string | null;
  refunds?: OrderRefundItem[];

  // History & Notes
  events?: OrderEvent[];
  notes?: string | null;

  created_at: string;
  updated_at?: string;
}

export interface OrderSummaryStats {
  totalOrders: number;
  total_orders?: number;
  pendingCount: number;
  pending_orders?: number;
  awaitingPurchaseCount: number;
  awaiting_supplier_purchase?: number;
  awaitingDispatchCount: number;
  awaiting_dispatch?: number;
  shippedCount: number;
  shipped_orders?: number;
  deliveredCount: number;
  delivered_orders?: number;
  returnedCount: number;
  returned_orders?: number;
  cancelledCount: number;
  cancelled_orders?: number;
  totalRevenue: number;
  total_revenue?: number;
  totalSupplierCost: number;
  total_supplier_cost?: number;
  totalProfit: number;
  total_net_profit?: number;
}

export interface ScrapingJobItem {
  url: string;
  status: 'pending' | 'processing' | 'success' | 'blocked' | 'failed';
  error?: string;
  product?: Product;
}

export interface ImportHistoryItem {
  id: string;
  url: string;
  title: string;
  source: 'live_scraper' | 'sitemap' | 'html_import' | 'manual' | 'zenrows_scraper';
  status: 'success' | 'blocked' | 'failed';
  message: string;
  timestamp: string;
  supplier_id?: string;
}

export interface ScraperSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  defaultDelaySeconds: number;
  defaultBatchSize: number;
  csvDelimiter: string;
  autoFormatEuroPrices: boolean;
  userAgent: string;
  // eBay & Pricing defaults
  ebayConfig: EbayAccountConfig;
  defaultPricingRule: PricingRule;
  monitoringSettings?: MonitoringSettings;
}

// ==============================================================================
// Phase 1.6B: Financial Dashboard & Profit Analytics Models
// ==============================================================================

export type DateRangePreset = 'today' | 'this_week' | 'this_month' | 'previous_month' | 'custom' | 'all';

export interface FinancialDateRange {
  preset: DateRangePreset;
  startDate: string; // ISO string or YYYY-MM-DD
  endDate: string;   // ISO string or YYYY-MM-DD
  label: string;
}

export interface FinancialSummary {
  currency: string; // default EUR
  totalRevenue: number;
  totalSupplierCost: number;
  shippingChargedToBuyer: number;
  supplierShippingCost: number;
  packagingCost: number;
  totalShippingPackagingCost: number;
  estimatedEbayFees: number;
  confirmedEbayFees: number;
  totalRefunds: number;
  netProfit: number;
  profitMargin: number;
  totalOrders: number;
  completedOrdersCount: number;
  cancelledOrdersCount: number;
  averageOrderValue: number;
  averageOrderProfit: number;
  lossMakingOrdersCount: number;
}

export interface ProductPerformanceItem {
  productId?: string;
  sku?: string;
  title: string;
  variantName?: string;
  supplierId?: string;
  supplierName?: string;
  unitsSold: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMargin: number;
}

export interface SupplierCostBreakdown {
  supplierId: string;
  supplierName: string;
  ordersCount: number;
  unitsSold: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMargin: number;
}

export interface LossMakingOrder {
  orderId: string;
  orderNumber: string;
  buyerName?: string;
  date: string;
  revenue: number;
  supplierCost: number;
  shippingAndPackagingCost: number;
  estimatedEbayFees: number;
  refunds: number;
  netLoss: number; // positive number representing the loss
  lossReason: string;
}

export interface CancellationReasonBreakdown {
  reason: string;
  count: number;
  percentage: number;
  potentialRevenueLost: number;
}

export interface CancellationAnalysis {
  cancelledOrdersCount: number;
  completedOrdersCount: number;
  cancellationRate: number; // percentage
  potentialRevenueLost: number;
  reasons: CancellationReasonBreakdown[];
  totalRefundsAmount: number;
  refundsCount: number;
}

export interface FinancialTrendItem {
  date: string; // YYYY-MM-DD
  label: string; // Short Italian label, e.g. "04 Nov"
  revenue: number;
  costs: number;
  profit: number;
  ordersCount: number;
}

export interface FinancialComparisonPeriod {
  currentRevenue: number;
  previousRevenue: number;
  revenueGrowthPercent: number;
  currentProfit: number;
  previousProfit: number;
  profitGrowthPercent: number;
  currentOrdersCount: number;
  previousOrdersCount: number;
  ordersGrowthPercent: number;
}

export interface FinancialReport {
  workspaceId?: string;
  generatedAt: string;
  currency: string; // 'EUR'
  dateRange: FinancialDateRange;
  summary: FinancialSummary;
  trends: FinancialTrendItem[];
  comparison?: FinancialComparisonPeriod;
  bestSellingProducts: ProductPerformanceItem[];
  mostProfitableProducts: ProductPerformanceItem[];
  supplierComparisons: SupplierCostBreakdown[];
  lossMakingOrders: LossMakingOrder[];
  cancellationAnalysis: CancellationAnalysis;
}
