-- ==============================================================================
-- SinchoDS - Multi-Supplier & eBay Dropshipping Database Schema
-- Compatible with Supabase PostgreSQL Free Tier
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Suppliers Table
CREATE TABLE IF NOT EXISTS public.suppliers (
    id TEXT PRIMARY KEY, -- e.g. 'pluspower'
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'active',
    last_sync_at TIMESTAMPTZ,
    product_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    description TEXT,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert PlusPower as the default first supplier
INSERT INTO public.suppliers (id, name, base_url, status, description)
VALUES (
    'pluspower',
    'PlusPower Supplements',
    'https://www.pluspowersupplements.com',
    'active',
    'Fornitore primario integratori alimentari, proteine, aminoacidi con gestione varianti e scadenze lotti'
) ON CONFLICT (id) DO NOTHING;

-- 2. Products Table (Extended with supplier_id, ebay references)
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id TEXT DEFAULT 'pluspower' REFERENCES public.suppliers(id) ON DELETE SET DEFAULT,
    supplier_name TEXT DEFAULT 'PlusPower Supplements',
    supplier_product_id TEXT,
    url TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    price NUMERIC(10, 2), -- Current supplier cost
    original_price NUMERIC(10, 2),
    discount_percentage INTEGER,
    currency VARCHAR(10) DEFAULT 'EUR',
    sku TEXT,
    ean TEXT,
    availability TEXT,
    stock_quantity INTEGER,
    description TEXT,
    ingredients TEXT,
    nutrition TEXT,
    images JSONB DEFAULT '[]'::jsonb,
    raw_jsonld JSONB,
    import_source VARCHAR(50) DEFAULT 'html_import',
    status VARCHAR(30) DEFAULT 'ready',
    error TEXT,
    ebay_listing_id TEXT,
    ebay_status VARCHAR(30) DEFAULT 'not_listed',
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON public.products (supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_url ON public.products (url);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products (brand);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products (sku);
CREATE INDEX IF NOT EXISTS idx_products_ean ON public.products (ean);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON public.products (created_at DESC);

-- 3. Product Variants Table
CREATE TABLE IF NOT EXISTS public.product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    variant_id TEXT,
    option_id TEXT,
    name TEXT NOT NULL,
    sku TEXT,
    ean TEXT,
    price NUMERIC(10, 2),
    original_price NUMERIC(10, 2),
    stock_quantity INTEGER,
    availability TEXT,
    expiry_date TEXT,
    available_online BOOLEAN,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_product_id ON public.product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON public.product_variants (sku);
CREATE INDEX IF NOT EXISTS idx_variants_ean ON public.product_variants (ean);

-- 4. eBay Accounts & Credentials (Server-side & RLS protected)
CREATE TABLE IF NOT EXISTS public.ebay_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id TEXT NOT NULL,
    environment VARCHAR(20) DEFAULT 'PRODUCTION',
    marketplace_id VARCHAR(20) DEFAULT 'EBAY_IT',
    seller_username TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    connected BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. eBay Listings Table
CREATE TABLE IF NOT EXISTS public.ebay_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    supplier_id TEXT DEFAULT 'pluspower',
    supplier_url TEXT NOT NULL,
    marketplace_id VARCHAR(20) DEFAULT 'EBAY_IT',
    title VARCHAR(80) NOT NULL,
    subtitle VARCHAR(80),
    category_id TEXT NOT NULL,
    category_name TEXT,
    condition_id VARCHAR(20) DEFAULT 'NEW',
    price NUMERIC(10, 2) NOT NULL,
    original_supplier_cost NUMERIC(10, 2) NOT NULL,
    expected_profit NUMERIC(10, 2) NOT NULL,
    quantity INTEGER DEFAULT 1,
    sku TEXT,
    ean TEXT,
    brand TEXT,
    description_html TEXT NOT NULL,
    images JSONB DEFAULT '[]'::jsonb,
    item_specifics JSONB DEFAULT '{}'::jsonb,
    shipping_policy_id TEXT,
    return_policy_id TEXT,
    payment_policy_id TEXT,
    status VARCHAR(30) DEFAULT 'draft', -- draft, active, ended, error
    ebay_item_id TEXT,
    ebay_offer_id TEXT,
    error_message TEXT,
    variants JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ebay_listings_status ON public.ebay_listings (status);
CREATE INDEX IF NOT EXISTS idx_ebay_listings_product_id ON public.ebay_listings (product_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listings_ebay_item_id ON public.ebay_listings (ebay_item_id);

-- 6. Price & Stock Monitoring History
CREATE TABLE IF NOT EXISTS public.price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    supplier_id TEXT NOT NULL,
    old_price NUMERIC(10, 2),
    new_price NUMERIC(10, 2),
    old_stock INTEGER,
    new_stock INTEGER,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON public.price_history (product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_changed_at ON public.price_history (changed_at DESC);

-- 7. Orders Table (Future-ready for eBay Order Management)
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ebay_order_id TEXT UNIQUE NOT NULL,
    buyer_username TEXT,
    total_paid NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'EUR',
    status VARCHAR(30) DEFAULT 'pending_fulfillment',
    items JSONB DEFAULT '[]'::jsonb,
    tracking_number TEXT,
    carrier TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_ebay_order_id ON public.orders (ebay_order_id);

-- 8. Import History Table
CREATE TABLE IF NOT EXISTS public.import_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url TEXT NOT NULL,
    title TEXT,
    source VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL,
    message TEXT,
    supplier_id TEXT DEFAULT 'pluspower',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- Row Level Security (RLS)
-- ==============================================================================
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

-- Allow policies
CREATE POLICY "Public read suppliers" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "Public modify suppliers" ON public.suppliers FOR ALL USING (true);

CREATE POLICY "Public read products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Public modify products" ON public.products FOR ALL USING (true);

CREATE POLICY "Public read variants" ON public.product_variants FOR SELECT USING (true);
CREATE POLICY "Public modify variants" ON public.product_variants FOR ALL USING (true);

CREATE POLICY "Public read ebay_listings" ON public.ebay_listings FOR SELECT USING (true);
CREATE POLICY "Public modify ebay_listings" ON public.ebay_listings FOR ALL USING (true);

CREATE POLICY "Public read history" ON public.import_history FOR SELECT USING (true);
CREATE POLICY "Public modify history" ON public.import_history FOR ALL USING (true);

CREATE POLICY "Public read price_history" ON public.price_history FOR SELECT USING (true);
CREATE POLICY "Public modify price_history" ON public.price_history FOR ALL USING (true);

CREATE POLICY "Public read orders" ON public.orders FOR SELECT USING (true);
CREATE POLICY "Public modify orders" ON public.orders FOR ALL USING (true);
