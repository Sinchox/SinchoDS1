-- ==============================================================================
-- SinchoDS Phase 1.1: Secure Database & Multi-Workspace Foundation Migration
-- File: /supabase/migrations/20261104163000_phase1_multi_workspace.sql
-- 
-- Description:
--   Transforms the database schema into a production-grade multi-workspace architecture.
--   Enforces strict Role-Based Access Control (RBAC) across exactly four roles:
--     - owner: Full control, delete workspace, manage members & roles
--     - admin: Full resource CRUD, manage members (cannot demote/remove owner, cannot alter workspace security)
--     - manager: Full resource CRUD (products, listings, suppliers, orders); no member/workspace security management
--     - viewer: Read-only access to products, suppliers, listings, and metrics
--   Replaces ALL pre-existing permissive USING(true) policies with granular RLS policies.
--   Preserves all existing data by migrating records to a seeded default workspace.
--   Removes permanent hardcoded workspace defaults; future inserts must explicitly specify workspace_id.
--   Scopes products.url uniqueness to the workspace; drops any existing global URL unique constraint/index.
--   Supports global read-only suppliers and workspace-specific mutable suppliers with udt_name type inspection (JSONB/JSON/TEXT).
--   Strictly protects eBay credentials: only service_role can read or write tokens.
--   Prevents legacy workspace takeover: requires genuine server secret (Supabase Vault or private table); regular users receive isolated workspaces.
--   Fixes workspace deletion cascade conflict with last-owner protection via atomic delete_workspace() and internal lock table.
--   Hardens all SECURITY DEFINER functions with SET search_path = '' and fully qualified object references.
--   Audits and restricts table-level and column-level database privileges for anon, authenticated, and service_role.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Enable Required Extensions
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. Workspaces & Workspace Members Core Tables
-- ------------------------------------------------------------------------------

-- Workspaces table
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON public.workspaces (slug);
CREATE INDEX IF NOT EXISTS idx_workspaces_created_by ON public.workspaces (created_by);

-- Workspace members table with the 4 distinct roles
CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'viewer')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_workspace_members_user UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON public.workspace_members (user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON public.workspace_members (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_role ON public.workspace_members (workspace_id, role);

-- Internal administrative tables (Zero access to anon/authenticated; used exclusively by SECURITY DEFINER RPCs)
CREATE TABLE IF NOT EXISTS public.workspace_deletion_locks (
    workspace_id UUID PRIMARY KEY,
    authorized_by UUID NOT NULL,
    locked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.legacy_workspace_claim_auth (
    workspace_id UUID PRIMARY KEY,
    authorized_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Internal private secrets table for legacy workspace claiming
-- Zero access to anon/authenticated; used exclusively by public.claim_legacy_workspace()
CREATE TABLE IF NOT EXISTS public.legacy_workspace_claim_secrets (
    secret_name TEXT PRIMARY KEY,
    secret_value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Explicitly revoke all privileges from PUBLIC, anon, and authenticated
REVOKE ALL ON public.workspace_deletion_locks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.legacy_workspace_claim_auth FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.legacy_workspace_claim_secrets FROM PUBLIC, anon, authenticated;

-- Enable Row Level Security on internal administrative tables with zero user-facing policies
ALTER TABLE public.workspace_deletion_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_workspace_claim_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_workspace_claim_secrets ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. Default Workspace Seed (Data Preservation)
-- ------------------------------------------------------------------------------
-- Deterministic UUID to preserve all existing records during migration.
INSERT INTO public.workspaces (id, name, slug)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Default Workspace',
    'default'
)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 4. Alter Existing Tables to Add workspace_id & Preserve Existing Records
-- ------------------------------------------------------------------------------

-- 4.1 Suppliers: Supports both global reusable suppliers (workspace_id IS NULL)
--     and workspace-specific suppliers (workspace_id IS NOT NULL).
ALTER TABLE public.suppliers 
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_suppliers_workspace_id ON public.suppliers (workspace_id);

-- Safely inspect and normalize suppliers.config column type.
-- Inspects information_schema.columns.udt_name and explicitly handles JSONB, JSON, and TEXT.
-- Preserves existing values; verifies valid JSON formatting for TEXT before conversion;
-- Stops with a clear exception if conversion cannot be guaranteed or if an unexpected type exists.
DO $$
DECLARE
    v_udt_name TEXT;
    rec RECORD;
    test_jsonb JSONB;
    invalid_count INTEGER := 0;
    invalid_samples TEXT := '';
BEGIN
    SELECT udt_name INTO v_udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'suppliers'
      AND column_name = 'config';

    IF v_udt_name IS NULL THEN
        -- Column does not exist: create as JSONB with default '{}'
        ALTER TABLE public.suppliers ADD COLUMN config JSONB DEFAULT '{}'::jsonb;

    ELSIF v_udt_name = 'jsonb' THEN
        -- Already JSONB: Ensure default is configured
        ALTER TABLE public.suppliers ALTER COLUMN config SET DEFAULT '{}'::jsonb;

    ELSIF v_udt_name = 'json' THEN
        -- Safely convert JSON to JSONB (preserves existing valid JSON values identically)
        ALTER TABLE public.suppliers 
            ALTER COLUMN config TYPE JSONB USING (
                CASE 
                    WHEN config IS NULL THEN NULL 
                    ELSE config::jsonb 
                END
            );
        ALTER TABLE public.suppliers ALTER COLUMN config SET DEFAULT '{}'::jsonb;

    ELSIF v_udt_name IN ('text', 'varchar', 'bpchar') THEN
        -- Column is TEXT/VARCHAR: Verify that all non-null, non-empty values are strictly valid JSON
        FOR rec IN 
            SELECT id, config::text AS raw_val 
            FROM public.suppliers 
            WHERE config IS NOT NULL 
              AND TRIM(config::text) <> ''
        LOOP
            BEGIN
                test_jsonb := rec.raw_val::jsonb;
            EXCEPTION WHEN OTHERS THEN
                invalid_count := invalid_count + 1;
                IF invalid_count <= 5 THEN
                    invalid_samples := invalid_samples || rec.id || ' ("' || rec.raw_val || '"); ';
                END IF;
            END;
        END LOOP;

        IF invalid_count > 0 THEN
            RAISE EXCEPTION 'Cannot convert suppliers.config from TEXT to JSONB: % records contain invalid JSON syntax. Samples: %', 
                invalid_count, invalid_samples;
        END IF;

        -- Safe conversion of verified TEXT/VARCHAR to JSONB
        ALTER TABLE public.suppliers 
            ALTER COLUMN config TYPE JSONB USING (
                CASE 
                    WHEN config IS NULL THEN NULL 
                    WHEN TRIM(config::text) = '' THEN '{}'::jsonb 
                    ELSE config::text::jsonb 
                END
            );
        ALTER TABLE public.suppliers ALTER COLUMN config SET DEFAULT '{}'::jsonb;

    ELSE
        -- Unexpected data type: abort migration immediately to prevent data corruption
        RAISE EXCEPTION 'Unsupported data type "%" detected for public.suppliers.config. Expected jsonb, json, or text.', v_udt_name;
    END IF;
END;
$$;

-- Assign all existing non-global suppliers to the default workspace.
-- Global suppliers are those marked with config->>'is_global' = 'true' or standard catalog suppliers ('pluspower').
UPDATE public.suppliers
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE id NOT IN ('pluspower')
  AND (
      config IS NULL 
      OR pg_catalog.jsonb_typeof(config) IS DISTINCT FROM 'object'
      OR config->>'is_global' IS DISTINCT FROM 'true'
  )
  AND workspace_id IS NULL;

-- Ensure designated global reusable suppliers retain workspace_id = NULL
UPDATE public.suppliers
SET workspace_id = NULL
WHERE id = 'pluspower'
   OR (
       config IS NOT NULL 
       AND pg_catalog.jsonb_typeof(config) = 'object' 
       AND config->>'is_global' = 'true'
   );

-- 4.2 Products: Add column, migrate existing data, drop permanent default, scope URL uniqueness
ALTER TABLE public.products 
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.products 
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid 
WHERE workspace_id IS NULL;

ALTER TABLE public.products ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN workspace_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS idx_products_workspace_id ON public.products (workspace_id);

-- Dynamically drop any pre-existing global unique constraint or unique index on products(url)
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop constraints covering only the 'url' column
    FOR r IN (
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.products'::regclass 
          AND contype = 'u'
          AND conkey = ARRAY[(
              SELECT attnum 
              FROM pg_attribute 
              WHERE attrelid = 'public.products'::regclass 
                AND attname = 'url'
          )]
    ) LOOP
        EXECUTE pg_catalog.format('ALTER TABLE public.products DROP CONSTRAINT IF EXISTS %I;', r.conname);
    END LOOP;

    -- Drop standalone unique indexes indexing only 'url'
    FOR r IN (
        SELECT i.relname AS indexname
        FROM pg_index x
        JOIN pg_class c ON c.oid = x.indrelid
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'products'
          AND x.indisunique
          AND x.indkey::text = (
              SELECT attnum::text 
              FROM pg_attribute 
              WHERE attrelid = c.oid 
                AND attname = 'url'
          )
    ) LOOP
        EXECUTE pg_catalog.format('DROP INDEX IF EXISTS public.%I;', r.indexname);
    END LOOP;
END;
$$;

-- Drop standard index/constraint names defensively
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_url_key;
DROP INDEX IF EXISTS public.idx_products_url;

-- Add composite uniqueness scoped to workspace_id + url
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_products_workspace_url'
    ) THEN
        ALTER TABLE public.products 
            ADD CONSTRAINT uq_products_workspace_url UNIQUE (workspace_id, url);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_products_workspace_url ON public.products (workspace_id, url);

-- 4.3 eBay Listings: Add column, migrate existing data, drop permanent default
ALTER TABLE public.ebay_listings 
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.ebay_listings 
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid 
WHERE workspace_id IS NULL;

ALTER TABLE public.ebay_listings ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.ebay_listings ALTER COLUMN workspace_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ebay_listings_workspace_id ON public.ebay_listings (workspace_id);

-- 4.4 eBay Accounts: Add column, migrate existing data, drop permanent default
ALTER TABLE public.ebay_accounts 
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.ebay_accounts 
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid 
WHERE workspace_id IS NULL;

ALTER TABLE public.ebay_accounts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.ebay_accounts ALTER COLUMN workspace_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ebay_accounts_workspace_id ON public.ebay_accounts (workspace_id);

-- 4.5 Price History: Add column, migrate existing data, drop permanent default
ALTER TABLE public.price_history 
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.price_history 
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid 
WHERE workspace_id IS NULL;

ALTER TABLE public.price_history ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.price_history ALTER COLUMN workspace_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS idx_price_history_workspace_id ON public.price_history (workspace_id);

-- 4.6 Orders: Add column, migrate existing data, drop permanent default
ALTER TABLE public.orders 
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.orders 
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid 
WHERE workspace_id IS NULL;

ALTER TABLE public.orders ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN workspace_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS idx_orders_workspace_id ON public.orders (workspace_id);

-- 4.7 Import History: Add column, migrate existing data, drop permanent default
ALTER TABLE public.import_history 
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.import_history 
SET workspace_id = '00000000-0000-0000-0000-000000000001'::uuid 
WHERE workspace_id IS NULL;

ALTER TABLE public.import_history ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.import_history ALTER COLUMN workspace_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS idx_import_history_workspace_id ON public.import_history (workspace_id);

-- ------------------------------------------------------------------------------
-- 5. Secure Helper Functions (Hardened: search_path = '', Fully Qualified)
-- ------------------------------------------------------------------------------

-- 5.1 Get user role in a workspace
CREATE OR REPLACE FUNCTION public.get_workspace_role(check_workspace_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_role TEXT;
    calling_user UUID;
BEGIN
    calling_user := auth.uid();
    IF calling_user IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT wm.role INTO user_role
    FROM public.workspace_members wm
    WHERE wm.workspace_id = check_workspace_id
      AND wm.user_id = calling_user;

    RETURN user_role;
END;
$$;

-- 5.2 Check if caller belongs to workspace
CREATE OR REPLACE FUNCTION public.is_workspace_member(check_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = check_workspace_id
          AND wm.user_id = auth.uid()
    );
$$;

-- 5.3 Check if caller has one of the allowed roles
CREATE OR REPLACE FUNCTION public.has_workspace_role(check_workspace_id UUID, required_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = check_workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role = ANY(required_roles)
    );
$$;

-- 5.4 Return all workspace IDs the user belongs to
CREATE OR REPLACE FUNCTION public.get_user_workspace_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT wm.workspace_id
    FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid();
$$;

-- Restrict helper function execution permissions
REVOKE ALL ON FUNCTION public.get_workspace_role(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_workspace_role(UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_workspace_ids() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_workspace_role(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_workspace_role(UUID, TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_workspace_ids() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. Trigger: Enforce Membership Security, Owner Protection & Immutability
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_workspace_member_safety()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_id UUID;
    caller_role TEXT;
    target_workspace UUID;
    owner_count INTEGER;
    total_member_count INTEGER;
    is_service_role BOOLEAN;
BEGIN
    caller_id := auth.uid();

    -- Service role verification (JWT claim only; never trust current_user in SECURITY DEFINER):
    is_service_role := (
        COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
    );

    IF caller_id IS NULL THEN
        IF is_service_role THEN
            RETURN COALESCE(NEW, OLD);
        ELSE
            RAISE EXCEPTION 'Access Denied: Unauthenticated modification of workspace members is forbidden.';
        END IF;
    END IF;

    target_workspace := COALESCE(NEW.workspace_id, OLD.workspace_id);

    -- 1. Enforce Immutability: workspace_id and user_id cannot be altered once assigned
    IF TG_OP = 'UPDATE' THEN
        IF NEW.workspace_id <> OLD.workspace_id OR NEW.user_id <> OLD.user_id THEN
            RAISE EXCEPTION 'Immutability violation: workspace_id and user_id cannot be modified.';
        END IF;
    END IF;

    -- 2. Concurrency protection: Lock workspace row to prevent concurrent race conditions
    -- when mutating or removing members.
    PERFORM 1 FROM public.workspaces WHERE id = target_workspace FOR UPDATE;

    -- Look up caller's current role in the affected workspace
    SELECT wm.role INTO caller_role
    FROM public.workspace_members wm
    WHERE wm.workspace_id = target_workspace
      AND wm.user_id = caller_id;

    -- --------------------------------------------------------------------------
    -- INSERT VALIDATION
    -- --------------------------------------------------------------------------
    IF TG_OP = 'INSERT' THEN
        SELECT pg_catalog.count(*) INTO total_member_count
        FROM public.workspace_members wm
        WHERE wm.workspace_id = target_workspace;

        -- CASE A: Initial Member Bootstrap / Atomic Workspace Creation (0 members exist)
        IF total_member_count = 0 THEN
            IF NEW.role <> 'owner' THEN
                RAISE EXCEPTION 'Invalid Operation: The initial workspace member must be assigned the owner role.';
            END IF;

            -- CRITICAL SECURITY FIX: The legacy workspace CANNOT be claimed through standard initial insertion!
            IF target_workspace = '00000000-0000-0000-0000-000000000001'::uuid THEN
                -- Must be actively authorized via claim_legacy_workspace()
                IF NOT EXISTS (
                    SELECT 1 FROM public.legacy_workspace_claim_auth auth_lock
                    WHERE auth_lock.workspace_id = target_workspace
                      AND auth_lock.authorized_user_id = NEW.user_id
                ) THEN
                    RAISE EXCEPTION 'Access Denied: The legacy workspace can only be claimed through the authorized claim_legacy_workspace() procedure.';
                END IF;

                RETURN NEW;
            END IF;

            -- For any regular workspace, caller must be the verified workspace creator
            IF NOT EXISTS (
                SELECT 1 FROM public.workspaces w
                WHERE w.id = target_workspace 
                  AND w.created_by = caller_id
            ) THEN
                RAISE EXCEPTION 'Access Denied: Only the workspace creator can claim the initial owner role.';
            END IF;

            RETURN NEW;
        END IF;

        -- CASE B: Existing Workspace Membership Additions (members already exist)
        -- Only owners and admins can invite or add new members (explicitly reject NULL)
        IF caller_role IS NULL OR caller_role NOT IN ('owner', 'admin') THEN
            RAISE EXCEPTION 'Access Denied: You must be an owner or admin to add members.';
        END IF;

        -- Only an owner can grant the owner role
        IF NEW.role = 'owner' AND (caller_role IS NULL OR caller_role <> 'owner') THEN
            RAISE EXCEPTION 'Access Denied: Only an existing owner can grant the owner role.';
        END IF;

        -- Admins can only add managers or viewers (cannot create admins or owners)
        IF caller_role = 'admin' AND NEW.role IN ('admin', 'owner') THEN
            RAISE EXCEPTION 'Access Denied: Admins cannot grant admin or owner roles.';
        END IF;

        RETURN NEW;
    END IF;

    -- --------------------------------------------------------------------------
    -- UPDATE VALIDATION
    -- --------------------------------------------------------------------------
    IF TG_OP = 'UPDATE' THEN
        -- Only owners and admins can modify member roles (explicitly reject NULL)
        IF caller_role IS NULL OR caller_role NOT IN ('owner', 'admin') THEN
            RAISE EXCEPTION 'Access Denied: Only owners and admins can modify member roles.';
        END IF;

        -- Protecting owner records
        IF OLD.role = 'owner' THEN
            IF caller_role IS NULL OR caller_role <> 'owner' THEN
                RAISE EXCEPTION 'Access Denied: Only a workspace owner can demote or modify an owner.';
            END IF;

            -- Prevent demoting the last remaining owner
            IF NEW.role <> 'owner' THEN
                SELECT pg_catalog.count(*) INTO owner_count
                FROM public.workspace_members wm
                WHERE wm.workspace_id = target_workspace
                  AND wm.role = 'owner'
                  AND wm.user_id <> OLD.user_id;

                IF owner_count < 1 THEN
                    RAISE EXCEPTION 'Invalid Operation: Cannot demote the last owner of the workspace.';
                END IF;
            END IF;
        END IF;

        -- Promoting to owner requires caller to be an owner
        IF NEW.role = 'owner' AND OLD.role <> 'owner' THEN
            IF caller_role IS NULL OR caller_role <> 'owner' THEN
                RAISE EXCEPTION 'Access Denied: Only an existing owner can promote a member to owner.';
            END IF;
        END IF;

        -- Admins cannot modify other admins or promote anyone to admin or owner
        IF caller_role = 'admin' THEN
            IF OLD.role IN ('owner', 'admin') AND OLD.user_id <> caller_id THEN
                RAISE EXCEPTION 'Access Denied: Admins cannot modify owner or admin records.';
            END IF;

            IF NEW.role IN ('owner', 'admin') THEN
                RAISE EXCEPTION 'Access Denied: Admins cannot promote members to admin or owner.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- --------------------------------------------------------------------------
    -- DELETE VALIDATION
    -- --------------------------------------------------------------------------
    IF TG_OP = 'DELETE' THEN
        -- CRITICAL SECURITY FIX: Verify legitimate workspace deletion via internal lock table
        -- (Never trust user-settable GUC settings).
        IF EXISTS (
            SELECT 1 FROM public.workspace_deletion_locks del_lock
            WHERE del_lock.workspace_id = OLD.workspace_id
        ) THEN
            RETURN OLD;
        END IF;

        -- Self-removal is permitted, or removal by owner/admin (explicitly reject NULL)
        IF (caller_role IS NULL OR caller_role NOT IN ('owner', 'admin')) AND OLD.user_id <> caller_id THEN
            RAISE EXCEPTION 'Access Denied: Insufficient permissions to remove this member.';
        END IF;

        -- Owner deletion protection
        IF OLD.role = 'owner' THEN
            IF (caller_role IS NULL OR caller_role <> 'owner') AND OLD.user_id <> caller_id THEN
                RAISE EXCEPTION 'Access Denied: Only a workspace owner can remove another owner.';
            END IF;

            -- Prevent removing the last owner of an active workspace
            SELECT pg_catalog.count(*) INTO owner_count
            FROM public.workspace_members wm
            WHERE wm.workspace_id = target_workspace
              AND wm.role = 'owner';

            IF owner_count <= 1 THEN
                RAISE EXCEPTION 'Invalid Operation: A workspace must retain at least one owner.';
            END IF;
        END IF;

        -- Admins cannot remove owners or other admins
        IF caller_role = 'admin' AND OLD.role IN ('owner', 'admin') AND OLD.user_id <> caller_id THEN
            RAISE EXCEPTION 'Access Denied: Admins cannot remove owners or other admins.';
        END IF;

        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_member_safety ON public.workspace_members;
CREATE TRIGGER trg_workspace_member_safety
BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_member_safety();

-- ------------------------------------------------------------------------------
-- 7. Atomic Workspace Operations & Controlled Bootstrap RPCs
-- ------------------------------------------------------------------------------

-- 7.1 Secure function to atomically create a workspace and make caller the owner
CREATE OR REPLACE FUNCTION public.create_workspace(
    workspace_name TEXT,
    workspace_slug TEXT DEFAULT NULL,
    target_owner_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_id UUID;
    effective_owner UUID;
    new_ws_id UUID;
    clean_slug TEXT;
    trimmed_name TEXT;
    is_service_role BOOLEAN;
BEGIN
    caller_id := auth.uid();
    is_service_role := (
        COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
    );

    IF caller_id IS NOT NULL THEN
        -- Authenticated users CANNOT specify another user ID; must own their own workspace
        effective_owner := caller_id;
    ELSIF is_service_role THEN
        IF target_owner_id IS NULL THEN
            RAISE EXCEPTION 'Service role must specify target_owner_id.';
        END IF;
        effective_owner := target_owner_id;
    ELSE
        RAISE EXCEPTION 'Authentication required to create a workspace.';
    END IF;

    trimmed_name := TRIM(workspace_name);
    IF trimmed_name IS NULL OR pg_catalog.length(trimmed_name) = 0 THEN
        RAISE EXCEPTION 'Workspace name cannot be empty.';
    END IF;

    clean_slug := NULLIF(TRIM(pg_catalog.lower(workspace_slug)), '');

    -- Atomic insertion: creates workspace and owner membership in the same transaction
    INSERT INTO public.workspaces (name, slug, created_by)
    VALUES (trimmed_name, clean_slug, effective_owner)
    RETURNING id INTO new_ws_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (new_ws_id, effective_owner, 'owner');

    RETURN new_ws_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace(TEXT, TEXT, UUID) TO authenticated, service_role;

-- 7.2 Secure atomic owner-only workspace deletion path (Guaranteed against GUC spoofing)
CREATE OR REPLACE FUNCTION public.delete_workspace(target_workspace UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_id UUID;
    is_owner BOOLEAN;
    is_service_role BOOLEAN;
BEGIN
    caller_id := auth.uid();
    is_service_role := (
        COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
    );

    IF caller_id IS NULL AND NOT is_service_role THEN
        RAISE EXCEPTION 'Authentication required to delete a workspace.';
    END IF;

    -- Prevent deletion of the primary legacy data workspace
    IF target_workspace = '00000000-0000-0000-0000-000000000001'::uuid THEN
        RAISE EXCEPTION 'Invalid Operation: The default legacy workspace cannot be deleted.';
    END IF;

    -- Lock the target workspace row with SELECT ... FOR UPDATE before checking ownership and deleting it.
    -- Reject the operation if the workspace does not exist.
    PERFORM 1 FROM public.workspaces WHERE id = target_workspace FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace not found.';
    END IF;

    -- Verify caller is an active owner of the target workspace (if not service_role)
    IF NOT is_service_role THEN
        SELECT EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_id = target_workspace
              AND wm.user_id = caller_id
              AND wm.role = 'owner'
        ) INTO is_owner;

        IF NOT is_owner THEN
            RAISE EXCEPTION 'Access Denied: Only a workspace owner can delete the workspace.';
        END IF;
    END IF;

    -- Insert into internal deletion lock table to authorize cascade past safety trigger
    INSERT INTO public.workspace_deletion_locks (workspace_id, authorized_by)
    VALUES (target_workspace, COALESCE(caller_id, '00000000-0000-0000-0000-000000000000'::uuid))
    ON CONFLICT (workspace_id) DO NOTHING;

    -- Delete the workspace; cascading deletes all members and workspace resources atomically
    DELETE FROM public.workspaces WHERE id = target_workspace;

    -- Remove internal lock
    DELETE FROM public.workspace_deletion_locks WHERE workspace_id = target_workspace;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_workspace(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_workspace(UUID) TO authenticated, service_role;

-- 7.3 Regular User Workspace Bootstrap (Guarantees isolation; NEVER assigns legacy workspace)
CREATE OR REPLACE FUNCTION public.bootstrap_initial_workspace(workspace_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_id UUID;
    existing_ws UUID;
BEGIN
    caller_id := auth.uid();
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to bootstrap workspace.';
    END IF;

    -- Transaction-level advisory lock serializes workspace initialization
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sinchods_workspace_bootstrap_' || caller_id::text));

    -- Check if caller already has any workspace membership
    SELECT wm.workspace_id INTO existing_ws
    FROM public.workspace_members wm
    WHERE wm.user_id = caller_id
    ORDER BY wm.created_at ASC
    LIMIT 1;

    IF existing_ws IS NOT NULL THEN
        RETURN existing_ws;
    END IF;

    -- Regular users ALWAYS receive their own newly created isolated workspace
    RETURN public.create_workspace(COALESCE(workspace_name, 'My Workspace'));
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_initial_workspace(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_initial_workspace(TEXT) TO authenticated, service_role;

-- 7.4 Controlled, One-Time Legacy Workspace Claiming RPC
-- Requires a genuine server-configured secret from Supabase Vault (vault.decrypted_secrets)
-- or the private internal table (public.legacy_workspace_claim_secrets).
-- Both sources are strictly protected and inaccessible to anon and authenticated users.
-- If no server secret is configured, claiming is strictly rejected. Never accepts user session fallbacks.
CREATE OR REPLACE FUNCTION public.claim_legacy_workspace(
    claim_secret TEXT,
    target_owner_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_id UUID;
    effective_owner UUID;
    default_ws UUID := '00000000-0000-0000-0000-000000000001'::uuid;
    owner_exists BOOLEAN;
    expected_secret TEXT := NULL;
    is_service_role BOOLEAN;
BEGIN
    caller_id := auth.uid();
    is_service_role := (
        COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
    );

    IF caller_id IS NOT NULL THEN
        effective_owner := caller_id;
    ELSIF is_service_role THEN
        IF target_owner_id IS NULL THEN
            RAISE EXCEPTION 'Service role must specify target_owner_id to claim legacy workspace.';
        END IF;
        effective_owner := target_owner_id;
    ELSE
        RAISE EXCEPTION 'Authentication required to claim legacy workspace.';
    END IF;

    -- Transaction-level advisory lock prevents concurrent race conditions on initial claim
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sinchods_legacy_workspace_claim'));

    -- Verify the legacy workspace has not already been claimed
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = default_ws
          AND wm.role = 'owner'
    ) INTO owner_exists;

    IF owner_exists THEN
        RAISE EXCEPTION 'Access Denied: The legacy workspace has already been claimed and locked.';
    END IF;

    -- CRITICAL SECURITY FIX: Retrieve genuine server-side protected secret.
    -- Check 1: Supabase Vault (if vault extension and decrypted_secrets view/table exist)
    IF EXISTS (
        SELECT 1 
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'vault' AND c.relname = 'decrypted_secrets'
    ) THEN
        BEGIN
            EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''legacy_claim_secret'' LIMIT 1'
            INTO expected_secret;
        EXCEPTION WHEN OTHERS THEN
            expected_secret := NULL;
        END;
    END IF;

    -- Check 2: Private server table public.legacy_workspace_claim_secrets (zero access to anon/authenticated)
    IF expected_secret IS NULL THEN
        SELECT secret_value INTO expected_secret
        FROM public.legacy_workspace_claim_secrets
        WHERE secret_name = 'legacy_claim_secret'
        LIMIT 1;
    END IF;

    -- If no genuine server secret is configured, REJECT the claim immediately.
    -- Never accept user-defined or session-level fallbacks.
    expected_secret := NULLIF(TRIM(expected_secret), '');
    IF expected_secret IS NULL THEN
        RAISE EXCEPTION 'Legacy workspace claiming is disabled: no valid claim secret is configured in Supabase Vault or public.legacy_workspace_claim_secrets.';
    END IF;

    IF claim_secret IS NULL OR claim_secret IS DISTINCT FROM expected_secret THEN
        RAISE EXCEPTION 'Access Denied: Invalid legacy workspace claim secret.';
    END IF;

    -- Authorize initial insertion via internal lock table
    INSERT INTO public.legacy_workspace_claim_auth (workspace_id, authorized_user_id)
    VALUES (default_ws, effective_owner)
    ON CONFLICT (workspace_id) 
    DO UPDATE SET authorized_user_id = effective_owner;

    -- Set created_by on default workspace
    UPDATE public.workspaces
    SET created_by = effective_owner,
        updated_at = pg_catalog.now()
    WHERE id = default_ws;

    -- Assign the claiming administrator as permanent owner
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (default_ws, effective_owner, 'owner')
    ON CONFLICT (workspace_id, user_id) 
    DO UPDATE SET role = 'owner', updated_at = pg_catalog.now();

    -- Clean up authorization lock
    DELETE FROM public.legacy_workspace_claim_auth WHERE workspace_id = default_ws;

    RETURN default_ws;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_legacy_workspace(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_legacy_workspace(TEXT, UUID) TO service_role;

-- ------------------------------------------------------------------------------
-- 8. eBay Credentials Protection & Secure Views
-- ------------------------------------------------------------------------------

-- Strict Privilege Isolation:
-- Revoke all table-level access from anon and authenticated.
REVOKE ALL ON public.ebay_accounts FROM anon, authenticated;

-- Authenticated users can SELECT only safe operational metadata columns.
-- access_token and refresh_token are NEVER accessible to frontend/authenticated users.
GRANT SELECT (
    id,
    workspace_id,
    client_id,
    environment,
    marketplace_id,
    seller_username,
    connected,
    token_expires_at,
    refresh_token_expires_at,
    created_at,
    updated_at
) ON public.ebay_accounts TO authenticated;

-- Authenticated owners/admins can only insert or update configuration fields;
-- tokens and authentication status can NEVER be written or injected by frontend users.
GRANT INSERT (
    id,
    workspace_id,
    client_id,
    environment,
    marketplace_id
) ON public.ebay_accounts TO authenticated;

GRANT UPDATE (
    client_id,
    environment,
    marketplace_id
) ON public.ebay_accounts TO authenticated;

GRANT DELETE ON public.ebay_accounts TO authenticated;

-- Service role retains full unconstrained access for backend OAuth token exchange and eBay publishing APIs
GRANT ALL ON public.ebay_accounts TO service_role;

-- Safe view for frontend querying
CREATE OR REPLACE VIEW public.ebay_accounts_safe 
WITH (security_invoker = on) AS
SELECT 
    id,
    workspace_id,
    client_id,
    environment,
    marketplace_id,
    seller_username,
    connected,
    token_expires_at,
    refresh_token_expires_at,
    created_at,
    updated_at
FROM public.ebay_accounts;

GRANT SELECT ON public.ebay_accounts_safe TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. Explicit Database Privileges Audit (Do not rely on RLS alone)
-- ------------------------------------------------------------------------------

-- 9.1 Anon Role: Zero access to internal data tables and administrative control tables
REVOKE ALL ON TABLE public.workspaces, 
                    public.workspace_members, 
                    public.suppliers, 
                    public.products, 
                    public.product_variants, 
                    public.ebay_listings, 
                    public.ebay_accounts, 
                    public.price_history, 
                    public.orders, 
                    public.import_history,
                    public.workspace_deletion_locks,
                    public.legacy_workspace_claim_auth,
                    public.legacy_workspace_claim_secrets FROM anon;

-- 9.2 Authenticated Role: Explicitly restricted table privileges
REVOKE ALL ON TABLE public.workspaces, 
                    public.workspace_members, 
                    public.suppliers, 
                    public.products, 
                    public.product_variants, 
                    public.ebay_listings, 
                    public.price_history, 
                    public.orders, 
                    public.import_history,
                    public.workspace_deletion_locks,
                    public.legacy_workspace_claim_auth,
                    public.legacy_workspace_claim_secrets FROM authenticated;

-- Workspaces: Read and update details (owner only via RLS). Direct INSERT and DELETE are REVOKED.
-- Creating a workspace must call public.create_workspace(). Deleting must call public.delete_workspace().
GRANT SELECT, UPDATE ON public.workspaces TO authenticated;

-- Workspace Members: Full CRUD governed by safety trigger and RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;

-- Resource Tables: Full CRUD governed by role-based RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebay_listings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_history TO authenticated;

-- 9.3 Service Role: Full access for backend API servers and scheduled workers
GRANT ALL ON TABLE public.workspace_deletion_locks,
                   public.legacy_workspace_claim_auth,
                   public.legacy_workspace_claim_secrets TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ------------------------------------------------------------------------------
-- 10. Remove ALL Pre-Existing Permissive Policies on Affected Tables
-- ------------------------------------------------------------------------------
-- Dynamically drops every policy across the affected tables to guarantee no
-- permissive USING(true) policies remain regardless of previous names.
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'workspaces',
              'workspace_members',
              'suppliers',
              'products',
              'product_variants',
              'ebay_listings',
              'ebay_accounts',
              'price_history',
              'orders',
              'import_history',
              'workspace_deletion_locks',
              'legacy_workspace_claim_auth',
              'legacy_workspace_claim_secrets'
          )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
END;
$$;

-- ------------------------------------------------------------------------------
-- 11. Enable Row Level Security (RLS) on All Tables
-- ------------------------------------------------------------------------------

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 12. Implement Granular, Secure Workspace RLS Policies
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- 12.1 Workspaces Policies
-- ==============================================================================

-- Members can view their workspaces
CREATE POLICY "workspaces_select_member" ON public.workspaces
    FOR SELECT USING (
        id IN (SELECT public.get_user_workspace_ids())
    );

-- Only owner can modify workspace name or details
CREATE POLICY "workspaces_update_owner" ON public.workspaces
    FOR UPDATE USING (
        public.has_workspace_role(id, ARRAY['owner'])
    ) WITH CHECK (
        public.has_workspace_role(id, ARRAY['owner'])
    );

-- Direct DELETE is restricted to owners; deletion cascades are handled via public.delete_workspace()
CREATE POLICY "workspaces_delete_owner" ON public.workspaces
    FOR DELETE USING (
        public.has_workspace_role(id, ARRAY['owner'])
    );

-- ==============================================================================
-- 12.2 Workspace Members Policies
-- ==============================================================================

CREATE POLICY "workspace_members_select_member" ON public.workspace_members
    FOR SELECT USING (
        workspace_id IN (SELECT public.get_user_workspace_ids())
    );

-- INSERT policy strictly requires owner or admin. Initial owners are inserted via SECURITY DEFINER functions.
CREATE POLICY "workspace_members_insert_owner_admin" ON public.workspace_members
    FOR INSERT WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

CREATE POLICY "workspace_members_update_owner_admin" ON public.workspace_members
    FOR UPDATE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    ) WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

CREATE POLICY "workspace_members_delete_owner_admin_or_self" ON public.workspace_members
    FOR DELETE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
        OR user_id = auth.uid()
    );

-- ==============================================================================
-- 12.3 Suppliers Policies (Global Reusable + Workspace-Specific)
-- ==============================================================================

-- Global suppliers (workspace_id IS NULL) are readable by any member;
-- workspace-specific suppliers are readable only by members of that workspace.
CREATE POLICY "suppliers_select_global_or_workspace" ON public.suppliers
    FOR SELECT USING (
        workspace_id IS NULL 
        OR workspace_id IN (SELECT public.get_user_workspace_ids())
    );

-- Only managers, admins, and owners can insert workspace-specific suppliers.
-- Workspace users CANNOT insert global suppliers (workspace_id IS NOT NULL enforced).
CREATE POLICY "suppliers_insert_workspace" ON public.suppliers
    FOR INSERT WITH CHECK (
        workspace_id IS NOT NULL 
        AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

-- Can update only workspace-specific suppliers. Global suppliers remain strictly read-only.
CREATE POLICY "suppliers_update_workspace" ON public.suppliers
    FOR UPDATE USING (
        workspace_id IS NOT NULL 
        AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    ) WITH CHECK (
        workspace_id IS NOT NULL 
        AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

-- Can delete only workspace-specific suppliers. Global suppliers remain protected.
CREATE POLICY "suppliers_delete_workspace" ON public.suppliers
    FOR DELETE USING (
        workspace_id IS NOT NULL 
        AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

-- ==============================================================================
-- 12.4 Products Policies (Workspace-Isolated)
-- ==============================================================================

CREATE POLICY "products_select_member" ON public.products
    FOR SELECT USING (
        workspace_id IN (SELECT public.get_user_workspace_ids())
    );

CREATE POLICY "products_insert_manager" ON public.products
    FOR INSERT WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "products_update_manager" ON public.products
    FOR UPDATE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    ) WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "products_delete_manager" ON public.products
    FOR DELETE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

-- ==============================================================================
-- 12.5 Product Variants Policies (Inherited from Parent Product)
-- ==============================================================================

CREATE POLICY "variants_select_member" ON public.product_variants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
              AND p.workspace_id IN (SELECT public.get_user_workspace_ids())
        )
    );

CREATE POLICY "variants_insert_manager" ON public.product_variants
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
              AND public.has_workspace_role(p.workspace_id, ARRAY['owner', 'admin', 'manager'])
        )
    );

CREATE POLICY "variants_update_manager" ON public.product_variants
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
              AND public.has_workspace_role(p.workspace_id, ARRAY['owner', 'admin', 'manager'])
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
              AND public.has_workspace_role(p.workspace_id, ARRAY['owner', 'admin', 'manager'])
        )
    );

CREATE POLICY "variants_delete_manager" ON public.product_variants
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
              AND public.has_workspace_role(p.workspace_id, ARRAY['owner', 'admin', 'manager'])
        )
    );

-- ==============================================================================
-- 12.6 eBay Listings Policies
-- ==============================================================================

CREATE POLICY "ebay_listings_select_member" ON public.ebay_listings
    FOR SELECT USING (
        workspace_id IN (SELECT public.get_user_workspace_ids())
    );

CREATE POLICY "ebay_listings_insert_manager" ON public.ebay_listings
    FOR INSERT WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "ebay_listings_update_manager" ON public.ebay_listings
    FOR UPDATE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    ) WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "ebay_listings_delete_manager" ON public.ebay_listings
    FOR DELETE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

-- ==============================================================================
-- 12.7 eBay Accounts Policies (Strict Owner / Admin Management)
-- ==============================================================================

CREATE POLICY "ebay_accounts_select_member" ON public.ebay_accounts
    FOR SELECT USING (
        workspace_id IN (SELECT public.get_user_workspace_ids())
    );

CREATE POLICY "ebay_accounts_insert_owner_admin" ON public.ebay_accounts
    FOR INSERT WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

CREATE POLICY "ebay_accounts_update_owner_admin" ON public.ebay_accounts
    FOR UPDATE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    ) WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

CREATE POLICY "ebay_accounts_delete_owner_admin" ON public.ebay_accounts
    FOR DELETE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

-- ==============================================================================
-- 12.8 Price History Policies
-- ==============================================================================

CREATE POLICY "price_history_select_member" ON public.price_history
    FOR SELECT USING (
        workspace_id IN (SELECT public.get_user_workspace_ids())
    );

CREATE POLICY "price_history_insert_manager" ON public.price_history
    FOR INSERT WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "price_history_update_admin" ON public.price_history
    FOR UPDATE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    ) WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

CREATE POLICY "price_history_delete_admin" ON public.price_history
    FOR DELETE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

-- ==============================================================================
-- 12.9 Orders Policies
-- ==============================================================================

CREATE POLICY "orders_select_member" ON public.orders
    FOR SELECT USING (
        workspace_id IN (SELECT public.get_user_workspace_ids())
    );

CREATE POLICY "orders_insert_manager" ON public.orders
    FOR INSERT WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "orders_update_manager" ON public.orders
    FOR UPDATE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    ) WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "orders_delete_admin" ON public.orders
    FOR DELETE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

-- ==============================================================================
-- 12.10 Import History Policies
-- ==============================================================================

CREATE POLICY "import_history_select_member" ON public.import_history
    FOR SELECT USING (
        workspace_id IN (SELECT public.get_user_workspace_ids())
    );

CREATE POLICY "import_history_insert_manager" ON public.import_history
    FOR INSERT WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "import_history_update_manager" ON public.import_history
    FOR UPDATE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    ) WITH CHECK (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'manager'])
    );

CREATE POLICY "import_history_delete_admin" ON public.import_history
    FOR DELETE USING (
        public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    );

COMMIT;

-- ==============================================================================
-- SQL SECURITY & RBAC TEST PLAN (For validation in test environment)
-- ==============================================================================
/*
-- TEST 1: Regular User Bootstrap (Isolation Guarantee)
-- Action: Authenticated User A calls SELECT public.bootstrap_initial_workspace('User A Team');
-- Expect: Returns a NEW isolated workspace UUID; User A is registered as 'owner' in workspace_members.
-- User A has NO membership in and cannot see the seeded legacy workspace ('00000000-0000-0000-0000-000000000001').

-- TEST 2: Legacy Workspace Claim Protection & Service Role Execution
-- Action A: Direct authenticated caller permission test:
--   Authenticated user calls SELECT public.claim_legacy_workspace('AnySecretPassphrase123!');
--   Expect: ERROR 'permission denied for function claim_legacy_workspace' (EXECUTE revoked from PUBLIC, anon, authenticated).
-- Action B: Backend service_role unconfigured server secret test:
--   Service role calls SELECT public.claim_legacy_workspace('AnySecretPassphrase123!', 'target_user_id') without secret configured:
--   Expect: ERROR 'Legacy workspace claiming is disabled: no valid claim secret is configured in Supabase Vault or public.legacy_workspace_claim_secrets.'
-- Action C: Backend service_role claim execution with valid secret:
--   INSERT INTO public.legacy_workspace_claim_secrets (secret_name, secret_value) VALUES ('legacy_claim_secret', 'ServerSuperSecret2026!');
--   Service role calls SELECT public.claim_legacy_workspace('ServerSuperSecret2026!', 'target_user_id');
--   Expect: SUCCESS. Default workspace ('00000000-0000-0000-0000-000000000001') assigned to target_user_id as owner.
-- Action D: Subsequent claim attempt:
--   Service role calls SELECT public.claim_legacy_workspace('ServerSuperSecret2026!', 'target_user_id');
--   Expect: ERROR 'Access Denied: The legacy workspace has already been claimed and locked.'

-- TEST 3: Cross-Workspace Isolation
-- Action: User A executes SELECT * FROM public.products;
-- Expect: 0 rows returned (User A cannot see products from the legacy default workspace).

-- TEST 4: Role Escalation Protection
-- Action: Workspace Owner invites User B as 'admin'. User B attempts:
--   UPDATE public.workspace_members SET role = 'owner' WHERE user_id = User B's ID;
-- Expect: ERROR 'Access Denied: Admins cannot promote members to admin or owner.'

-- TEST 5: Owner Protection & Workspace Deletion via Internal Lock Table
-- Action A: Admin attempts DELETE FROM public.workspace_members WHERE user_id = Owner ID;
-- Expect: ERROR 'Access Denied: Only a workspace owner can remove another owner.'
-- Action B: Attacker attempts to spoof GUC setting and delete last owner:
--   SET sinchods.deleting_workspace = '...'; DELETE FROM public.workspace_members WHERE user_id = Owner ID;
--   Expect: ERROR 'Invalid Operation: A workspace must retain at least one owner.' (GUC is ignored; internal table required).
-- Action C: Owner calls public.delete_workspace(User A's workspace ID);
-- Expect: SUCCESS. Workspace and members cascade delete cleanly.
-- Action D: Attempt to call public.delete_workspace('00000000-0000-0000-0000-000000000001');
-- Expect: ERROR 'Invalid Operation: The default legacy workspace cannot be deleted.'

-- TEST 6: eBay Credential Isolation & Write Protection
-- Action A: Authenticated user queries SELECT access_token, refresh_token FROM public.ebay_accounts;
-- Expect: ERROR 'permission denied for column access_token of relation ebay_accounts'
-- Action B: Authenticated user attempts INSERT INTO public.ebay_accounts (workspace_id, client_id, access_token) VALUES (...);
-- Expect: ERROR 'permission denied for column access_token of relation ebay_accounts'
-- Action C: Authenticated user queries SELECT * FROM public.ebay_accounts_safe;
-- Expect: Returns safe columns (client_id, connected, expiry) without tokens.

-- TEST 7: Scoped Product URL Uniqueness
-- Action A: User A inserts product with URL 'https://example.com/item-1' in Workspace A. (Success)
-- Action B: User A inserts duplicate product with 'https://example.com/item-1' in Workspace A. (ERROR: duplicate key uq_products_workspace_url)
-- Action C: Admin in Workspace B inserts product with URL 'https://example.com/item-1' in Workspace B. (Success: different workspace)

-- TEST 8: Global Supplier Protection
-- Action A: User queries SELECT * FROM public.suppliers WHERE id = 'pluspower'; (Success: visible)
-- Action B: User attempts UPDATE public.suppliers SET name = 'Hacked' WHERE id = 'pluspower';
-- Expect: 0 rows affected (RLS update_workspace blocks updates on workspace_id IS NULL).
*/
