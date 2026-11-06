-- ==============================================================================
-- Migration: 20261106180000_phase1_6a_orders_fulfillment.sql
-- Description: Phase 1.6A Orders & Fulfillment Foundation:
--              - Decouple orders table from mandatory live eBay order IDs
--              - Support manual order creation, multi-item variant orders, and audit event logs
--              - Workspace-isolated external_order_id with uniqueness enforcement
--              - Supplier purchasing references and fulfillment tracking fields
--              - Returns, refunds, and cancellation audit records
--              - Order-level financial metrics (revenue, supplier cost, eBay fee estimate, net profit)
-- ==============================================================================

-- 1. Relax legacy constraints from initial schema
ALTER TABLE public.orders 
  ALTER COLUMN ebay_order_id DROP NOT NULL;

-- Drop legacy unique constraint on ebay_order_id if present to allow workspace-scoped uniqueness
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'orders_ebay_order_id_key' 
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_ebay_order_id_key;
  END IF;
END $$;

-- 2. Extend orders with Phase 1.6A fields
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS external_order_id TEXT,
  ADD COLUMN IF NOT EXISTS order_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS buyer_name TEXT,
  ADD COLUMN IF NOT EXISTS buyer_email TEXT,
  ADD COLUMN IF NOT EXISTS buyer_phone TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS supplier_purchasing_status TEXT DEFAULT 'not_purchased',
  ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'unfulfilled',
  ADD COLUMN IF NOT EXISTS shipping_charged_to_buyer NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS supplier_shipping_cost NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS packaging_cost NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS estimated_ebay_fees NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS net_profit NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS profit_margin NUMERIC(6, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS supplier_id TEXT,
  ADD COLUMN IF NOT EXISTS supplier_name TEXT,
  ADD COLUMN IF NOT EXISTS supplier_order_reference TEXT,
  ADD COLUMN IF NOT EXISTS supplier_purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supplier_notes TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunds JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS events JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Workspace-scoped partial unique index on external_order_id (prevents duplicates per workspace while allowing multiple nulls/empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_workspace_external_id
  ON public.orders (workspace_id, external_order_id)
  WHERE external_order_id IS NOT NULL AND external_order_id != '';

-- 4. Fast filtering indexes
CREATE INDEX IF NOT EXISTS idx_orders_workspace_status
  ON public.orders (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_orders_workspace_created_at
  ON public.orders (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_workspace_supplier_status
  ON public.orders (workspace_id, supplier_purchasing_status);

CREATE INDEX IF NOT EXISTS idx_orders_workspace_delivery_status
  ON public.orders (workspace_id, delivery_status);

CREATE INDEX IF NOT EXISTS idx_orders_workspace_supplier_id
  ON public.orders (workspace_id, supplier_id);
