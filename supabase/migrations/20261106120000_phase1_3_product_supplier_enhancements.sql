-- ==============================================================================
-- Migration: 20261106120000_phase1_3_product_supplier_enhancements.sql
-- Description: Non-breaking composite indexes and column constraints for Phase 1.3
--              Product & Supplier Management with workspace data isolation.
-- ==============================================================================

-- 1. Ensure composite indexes on products for status and workspace filtering
CREATE INDEX IF NOT EXISTS idx_products_workspace_status
  ON public.products (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_products_workspace_supplier
  ON public.products (workspace_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_products_workspace_url_norm
  ON public.products (workspace_id, url);

-- 2. Ensure composite indexes on product_variants
CREATE INDEX IF NOT EXISTS idx_product_variants_prod_sku
  ON public.product_variants (product_id, sku);

CREATE INDEX IF NOT EXISTS idx_product_variants_prod_ean
  ON public.product_variants (product_id, ean);

-- 3. Ensure composite indexes on suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_workspace_active
  ON public.suppliers (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_suppliers_global
  ON public.suppliers (is_global)
  WHERE is_global = true;

-- 4. Document config schema structure for suppliers:
-- {
--   "features": { "sitemap": boolean, "variants": boolean, "lotExpiry": boolean, "liveScraping": boolean, "htmlImport": boolean },
--   "fetchMethod": "direct" | "zenrows",
--   "jsRender": boolean,
--   "connected": boolean,
--   "shippingCost": number,
--   "stockThreshold": number,
--   "pricingRule": { "targetMarginPercent": number, "targetFixedProfit": number, ... },
--   "parserConfig": { "titleSelector": string, "priceSelector": string, ... }
-- }
