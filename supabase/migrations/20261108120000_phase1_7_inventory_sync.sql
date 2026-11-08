-- ==============================================================================
-- Migration: 20261108120000_phase1_7_inventory_sync.sql
-- Description: Phase 1.7 Inventory Synchronization & Catalog-to-Order Linkage
--              - Stock reservation and permanent deduction tracking
--              - Threshold and supplier stock tracking on products & variants
--              - Reversible audit ledger table for inventory movements
-- ==============================================================================

-- 1. Extend products with inventory threshold and reserved tracking
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_threshold INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS reserved_stock INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_stock INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS supplier_availability TEXT DEFAULT 'InStock';

-- 2. Extend product_variants with inventory threshold and reserved tracking
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS stock_threshold INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS reserved_stock INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_stock INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS supplier_availability TEXT DEFAULT 'InStock';

-- 3. Extend orders with inventory movement flags for idempotency protection
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS inventory_reserved BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_deducted BOOLEAN DEFAULT false;

-- 4. Create inventory_movements table for atomic audit ledger
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  order_id TEXT,
  movement_type TEXT NOT NULL, -- 'reservation', 'reservation_release', 'deduction', 'return_restock', 'manual_adjustment', 'monitoring_sync'
  quantity INTEGER NOT NULL,
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reserved_before INTEGER NOT NULL,
  reserved_after INTEGER NOT NULL,
  reason TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Indexes for fast lookup and reporting
CREATE INDEX IF NOT EXISTS idx_inv_movements_ws_created
  ON public.inventory_movements (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_movements_ws_prod_var
  ON public.inventory_movements (workspace_id, product_id, variant_id);

CREATE INDEX IF NOT EXISTS idx_inv_movements_ws_order
  ON public.inventory_movements (workspace_id, order_id);

-- 6. Helper function for atomic inventory reservation
CREATE OR REPLACE FUNCTION public.reserve_product_stock(
  p_workspace_id UUID,
  p_product_id TEXT,
  p_variant_id TEXT,
  p_qty INTEGER,
  p_order_id TEXT,
  p_actor TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stock INTEGER;
  v_reserved INTEGER;
  v_new_reserved INTEGER;
BEGIN
  -- If variant_id provided, lock and update variant
  IF p_variant_id IS NOT NULL AND p_variant_id != '' THEN
    SELECT stock_quantity, COALESCE(reserved_stock, 0)
      INTO v_stock, v_reserved
      FROM public.product_variants
      WHERE id = p_variant_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Variant not found');
    END IF;

    v_new_reserved := v_reserved + p_qty;
    UPDATE public.product_variants
      SET reserved_stock = v_new_reserved,
          updated_at = now()
      WHERE id = p_variant_id;
  ELSE
    SELECT stock_quantity, COALESCE(reserved_stock, 0)
      INTO v_stock, v_reserved
      FROM public.products
      WHERE id = p_product_id AND workspace_id = p_workspace_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Product not found');
    END IF;

    v_new_reserved := v_reserved + p_qty;
    UPDATE public.products
      SET reserved_stock = v_new_reserved,
          updated_at = now()
      WHERE id = p_product_id AND workspace_id = p_workspace_id;
  END IF;

  -- Record audit movement
  INSERT INTO public.inventory_movements (
    workspace_id, product_id, variant_id, order_id, movement_type,
    quantity, stock_before, stock_after, reserved_before, reserved_after,
    reason, actor
  ) VALUES (
    p_workspace_id, p_product_id, p_variant_id, p_order_id, 'reservation',
    p_qty, v_stock, v_stock, v_reserved, v_new_reserved,
    'Order reservation created', p_actor
  );

  RETURN jsonb_build_object(
    'ok', true,
    'onHandStock', v_stock,
    'reservedStock', v_new_reserved,
    'availableStock', GREATEST(0, v_stock - v_new_reserved)
  );
END;
$$;
