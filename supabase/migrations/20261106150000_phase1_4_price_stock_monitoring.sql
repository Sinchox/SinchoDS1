-- ==============================================================================
-- Migration: 20261106150000_phase1_4_price_stock_monitoring.sql
-- Description: Phase 1.4 Automatic Price & Stock Monitoring schema additions:
--              - Products monitoring fields and calculated pricing/quantity
--              - Price history enhancements for approvals, costs, and audit logs
--              - Product change reviews queue for content alterations
--              - Persistent workspace-isolated notifications
--              - Monitoring jobs with concurrency and retry tracking
--              - eBay sync events queue for reliable future dispatch
-- ==============================================================================

-- 1. Extend products with monitoring and calculated inventory attributes
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monitoring_status VARCHAR(50) DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS last_successful_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_monitoring_error TEXT,
  ADD COLUMN IF NOT EXISTS calculated_selling_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS calculated_quantity INTEGER;

CREATE INDEX IF NOT EXISTS idx_products_workspace_next_check
  ON public.products (workspace_id, next_check_at);

CREATE INDEX IF NOT EXISTS idx_products_workspace_monitoring_status
  ON public.products (workspace_id, monitoring_status);

-- 2. Extend price_history with audit columns, breakdown, and approval status
ALTER TABLE public.price_history
  ADD COLUMN IF NOT EXISTS variant_id TEXT,
  ADD COLUMN IF NOT EXISTS old_cost NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS new_cost NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS old_selling_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS new_selling_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS change_type VARCHAR(50) DEFAULT 'manual_update',
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'applied',
  ADD COLUMN IF NOT EXISTS breakdown JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE INDEX IF NOT EXISTS idx_price_history_workspace_status
  ON public.price_history (workspace_id, status);

-- 3. Product Change Reviews Queue (Title, Description, Images, SKU, EAN, Variants)
CREATE TABLE IF NOT EXISTS public.product_change_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  field_name VARCHAR(50) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_change_reviews_workspace_status
  ON public.product_change_reviews (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_change_reviews_product
  ON public.product_change_reviews (product_id, status);

-- 4. Persistent Workspace Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id TEXT,
  type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'warning', -- 'info' | 'warning' | 'error' | 'critical'
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  dedup_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_read
  ON public.notifications (workspace_id, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_resolved
  ON public.notifications (workspace_id, is_resolved);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_dedup
  ON public.notifications (workspace_id, dedup_key);

-- 5. Persistent Monitoring Jobs Queue
CREATE TABLE IF NOT EXISTS public.monitoring_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed' | 'retrying'
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_workspace_status
  ON public.monitoring_jobs (workspace_id, status, created_at);

-- 6. Reliable eBay Sync Events (Boundary for Future eBay Integration Phase)
CREATE TABLE IF NOT EXISTS public.ebay_sync_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, -- 'price_update' | 'stock_update' | 'out_of_stock' | 'stock_restored'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending' | 'in_progress' | 'dispatched' | 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ebay_sync_events_workspace_status
  ON public.ebay_sync_events (workspace_id, status);

-- ==============================================================================
-- 7. Row Level Security & Permissions
-- ==============================================================================
ALTER TABLE public.product_change_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_sync_events ENABLE ROW LEVEL SECURITY;

-- Product Change Reviews RLS
CREATE POLICY "change_reviews_select_member" ON public.product_change_reviews
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "change_reviews_modify_member" ON public.product_change_reviews
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- Notifications RLS
CREATE POLICY "notifications_select_member" ON public.notifications
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "notifications_modify_member" ON public.notifications
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- Monitoring Jobs RLS
CREATE POLICY "monitoring_jobs_select_member" ON public.monitoring_jobs
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "monitoring_jobs_modify_member" ON public.monitoring_jobs
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- eBay Sync Events RLS
CREATE POLICY "ebay_sync_events_select_member" ON public.ebay_sync_events
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "ebay_sync_events_modify_member" ON public.ebay_sync_events
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

-- Service-role bypass policies
CREATE POLICY "change_reviews_service_role" ON public.product_change_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "notifications_service_role" ON public.notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "monitoring_jobs_service_role" ON public.monitoring_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "ebay_sync_events_service_role" ON public.ebay_sync_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Table Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_change_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitoring_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebay_sync_events TO authenticated;

GRANT ALL ON public.product_change_reviews TO service_role;
GRANT ALL ON public.notifications TO service_role;
GRANT ALL ON public.monitoring_jobs TO service_role;
GRANT ALL ON public.ebay_sync_events TO service_role;
