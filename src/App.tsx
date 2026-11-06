import React, { useState, useEffect } from 'react';
import { Product, ImportHistoryItem, EbayListing, Supplier } from './types.js';
import { Navbar, PageId } from './components/Navbar.js';
import { Dashboard } from './components/Dashboard.js';
import { Products } from './components/Products.js';
import { Suppliers } from './components/Suppliers.js';
import { Listings } from './components/Listings.js';
import { ListingBuilder } from './components/ListingBuilder.js';
import { Scraper } from './components/Scraper.js';
import { HtmlImport } from './components/HtmlImport.js';
import { Settings } from './components/Settings.js';
import {
  fetchAllProducts,
  saveProductToDb,
  deleteProductFromDb,
  bulkDeleteProductsFromDb,
  getLocalHistory,
  addLocalHistory,
  testSupabaseConnection,
  saveLocalProducts,
  getStoredSettings,
  fetchAllEbayListings,
  saveEbayListingToDb,
  deleteEbayListingFromDb,
} from './utils/supabase.js';
import { INITIAL_SUPPLIERS } from './utils/suppliers.js';
import { calculateEbayPricing, generateEbayTitle, generateEbayDescriptionHtml, DEFAULT_PRICING_RULE } from './utils/pricing.js';

// Seed product
const INITIAL_SEED_PRODUCTS: Product[] = [
  {
    id: 'seed-hydro-isolate-2kg',
    supplier_id: 'pluspower',
    supplier_name: 'PlusPower Supplements',
    url: 'https://www.pluspowersupplements.com/100-hydro-isolate-2kg',
    title: '100% Hydro Isolate 2kg',
    brand: 'Yamamoto Nutrition',
    category: 'Proteine > Proteine Idrolizzate',
    price: 54.90,
    original_price: 64.90,
    discount_percentage: 15,
    currency: 'EUR',
    sku: 'YAM-HYDRO-2KG',
    ean: '8033221144550',
    availability: 'InStock',
    stock_quantity: 35,
    description: '100% HYDRO ISOLATE di Yamamoto Nutrition è un integratore alimentare a base di proteine del siero del latte idrolizzate Optipep 90 DH4 con enzimi digestivi.',
    ingredients: 'Proteine del siero di latte idrolizzate (Optipep® 90 DH4), cacao magro in polvere, aromi, edulcorante: sucralosio.',
    nutrition: 'Per 100g: Energia 1572 kJ / 371 kcal, Grassi 1.5g (di cui saturi 0.8g), Carboidrati 1.2g (zuccheri 0.9g), Proteine 88g, Sale 0.45g.',
    images: [
      'https://www.pluspowersupplements.com/images/hydro-isolate-front.jpg',
      'https://www.pluspowersupplements.com/images/hydro-isolate-back.jpg',
    ],
    import_source: 'html_import',
    status: 'ready',
    error: null,
    ebay_status: 'draft',
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    variants: [
      {
        id: 'variant-seed-1',
        product_id: 'seed-hydro-isolate-2kg',
        variant_id: '101',
        option_id: '1',
        name: 'Vaniglia Deliziosa',
        sku: 'YAM-HYDRO-VAN-2KG',
        ean: '8033221144551',
        price: 54.90,
        original_price: 64.90,
        stock_quantity: 20,
        availability: 'InStock',
        expiry_date: '30/06/2027',
        available_online: true,
      },
      {
        id: 'variant-seed-2',
        product_id: 'seed-hydro-isolate-2kg',
        variant_id: '102',
        option_id: '2',
        name: 'Cioccolato Belga',
        sku: 'YAM-HYDRO-CHOC-2KG',
        ean: '8033221144552',
        price: 54.90,
        original_price: 64.90,
        stock_quantity: 15,
        availability: 'InStock',
        expiry_date: '15/04/2027',
        available_online: true,
      },
      {
        id: 'variant-seed-3',
        product_id: 'seed-hydro-isolate-2kg',
        variant_id: '103',
        option_id: '3',
        name: 'Fragola & Banana',
        sku: 'YAM-HYDRO-STRAW-2KG',
        ean: '8033221144553',
        price: 54.90,
        original_price: 64.90,
        stock_quantity: 0,
        availability: 'OutOfStock',
        expiry_date: '28/02/2027',
        available_online: false,
      },
    ],
  },
];

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [products, setProducts] = useState<Product[]>([]);
  const [listings, setListings] = useState<EbayListing[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>(INITIAL_SUPPLIERS);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSupabaseConnected, setIsSupabaseConnected] = useState(false);
  const [isEbayConnected, setIsEbayConnected] = useState(false);
  const [presetTargetUrl, setPresetTargetUrl] = useState<string>('');

  // Active product being edited in Listing Builder modal
  const [listingBuilderProduct, setListingBuilderProduct] = useState<Product | null>(null);

  // Initial load
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const conn = await testSupabaseConnection();
        setIsSupabaseConnected(conn.ok);

        // Fetch products
        let loaded = await fetchAllProducts();
        if (loaded.length === 0) {
          saveLocalProducts(INITIAL_SEED_PRODUCTS);
          loaded = INITIAL_SEED_PRODUCTS;
        }
        setProducts(loaded);

        // Fetch eBay listings
        let loadedListings = await fetchAllEbayListings();
        if (loadedListings.length === 0 && loaded.length > 0) {
          // Create initial verified draft listing
          const p = loaded[0];
          const pricing = calculateEbayPricing(Number(p.price) || 54.90);
          const initialDraft: EbayListing = {
            id: 'init-draft-1',
            product_id: p.id,
            supplier_id: 'pluspower',
            supplier_url: p.url,
            marketplace_id: 'EBAY_IT',
            title: generateEbayTitle({ brand: p.brand, title: p.title, variantName: p.variants?.[0]?.name }),
            category_id: '180959',
            category_name: 'Bellezza e salute > Integratori alimentari > Proteine e sport',
            condition_id: 'NEW',
            price: pricing.recommendedPrice,
            original_supplier_cost: Number(p.price) || 54.90,
            expected_profit: pricing.expectedNetProfit,
            quantity: 5,
            sku: p.sku || 'YAM-HYDRO-2KG',
            ean: p.ean || '8033221144550',
            brand: p.brand || null,
            description_html: generateEbayDescriptionHtml(p, p.variants?.[0]),
            images: p.images,
            item_specifics: {
              Marca: p.brand || 'Yamamoto Nutrition',
              Gusto: p.variants?.[0]?.name || 'Vaniglia',
              'Data di scadenza': p.variants?.[0]?.expiry_date || '30/06/2027',
            },
            status: 'draft',
            validation_status: 'ready',
            word_count: 484,
            variants: p.variants.map((v) => ({
              sku: v.sku || '',
              name: v.name,
              ean: v.ean || null,
              price: Number(v.price) || 54.90,
              quantity: v.stock_quantity || 1,
            })),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          await saveEbayListingToDb(initialDraft);
          loadedListings = [initialDraft];
        }
        setListings(loadedListings);

        // Check eBay status
        try {
          const ebayRes = await fetch('/api/ebay/status');
          const ebayData = await ebayRes.json();
          setIsEbayConnected(Boolean(ebayData.connected));
        } catch {
          // ignore
        }

        // Fetch history
        const hist = getLocalHistory();
        setHistory(hist);
      } catch (err) {
        console.error('Error loading app data:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  // Save product (from Scraper or HTML Import)
  const handleSaveProduct = async (product: Product): Promise<{ ok: boolean; product: Product }> => {
    const res = await saveProductToDb(product);
    if (res.ok) {
      setProducts((prev) => {
        const idx = prev.findIndex((p) => p.url === product.url || p.id === product.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = res.product;
          return updated;
        }
        return [res.product, ...prev];
      });

      const historyItem: ImportHistoryItem = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 12),
        url: product.url,
        title: product.title,
        source: product.import_source,
        status: 'success',
        message: `Imported with ${product.variants?.length || 0} variant(s) from supplier ${product.supplier_name || 'PlusPower'}`,
        timestamp: new Date().toISOString(),
      };
      addLocalHistory(historyItem);
      setHistory((prev) => [historyItem, ...prev]);
    }
    return res;
  };

  const handleUpdateProduct = async (product: Product) => {
    await saveProductToDb(product);
    setProducts((prev) => prev.map((p) => (p.id === product.id ? product : p)));
  };

  const handleDeleteProduct = async (id: string) => {
    await deleteProductFromDb(id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleBulkDelete = async (ids: string[]) => {
    await bulkDeleteProductsFromDb(ids);
    setProducts((prev) => prev.filter((p) => !ids.includes(p.id)));
  };

  // eBay Listing Handlers
  const handleSaveListing = async (listing: EbayListing): Promise<{ ok: boolean; listing: EbayListing }> => {
    const res = await saveEbayListingToDb(listing);
    if (res.ok) {
      setListings((prev) => {
        const idx = prev.findIndex((l) => l.id === listing.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = res.listing;
          return updated;
        }
        return [res.listing, ...prev];
      });

      // Update product's ebay_status
      setProducts((prev) =>
        prev.map((p) =>
          p.id === listing.product_id
            ? { ...p, ebay_status: listing.status, ebay_listing_id: listing.ebay_item_id || listing.id }
            : p
        )
      );
    }
    return res;
  };

  const handleDeleteListing = async (id: string) => {
    await deleteEbayListingFromDb(id);
    setListings((prev) => prev.filter((l) => l.id !== id));
  };

  const handleArchiveProduct = async (id: string) => {
    try {
      await fetch(`/api/products/${id}/archive`, { method: 'PUT' });
    } catch {}
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, is_archived: true, status: 'archived' } : p))
    );
  };

  const handleRestoreProduct = async (id: string) => {
    try {
      await fetch(`/api/products/${id}/restore`, { method: 'PUT' });
    } catch {}
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, is_archived: false, status: 'draft' } : p))
    );
  };

  const handleBulkArchive = async (ids: string[]) => {
    try {
      await fetch('/api/products/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {}
    setProducts((prev) =>
      prev.map((p) => (ids.includes(p.id) ? { ...p, is_archived: true, status: 'archived' } : p))
    );
  };

  const handleBulkRestore = async (ids: string[]) => {
    try {
      await fetch('/api/products/bulk-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {}
    setProducts((prev) =>
      prev.map((p) => (ids.includes(p.id) ? { ...p, is_archived: false, status: 'draft' } : p))
    );
  };

  // Supplier Handlers
  const handleToggleSupplier = (id: string) => {
    setSuppliers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: s.status === 'active' ? 'disabled' : 'active' } : s))
    );
  };

  const handleAddSupplier = (supplier: Supplier) => {
    setSuppliers((prev) => [...prev, supplier]);
  };

  const handleUpdateSupplier = (supplier: Supplier) => {
    setSuppliers((prev) => {
      const idx = prev.findIndex((s) => s.id === supplier.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = supplier;
        return updated;
      }
      return [...prev, supplier];
    });
  };

  const handleDeleteSupplier = (id: string) => {
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleClearHistory = () => {
    localStorage.removeItem('sinchods_local_history');
    setHistory([]);
  };

  const handleRestoreProducts = async (newProducts: Product[]) => {
    saveLocalProducts(newProducts);
    setProducts(newProducts);
  };

  const existingProductUrls = new Set(products.map((p) => p.url));
  const settings = getStoredSettings();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Navbar */}
      <Navbar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        productsCount={products.length}
        listingsCount={listings.length}
        isSupabaseConnected={isSupabaseConnected}
        isEbayConnected={isEbayConnected}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 pt-4 sm:pt-6">
        {currentPage === 'dashboard' && (
          <Dashboard
            products={products}
            listings={listings}
            suppliers={suppliers}
            history={history}
            setCurrentPage={setCurrentPage}
            isLoading={isLoading}
          />
        )}

        {currentPage === 'products' && (
          <Products
            products={products}
            onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            onBulkDelete={handleBulkDelete}
            onArchiveProduct={handleArchiveProduct}
            onRestoreProduct={handleRestoreProduct}
            onBulkArchive={handleBulkArchive}
            onBulkRestore={handleBulkRestore}
            onOpenListingBuilder={(p) => setListingBuilderProduct(p)}
          />
        )}

        {currentPage === 'suppliers' && (
          <Suppliers
            suppliers={suppliers}
            onToggleSupplier={handleToggleSupplier}
            onAddSupplier={handleAddSupplier}
            onUpdateSupplier={handleUpdateSupplier}
            onDeleteSupplier={handleDeleteSupplier}
            setCurrentPage={setCurrentPage}
          />
        )}

        {currentPage === 'listings' && (
          <Listings
            listings={listings}
            products={products}
            onUpdateListing={async (l) => {
              await handleSaveListing(l);
            }}
            onDeleteListing={handleDeleteListing}
            onOpenListingBuilder={(p) => setListingBuilderProduct(p)}
            setCurrentPage={setCurrentPage}
          />
        )}

        {currentPage === 'scraper' && (
          <Scraper
            onSaveProduct={handleSaveProduct}
            setCurrentPage={setCurrentPage}
            onSetHtmlImportTargetUrl={(url) => {
              setPresetTargetUrl(url);
              setCurrentPage('html-import');
            }}
            existingProductUrls={existingProductUrls}
            defaultDelay={settings.defaultDelaySeconds}
            defaultBatchSize={settings.defaultBatchSize}
          />
        )}

        {currentPage === 'html-import' && (
          <HtmlImport
            onSaveProduct={handleSaveProduct}
            setCurrentPage={setCurrentPage}
            presetTargetUrl={presetTargetUrl}
            onClearPresetTargetUrl={() => setPresetTargetUrl('')}
          />
        )}

        {currentPage === 'settings' && (
          <Settings
            products={products}
            history={history}
            onClearHistory={handleClearHistory}
            onRestoreProducts={handleRestoreProducts}
            isSupabaseConnected={isSupabaseConnected}
            setIsSupabaseConnected={setIsSupabaseConnected}
            isEbayConnected={isEbayConnected}
            setIsEbayConnected={setIsEbayConnected}
          />
        )}
      </main>

      {/* Listing Builder Modal (triggered from Catalogo or Inserzioni) */}
      {listingBuilderProduct && (
        <ListingBuilder
          product={listingBuilderProduct}
          onSaveListing={async (l) => {
            const res = await handleSaveListing(l);
            return res;
          }}
          onClose={() => setListingBuilderProduct(null)}
          pricingRule={settings.defaultPricingRule}
          isEbayConnected={isEbayConnected}
        />
      )}
    </div>
  );
}
