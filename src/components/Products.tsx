import React, { useState, useMemo, useEffect } from 'react';
import { Product, ProductVariant, PriceHistoryItem, ProductChangeReview } from '../types.js';
import {
  Search,
  Filter,
  ArrowUpDown,
  Download,
  Trash2,
  Edit3,
  ExternalLink,
  Layers,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Package,
  X,
  Save,
  CheckSquare,
  Square,
  ChevronRight,
  Calendar,
  Barcode,
  Tag,
  DollarSign,
  Copy,
  Info,
  Store,
  Archive,
  ArchiveRestore,
  Plus,
  Image as ImageIcon,
  Clock,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  RefreshCw,
  Bell,
  Check,
} from 'lucide-react';
import { generateProductsCsv, generateVariantsCsv, generateCombinedCsv, downloadCsv } from '../utils/csv.js';
import { calculateEbayPricing } from '../utils/pricing.js';

interface ProductsProps {
  products: Product[];
  onUpdateProduct: (product: Product) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onBulkDelete: (ids: string[]) => Promise<void>;
  onArchiveProduct?: (id: string) => Promise<void>;
  onRestoreProduct?: (id: string) => Promise<void>;
  onBulkArchive?: (ids: string[]) => Promise<void>;
  onBulkRestore?: (ids: string[]) => Promise<void>;
  onOpenListingBuilder: (product: Product) => void;
  onRefreshProducts?: () => Promise<void>;
}

type DetailTab = 'overview' | 'monitoring' | 'variants' | 'images' | 'ebay' | 'pricing' | 'stock' | 'history';

export const Products: React.FC<ProductsProps> = ({
  products,
  onUpdateProduct,
  onDeleteProduct,
  onBulkDelete,
  onArchiveProduct,
  onRestoreProduct,
  onBulkArchive,
  onBulkRestore,
  onOpenListingBuilder,
  onRefreshProducts,
}) => {
  // Search & Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusTab, setStatusTab] = useState<'all' | 'ready' | 'draft' | 'needs_review' | 'archived'>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [ebayFilter, setEbayFilter] = useState<'all' | 'not_listed' | 'draft' | 'active' | 'ended' | 'error'>('all');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc'>('date-desc');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modal / Drawer state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Variant editing within modal
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantSku, setNewVariantSku] = useState('');
  const [newVariantEan, setNewVariantEan] = useState('');
  const [newVariantPrice, setNewVariantPrice] = useState<number | ''>('');
  const [newVariantStock, setNewVariantStock] = useState<number>(10);
  const [newVariantExpiry, setNewVariantExpiry] = useState('');
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editVariantData, setEditVariantData] = useState<Partial<ProductVariant>>({});

  // Image management
  const [newImageUrl, setNewImageUrl] = useState('');

  // Monitoring & Change Review State (Phase 1.4)
  const [checkingProductIds, setCheckingProductIds] = useState<string[]>([]);
  const [activeProductReviews, setActiveProductReviews] = useState<ProductChangeReview[]>([]);
  const [activePriceApprovals, setActivePriceApprovals] = useState<PriceHistoryItem[]>([]);
  const [activeProductHistory, setActiveProductHistory] = useState<PriceHistoryItem[]>([]);
  const [monitoringMessage, setMonitoringMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Load reviews and price history when a product is opened
  useEffect(() => {
    if (!selectedProduct) {
      setActiveProductReviews([]);
      setActivePriceApprovals([]);
      setActiveProductHistory([]);
      return;
    }

    // Load pending change reviews for this product
    fetch(`/api/monitoring/reviews?productId=${encodeURIComponent(selectedProduct.id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.reviews)) {
          setActiveProductReviews(data.reviews);
        }
      })
      .catch(() => {});

    // Load price history / pending approvals for this product
    fetch(`/api/price-history?productId=${encodeURIComponent(selectedProduct.id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.history)) {
          setActiveProductHistory(data.history);
          setActivePriceApprovals(data.history.filter((h: any) => h.status === 'pending_approval'));
        }
      })
      .catch(() => {});
  }, [selectedProduct]);

  // Single Product "Check Now"
  const handleCheckNow = async (productId: string) => {
    setCheckingProductIds((prev) => [...prev, productId]);
    setMonitoringMessage(null);
    try {
      const res = await fetch('/api/monitoring/check-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (data.ok && data.results?.[0]?.product) {
        const updated = data.results[0].product;
        await onUpdateProduct(updated);
        if (selectedProduct?.id === productId) {
          setSelectedProduct(updated);
        }
        setMonitoringMessage({
          text: `Monitoring check completed for ${updated.title}. Price Action: ${data.results[0].priceAction}, Stock: ${data.results[0].stockAction}.`,
          type: 'success',
        });
      } else {
        setMonitoringMessage({
          text: data.results?.[0]?.error || data.error || 'Monitoring check failed',
          type: 'error',
        });
      }
    } catch (err: any) {
      setMonitoringMessage({ text: err.message || 'Network error during check', type: 'error' });
    } finally {
      setCheckingProductIds((prev) => prev.filter((id) => id !== productId));
    }
  };

  // Bulk Selected "Check Now"
  const handleBulkCheckNow = async () => {
    if (selectedIds.length === 0) return;
    setCheckingProductIds([...selectedIds]);
    setMonitoringMessage(null);
    try {
      const res = await fetch('/api/monitoring/check-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: selectedIds }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.results)) {
        for (const r of data.results) {
          if (r.product) {
            await onUpdateProduct(r.product);
          }
        }
        if (onRefreshProducts) await onRefreshProducts();
        setMonitoringMessage({
          text: `Bulk monitoring checked ${data.results.length} product(s) successfully.`,
          type: 'success',
        });
      }
    } catch (err: any) {
      setMonitoringMessage({ text: err.message || 'Error running bulk check', type: 'error' });
    } finally {
      setCheckingProductIds([]);
    }
  };

  // Approve / Reject Price Change
  const handleApprovePrice = async (historyId: string) => {
    try {
      const res = await fetch(`/api/monitoring/price-approvals/${historyId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.product) {
        await onUpdateProduct(data.product);
        setSelectedProduct(data.product);
        setActivePriceApprovals((prev) => prev.filter((h) => h.id !== historyId));
        setMonitoringMessage({ text: 'Price change approved and applied to listing.', type: 'success' });
      }
    } catch (err: any) {
      setMonitoringMessage({ text: err.message || 'Error approving price', type: 'error' });
    }
  };

  const handleRejectPrice = async (historyId: string) => {
    try {
      const res = await fetch(`/api/monitoring/price-approvals/${historyId}/reject`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setActivePriceApprovals((prev) => prev.filter((h) => h.id !== historyId));
        setMonitoringMessage({ text: 'Price change rejected. Existing selling price kept.', type: 'info' });
      }
    } catch (err: any) {
      setMonitoringMessage({ text: err.message || 'Error rejecting price', type: 'error' });
    }
  };

  // Approve / Reject Content Change Review
  const handleApproveReview = async (reviewId: string) => {
    try {
      const res = await fetch(`/api/monitoring/reviews/${reviewId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.product) {
        await onUpdateProduct(data.product);
        setSelectedProduct(data.product);
        setActiveProductReviews((prev) => prev.filter((r) => r.id !== reviewId));
        setMonitoringMessage({ text: 'Supplier content change approved and updated.', type: 'success' });
      }
    } catch (err: any) {
      setMonitoringMessage({ text: err.message || 'Error approving review', type: 'error' });
    }
  };

  const handleRejectReview = async (reviewId: string) => {
    try {
      const res = await fetch(`/api/monitoring/reviews/${reviewId}/reject`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setActiveProductReviews((prev) => prev.filter((r) => r.id !== reviewId));
        setMonitoringMessage({ text: 'Supplier content change rejected.', type: 'info' });
      }
    } catch (err: any) {
      setMonitoringMessage({ text: err.message || 'Error rejecting review', type: 'error' });
    }
  };

  // Extract unique suppliers for filter
  const allSuppliers = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.supplier_name) set.add(p.supplier_name);
      else if (p.supplier_id) set.add(p.supplier_id);
    });
    return Array.from(set).sort();
  }, [products]);

  // Filtered & Sorted products
  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        // Status Tab filter
        if (statusTab === 'archived') {
          if (!p.is_archived && p.status !== 'archived') return false;
        } else {
          // If not looking for archived, filter out archived unless looking at all?
          if (statusTab !== 'all' && (p.is_archived || p.status === 'archived')) return false;
          if (statusTab === 'ready' && p.status !== 'ready') return false;
          if (statusTab === 'draft' && p.status !== 'draft') return false;
          if (statusTab === 'needs_review' && p.status !== 'needs_review') return false;
        }

        // Supplier filter
        if (supplierFilter !== 'all') {
          const sName = p.supplier_name || p.supplier_id;
          if (sName !== supplierFilter && p.supplier_id !== supplierFilter) return false;
        }

        // Stock filter
        if (stockFilter === 'in_stock') {
          const inStock = p.availability === 'InStock' || (p.stock_quantity != null && p.stock_quantity > 0);
          if (!inStock) return false;
        } else if (stockFilter === 'out_of_stock') {
          const outOfStock = p.availability === 'OutOfStock' || p.stock_quantity === 0;
          if (!outOfStock) return false;
        }

        // eBay filter
        if (ebayFilter !== 'all') {
          const currentEbayStatus = p.ebay_status || 'not_listed';
          if (currentEbayStatus !== ebayFilter) return false;
        }

        // Search query across title, brand, SKU, EAN and variant fields
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchTitle = p.title.toLowerCase().includes(q);
          const matchBrand = p.brand ? p.brand.toLowerCase().includes(q) : false;
          const matchSku = p.sku ? p.sku.toLowerCase().includes(q) : false;
          const matchEan = p.ean ? p.ean.toLowerCase().includes(q) : false;
          const matchVariants = p.variants?.some(
            (v) =>
              v.name.toLowerCase().includes(q) ||
              (v.sku && v.sku.toLowerCase().includes(q)) ||
              (v.ean && v.ean.toLowerCase().includes(q))
          );
          if (!matchTitle && !matchBrand && !matchSku && !matchEan && !matchVariants) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'date-desc') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sortBy === 'date-asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (sortBy === 'price-asc') return (Number(a.price) || 0) - (Number(b.price) || 0);
        if (sortBy === 'price-desc') return (Number(b.price) || 0) - (Number(a.price) || 0);
        if (sortBy === 'name-asc') return a.title.localeCompare(b.title);
        if (sortBy === 'name-desc') return b.title.localeCompare(a.title);
        return 0;
      });
  }, [products, searchQuery, statusTab, supplierFilter, stockFilter, ebayFilter, sortBy]);

  // Selection handlers
  const handleSelectAll = () => {
    if (selectedIds.length === filteredProducts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredProducts.map((p) => p.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // Archive / Restore Handlers
  const handleArchive = async (id: string) => {
    if (onArchiveProduct) {
      await onArchiveProduct(id);
    } else {
      const prod = products.find((p) => p.id === id);
      if (prod) {
        await onUpdateProduct({ ...prod, is_archived: true, status: 'archived' });
      }
    }
    if (selectedProduct?.id === id) {
      setSelectedProduct((prev) => (prev ? { ...prev, is_archived: true, status: 'archived' } : null));
    }
  };

  const handleRestore = async (id: string) => {
    if (onRestoreProduct) {
      await onRestoreProduct(id);
    } else {
      const prod = products.find((p) => p.id === id);
      if (prod) {
        await onUpdateProduct({ ...prod, is_archived: false, status: 'draft' });
      }
    }
    if (selectedProduct?.id === id) {
      setSelectedProduct((prev) => (prev ? { ...prev, is_archived: false, status: 'draft' } : null));
    }
  };

  const handleBulkArchive = async () => {
    if (onBulkArchive) {
      await onBulkArchive(selectedIds);
    } else {
      for (const id of selectedIds) {
        const prod = products.find((p) => p.id === id);
        if (prod) await onUpdateProduct({ ...prod, is_archived: true, status: 'archived' });
      }
    }
    setSelectedIds([]);
  };

  const handleBulkRestore = async () => {
    if (onBulkRestore) {
      await onBulkRestore(selectedIds);
    } else {
      for (const id of selectedIds) {
        const prod = products.find((p) => p.id === id);
        if (prod) await onUpdateProduct({ ...prod, is_archived: false, status: 'draft' });
      }
    }
    setSelectedIds([]);
  };

  // Open Product Detail Modal
  const handleOpenDetail = (product: Product, tab: DetailTab = 'overview') => {
    setSelectedProduct(product);
    setActiveTab(tab);
    setIsEditing(false);
    setEditForm({ ...product });
    setShowAddVariant(false);
    setEditingVariantId(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedProduct) return;
    setIsSaving(true);
    try {
      const updated: Product = {
        ...selectedProduct,
        ...editForm,
        updated_at: new Date().toISOString(),
      };
      await onUpdateProduct(updated);
      setSelectedProduct(updated);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  // Variant operations in detail modal
  const handleAddVariant = async () => {
    if (!selectedProduct || !newVariantName.trim()) return;

    const newV: ProductVariant = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 12),
      product_id: selectedProduct.id,
      name: newVariantName.trim(),
      sku: newVariantSku.trim() || null,
      ean: newVariantEan.trim() || null,
      price: newVariantPrice !== '' ? Number(newVariantPrice) : selectedProduct.price,
      original_price: selectedProduct.original_price,
      stock_quantity: newVariantStock,
      availability: newVariantStock > 0 ? 'InStock' : 'OutOfStock',
      expiry_date: newVariantExpiry.trim() || null,
      available_online: true,
    };

    const updatedVariants = [...(selectedProduct.variants || []), newV];
    const updatedProd: Product = {
      ...selectedProduct,
      variants: updatedVariants,
      updated_at: new Date().toISOString(),
    };

    await onUpdateProduct(updatedProd);
    setSelectedProduct(updatedProd);
    setShowAddVariant(false);
    setNewVariantName('');
    setNewVariantSku('');
    setNewVariantEan('');
    setNewVariantPrice('');
    setNewVariantStock(10);
    setNewVariantExpiry('');
  };

  const handleSaveVariantEdit = async (variantId: string) => {
    if (!selectedProduct) return;
    const updatedVariants = (selectedProduct.variants || []).map((v) =>
      v.id === variantId ? { ...v, ...editVariantData } : v
    );
    const updatedProd: Product = {
      ...selectedProduct,
      variants: updatedVariants,
      updated_at: new Date().toISOString(),
    };
    await onUpdateProduct(updatedProd);
    setSelectedProduct(updatedProd);
    setEditingVariantId(null);
    setEditVariantData({});
  };

  const handleDeleteVariant = async (variantId: string) => {
    if (!selectedProduct) return;
    const updatedVariants = (selectedProduct.variants || []).filter((v) => v.id !== variantId);
    const updatedProd: Product = {
      ...selectedProduct,
      variants: updatedVariants,
      updated_at: new Date().toISOString(),
    };
    await onUpdateProduct(updatedProd);
    setSelectedProduct(updatedProd);
  };

  // Image operations
  const handleAddImage = async () => {
    if (!selectedProduct || !newImageUrl.trim()) return;
    const clean = newImageUrl.trim();
    if (selectedProduct.images.includes(clean)) return;

    const updatedImages = [...selectedProduct.images, clean];
    const updatedProd: Product = {
      ...selectedProduct,
      images: updatedImages,
      updated_at: new Date().toISOString(),
    };
    await onUpdateProduct(updatedProd);
    setSelectedProduct(updatedProd);
    setNewImageUrl('');
  };

  const handleRemoveImage = async (imgUrl: string) => {
    if (!selectedProduct) return;
    const updatedImages = selectedProduct.images.filter((img) => img !== imgUrl);
    const updatedProd: Product = {
      ...selectedProduct,
      images: updatedImages,
      updated_at: new Date().toISOString(),
    };
    await onUpdateProduct(updatedProd);
    setSelectedProduct(updatedProd);
  };

  // Pricing calculations for current product
  const pricingCalc = useMemo(() => {
    if (!selectedProduct) return null;
    return calculateEbayPricing(Number(selectedProduct.price) || 0);
  }, [selectedProduct]);

  return (
    <div className="space-y-4 pb-20 md:pb-8">
      {/* Top Controls Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3.5 shadow-sm">
        {/* Status Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-3">
          {(
            [
              { id: 'all', label: 'All Products', count: products.length },
              { id: 'ready', label: 'Ready for Listing', count: products.filter((p) => p.status === 'ready').length },
              { id: 'draft', label: 'Drafts', count: products.filter((p) => p.status === 'draft').length },
              { id: 'needs_review', label: 'Needs Review', count: products.filter((p) => p.status === 'needs_review').length },
              { id: 'archived', label: 'Archived', count: products.filter((p) => p.is_archived || p.status === 'archived').length },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusTab(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                statusTab === tab.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  statusTab === tab.id ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search & Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          {/* Search Input */}
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by title, brand, SKU, EAN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500"
            />
          </div>

          {/* Supplier Filter */}
          <div>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-emerald-500"
            >
              <option value="all">All Suppliers</option>
              {allSuppliers.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Stock Filter */}
          <div>
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-emerald-500"
            >
              <option value="all">All Stock Status</option>
              <option value="in_stock">In Stock (&gt; 0)</option>
              <option value="out_of_stock">Out of Stock (0)</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white outline-none focus:border-emerald-500"
            >
              <option value="date-desc">Newest Added</option>
              <option value="date-asc">Oldest Added</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="name-asc">Title: A &rarr; Z</option>
              <option value="name-desc">Title: Z &rarr; A</option>
            </select>
          </div>
        </div>

        {/* Action Bar (Export & Bulk Actions) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSelectAll}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 font-medium inline-flex items-center space-x-1.5"
            >
              {selectedIds.length === filteredProducts.length && filteredProducts.length > 0 ? (
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>Select All ({filteredProducts.length})</span>
            </button>

            {selectedIds.length > 0 && (
              <div className="flex items-center space-x-1.5 animate-in fade-in">
                {statusTab === 'archived' ? (
                  <button
                    onClick={handleBulkRestore}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white font-medium inline-flex items-center space-x-1"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                    <span>Restore ({selectedIds.length})</span>
                  </button>
                ) : (
                  <button
                    onClick={handleBulkArchive}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white font-medium inline-flex items-center space-x-1"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archive ({selectedIds.length})</span>
                  </button>
                )}

                <button
                  onClick={handleBulkCheckNow}
                  disabled={checkingProductIds.length > 0}
                  className="px-2.5 py-1.5 rounded-lg bg-blue-600/80 hover:bg-blue-600 text-white font-medium inline-flex items-center space-x-1"
                  title="Check price and stock for selected products now"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingProductIds.length > 0 ? 'animate-spin' : ''}`} />
                  <span>Check ({selectedIds.length})</span>
                </button>

                <button
                  onClick={() => setBulkDeleteConfirm(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white font-medium inline-flex items-center space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete ({selectedIds.length})</span>
                </button>
              </div>
            )}
          </div>

          {/* Export Dropdown */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                const csv = generateCombinedCsv(filteredProducts);
                downloadCsv(csv, `sinchods-products-${statusTab}.csv`);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 font-medium inline-flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Live Monitoring Notification Banner */}
        {monitoringMessage && (
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs animate-in fade-in ${
              monitoringMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-200'
                : monitoringMessage.type === 'error'
                ? 'bg-rose-950/60 border-rose-800/80 text-rose-200'
                : 'bg-blue-950/60 border-blue-800/80 text-blue-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {monitoringMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : monitoringMessage.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              ) : (
                <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
              )}
              <span>{monitoringMessage.text}</span>
            </div>
            <button
              onClick={() => setMonitoringMessage(null)}
              className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Bulk Delete Confirm Modal */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-sm text-white">Delete {selectedIds.length} Products</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              This will permanently delete the selected products and their associated variants from this workspace. This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setBulkDeleteConfirm(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onBulkDelete(selectedIds);
                  setSelectedIds([]);
                  setBulkDeleteConfirm(false);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Products Grid */}
      {filteredProducts.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
            <Package className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">No products found</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {searchQuery
              ? `No catalog items matched "${searchQuery}". Try adjusting your search query or filters.`
              : 'There are currently no products in this view. Use the Scraper or HTML Import to add products.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredProducts.map((product) => {
            const isSelected = selectedIds.includes(product.id);
            const isArchived = product.is_archived || product.status === 'archived';

            return (
              <div
                key={product.id}
                className={`bg-slate-900/90 border rounded-2xl p-4 flex flex-col justify-between space-y-3 transition-all shadow-sm ${
                  isSelected ? 'border-emerald-500/60 bg-slate-900 ring-1 ring-emerald-500/40' : 'border-slate-800 hover:border-slate-700'
                } ${isArchived ? 'opacity-70 bg-slate-950/60' : ''}`}
              >
                <div>
                  {/* Top Bar: Checkbox + Status Badges */}
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <button
                      onClick={() => handleToggleSelect(product.id)}
                      className="text-slate-400 hover:text-white"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600" />
                      )}
                    </button>

                    <div className="flex items-center space-x-1.5">
                      {isArchived ? (
                        <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-semibold">
                          Archived
                        </span>
                      ) : (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            product.status === 'ready'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : product.status === 'draft'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {product.status === 'draft' ? 'Draft' : product.status === 'ready' ? 'Ready' : 'Needs Review'}
                        </span>
                      )}

                      {/* Monitoring Status Badge */}
                      {product.monitoring_status && product.monitoring_status !== 'idle' && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                            product.monitoring_status === 'checking' || checkingProductIds.includes(product.id)
                              ? 'bg-blue-500/20 text-blue-300 animate-pulse'
                              : product.monitoring_status === 'out_of_stock'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : product.monitoring_status === 'pending_approval'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : product.monitoring_status === 'changes_detected'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {checkingProductIds.includes(product.id) || product.monitoring_status === 'checking'
                            ? 'Checking...'
                            : product.monitoring_status === 'out_of_stock'
                            ? 'Out of Stock'
                            : product.monitoring_status === 'pending_approval'
                            ? 'Price Approval'
                            : product.monitoring_status === 'changes_detected'
                            ? 'Review Changes'
                            : 'Check Error'}
                        </span>
                      )}

                      {/* eBay Badge */}
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          product.ebay_status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : product.ebay_status === 'draft'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        eBay: {product.ebay_status || 'not_listed'}
                      </span>
                    </div>
                  </div>

                  {/* Product Title & Brand */}
                  <div className="flex items-start space-x-3">
                    {product.images && product.images.length > 0 ? (
                      <img
                        src={product.images[0]}
                        alt={product.title}
                        className="w-14 h-14 rounded-xl object-cover bg-slate-950 border border-slate-800 flex-shrink-0"
                        onError={(e) => {
                          (e.target as any).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-600 flex-shrink-0">
                        <Package className="w-6 h-6" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <h4
                        onClick={() => handleOpenDetail(product)}
                        className="text-xs font-bold text-white hover:text-emerald-400 cursor-pointer line-clamp-2 leading-snug"
                        title={product.title}
                      >
                        {product.title}
                      </h4>
                      <div className="flex items-center space-x-2 mt-1 text-[11px] text-slate-400">
                        <span>{product.brand || 'Generic'}</span>
                        {product.supplier_name && (
                          <>
                            <span>•</span>
                            <span className="text-slate-500">{product.supplier_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Price & SKU Specs */}
                  <div className="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-slate-800/80 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Supplier Cost</span>
                      <span className="font-bold text-emerald-400">
                        {product.price !== null ? `€ ${Number(product.price).toFixed(2)}` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Stock / Variants</span>
                      <span className="font-semibold text-slate-200">
                        {product.variants?.length ? `${product.variants.length} variants` : `${product.stock_quantity ?? 0} in stock`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-1 text-xs">
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => handleOpenDetail(product, 'overview')}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium"
                    >
                      Detail
                    </button>
                    <button
                      onClick={() => onOpenListingBuilder(product)}
                      className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold inline-flex items-center space-x-1"
                      title="Create eBay listing"
                    >
                      <Store className="w-3 h-3" />
                      <span>eBay</span>
                    </button>
                    <button
                      onClick={() => handleCheckNow(product.id)}
                      disabled={checkingProductIds.includes(product.id)}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium inline-flex items-center space-x-1"
                      title="Check price and stock now"
                    >
                      <RefreshCw className={`w-3 h-3 ${checkingProductIds.includes(product.id) ? 'animate-spin text-blue-400' : 'text-slate-400'}`} />
                      <span>Check</span>
                    </button>
                  </div>

                  <div className="flex items-center space-x-1">
                    {isArchived ? (
                      <button
                        onClick={() => handleRestore(product.id)}
                        className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-emerald-400"
                        title="Restore product"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleArchive(product.id)}
                        className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400"
                        title="Archive product"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteConfirmId(product.id)}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400"
                      title="Delete product"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Single Product Confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-sm text-white">Delete Product</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete this product and its variants from this workspace?
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onDeleteProduct(deleteConfirmId);
                  setDeleteConfirmId(null);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comprehensive 7-Section Product Detail & Edit Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl animate-in fade-in">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80 rounded-t-2xl">
              <div className="flex items-center space-x-2 min-w-0">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex-shrink-0">
                  {selectedProduct.supplier_name || selectedProduct.supplier_id}
                </span>
                <h3 className="text-sm font-bold text-white truncate max-w-md">
                  {isEditing ? `Editing: ${selectedProduct.title}` : selectedProduct.title}
                </h3>
              </div>
              <div className="flex items-center space-x-1.5 flex-shrink-0">
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center space-x-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                ) : (
                  <button
                    onClick={handleSaveEdit}
                    disabled={isSaving}
                    className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center space-x-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving...' : 'Save'}</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedProduct(null);
                    setIsEditing(false);
                  }}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 8 Section Navigation Tabs */}
            <div className="flex items-center space-x-1 px-4 py-2 bg-slate-950 border-b border-slate-800/80 overflow-x-auto text-xs">
              {(
                [
                  { id: 'overview', label: '1. Overview' },
                  { id: 'monitoring', label: `2. Monitoring${activePriceApprovals.length + activeProductReviews.length > 0 ? ` (${activePriceApprovals.length + activeProductReviews.length})` : ''}` },
                  { id: 'variants', label: `3. Variants (${selectedProduct.variants?.length || 0})` },
                  { id: 'images', label: `4. Images (${selectedProduct.images?.length || 0})` },
                  { id: 'ebay', label: '5. eBay Listing' },
                  { id: 'pricing', label: '6. Pricing' },
                  { id: 'stock', label: '7. Stock' },
                  { id: 'history', label: '8. History' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setIsEditing(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all ${
                    activeTab === tab.id
                      ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Modal Body / Active Tab Content */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* SECTION 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  {/* URL Bar */}
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-emerald-400 truncate">{selectedProduct.url}</span>
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedProduct.url);
                          setCopiedUrl(true);
                          setTimeout(() => setCopiedUrl(false), 2000);
                        }}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                        title="Copy URL"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={selectedProduct.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                        title="Open external source"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Product Title</label>
                        <input
                          type="text"
                          value={editForm.title || ''}
                          onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-400 mb-1 font-medium">Brand</label>
                          <input
                            type="text"
                            value={editForm.brand || ''}
                            onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1 font-medium">Category</label>
                          <input
                            type="text"
                            value={editForm.category || ''}
                            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Description</label>
                        <textarea
                          rows={4}
                          value={editForm.description || ''}
                          onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                          <span className="text-[10px] text-slate-500 block">Brand</span>
                          <span className="font-semibold text-white">{selectedProduct.brand || 'Generic'}</span>
                        </div>
                        <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                          <span className="text-[10px] text-slate-500 block">Category</span>
                          <span className="font-semibold text-slate-200 truncate block">{selectedProduct.category || 'General'}</span>
                        </div>
                        <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                          <span className="text-[10px] text-slate-500 block">SKU / EAN</span>
                          <span className="font-mono text-slate-200 truncate block">
                            {selectedProduct.sku || 'No SKU'} / {selectedProduct.ean || 'No EAN'}
                          </span>
                        </div>
                        <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                          <span className="text-[10px] text-slate-500 block">Status</span>
                          <span className="font-bold text-emerald-400 uppercase text-[10px]">{selectedProduct.status}</span>
                        </div>
                      </div>

                      {selectedProduct.description && (
                        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Description</span>
                          <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{selectedProduct.description}</p>
                        </div>
                      )}

                      {selectedProduct.ingredients && (
                        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Ingredients</span>
                          <p className="text-slate-300 leading-relaxed">{selectedProduct.ingredients}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* SECTION 2: MONITORING & ALERTS (Phase 1.4) */}
              {activeTab === 'monitoring' && (
                <div className="space-y-4">
                  {/* Status & Quick Check Bar */}
                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] uppercase font-bold text-slate-500">Monitoring Status:</span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            selectedProduct.monitoring_status === 'checking' || checkingProductIds.includes(selectedProduct.id)
                              ? 'bg-blue-500/20 text-blue-300 animate-pulse'
                              : selectedProduct.monitoring_status === 'out_of_stock'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : selectedProduct.monitoring_status === 'pending_approval'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : selectedProduct.monitoring_status === 'changes_detected'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : selectedProduct.monitoring_status === 'error'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {checkingProductIds.includes(selectedProduct.id)
                            ? 'Checking...'
                            : selectedProduct.monitoring_status === 'out_of_stock'
                            ? 'Out of Stock'
                            : selectedProduct.monitoring_status === 'pending_approval'
                            ? 'Pending Price Approval'
                            : selectedProduct.monitoring_status === 'changes_detected'
                            ? 'Content Changes Review'
                            : selectedProduct.monitoring_status === 'error'
                            ? 'Supplier Fetch Error'
                            : 'Active / Monitored'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Supplier URL checked automatically every 6 hours. Background jobs detect price, stock, and content modifications.
                      </p>
                    </div>

                    <button
                      onClick={() => handleCheckNow(selectedProduct.id)}
                      disabled={checkingProductIds.includes(selectedProduct.id)}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs inline-flex items-center space-x-1.5 shadow-sm"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${checkingProductIds.includes(selectedProduct.id) ? 'animate-spin' : ''}`} />
                      <span>{checkingProductIds.includes(selectedProduct.id) ? 'Checking Supplier...' : 'Check Supplier Now'}</span>
                    </button>
                  </div>

                  {/* Operational Metrics Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Last Checked</span>
                      <span className="font-semibold text-white">
                        {selectedProduct.last_checked_at ? new Date(selectedProduct.last_checked_at).toLocaleTimeString() : 'Not yet'}
                      </span>
                    </div>
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Next Scheduled Check</span>
                      <span className="font-semibold text-slate-200">
                        {selectedProduct.next_check_at ? new Date(selectedProduct.next_check_at).toLocaleTimeString() : 'Within 6h'}
                      </span>
                    </div>
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Last Successful Response</span>
                      <span className="font-semibold text-emerald-400">
                        {selectedProduct.last_successful_response_at
                          ? new Date(selectedProduct.last_successful_response_at).toLocaleDateString()
                          : 'Recent'}
                      </span>
                    </div>
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Consecutive Failures</span>
                      <span className={`font-semibold ${(selectedProduct.consecutive_failures || 0) > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                        {selectedProduct.consecutive_failures || 0} / 3 retries
                      </span>
                    </div>
                  </div>

                  {/* Last Error Banner (if error occurred) */}
                  {selectedProduct.last_monitoring_error && (
                    <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-xl text-rose-300 text-[11px] flex items-start space-x-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block text-white">Supplier Scraping Issue Detected</span>
                        <span>{selectedProduct.last_monitoring_error}</span>
                        <span className="block mt-1 text-[10px] text-rose-400">Last reliable price and stock are preserved. Retrying with backoff.</span>
                      </div>
                    </div>
                  )}

                  {/* Pending Price Approvals */}
                  {activePriceApprovals.length > 0 && (
                    <div className="p-3 bg-slate-950 border border-amber-500/40 rounded-xl space-y-2.5">
                      <div className="flex items-center space-x-2 text-amber-400">
                        <TrendingDown className="w-4 h-4" />
                        <h4 className="font-bold text-xs">Pending Price Approval</h4>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        A supplier price change occurred that requires manual review before applying it to your eBay listing.
                      </p>
                      <div className="space-y-2">
                        {activePriceApprovals.map((pa) => (
                          <div key={pa.id} className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="space-y-0.5">
                              <div className="flex items-center space-x-2 text-xs">
                                <span className="text-slate-400">Supplier Cost:</span>
                                <span className="line-through text-slate-500">€{pa.old_cost?.toFixed(2) || pa.old_price?.toFixed(2)}</span>
                                <span className="font-bold text-emerald-400">→ €{pa.new_cost?.toFixed(2) || pa.new_price?.toFixed(2)}</span>
                                {pa.new_selling_price && (
                                  <span className="text-slate-300">
                                    (New Selling: <strong>€{pa.new_selling_price.toFixed(2)}</strong>)
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400">{pa.reason}</p>
                            </div>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                              <button
                                onClick={() => handleApprovePrice(pa.id)}
                                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs inline-flex items-center space-x-1"
                              >
                                <Check className="w-3 h-3" />
                                <span>Approve</span>
                              </button>
                              <button
                                onClick={() => handleRejectPrice(pa.id)}
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs inline-flex items-center space-x-1"
                              >
                                <X className="w-3 h-3" />
                                <span>Reject</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Supplier Content Changes Requiring Review */}
                  {activeProductReviews.length > 0 && (
                    <div className="p-3 bg-slate-950 border border-purple-500/40 rounded-xl space-y-2.5">
                      <div className="flex items-center space-x-2 text-purple-400">
                        <Edit3 className="w-4 h-4" />
                        <h4 className="font-bold text-xs">Supplier Content Modifications</h4>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        Supplier page content differed from catalog records. Per anti-overwrite protection, changes are held here for your review:
                      </p>
                      <div className="space-y-2">
                        {activeProductReviews.map((rev) => (
                          <div key={rev.id} className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase font-bold text-purple-400 tracking-wider">
                                Modified Field: {rev.field_name}
                              </span>
                              <div className="flex items-center space-x-1.5">
                                <button
                                  onClick={() => handleApproveReview(rev.id)}
                                  className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-[11px] inline-flex items-center space-x-1"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Accept</span>
                                </button>
                                <button
                                  onClick={() => handleRejectReview(rev.id)}
                                  className="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-[11px] inline-flex items-center space-x-1"
                                >
                                  <X className="w-3 h-3" />
                                  <span>Dismiss</span>
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                              <div className="p-2 bg-slate-950 rounded border border-slate-800">
                                <span className="text-[9px] uppercase font-bold text-slate-500 block mb-0.5">Current Value:</span>
                                <span className="text-slate-300 line-clamp-3">
                                  {typeof rev.old_value === 'object' ? JSON.stringify(rev.old_value) : String(rev.old_value || 'Empty')}
                                </span>
                              </div>
                              <div className="p-2 bg-purple-950/30 rounded border border-purple-800/60">
                                <span className="text-[9px] uppercase font-bold text-purple-300 block mb-0.5">Detected on Supplier:</span>
                                <span className="text-purple-200 font-medium line-clamp-3">
                                  {typeof rev.new_value === 'object' ? JSON.stringify(rev.new_value) : String(rev.new_value || 'Empty')}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reassurance state */}
                  {activePriceApprovals.length === 0 && activeProductReviews.length === 0 && (
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-400 text-[11px] flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>All pricing rules, stock levels, and supplier specifications are current. No pending approvals required.</span>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 3: VARIANTS */}
              {activeTab === 'variants' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      Product variants retain independent SKU, EAN, price, and stock levels. Never flattened into parents.
                    </span>
                    <button
                      onClick={() => setShowAddVariant(true)}
                      className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Variant</span>
                    </button>
                  </div>

                  {showAddVariant && (
                    <div className="p-3 bg-slate-950 border border-emerald-500/30 rounded-xl space-y-2.5">
                      <span className="font-bold text-emerald-400 block text-xs">New Variant Details</span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-400 block">Variant Name *</label>
                          <input
                            type="text"
                            placeholder="e.g. Vanilla / 2kg"
                            value={newVariantName}
                            onChange={(e) => setNewVariantName(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block">SKU Code</label>
                          <input
                            type="text"
                            placeholder="SKU-VAN-2KG"
                            value={newVariantSku}
                            onChange={(e) => setNewVariantSku(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block">EAN Code</label>
                          <input
                            type="text"
                            placeholder="8033221144550"
                            value={newVariantEan}
                            onChange={(e) => setNewVariantEan(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block">Price (€)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={newVariantPrice}
                            onChange={(e) => setNewVariantPrice(e.target.value ? parseFloat(e.target.value) : '')}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block">Stock Units</label>
                          <input
                            type="number"
                            value={newVariantStock}
                            onChange={(e) => setNewVariantStock(parseInt(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block">Expiry Date</label>
                          <input
                            type="text"
                            placeholder="30/06/2027"
                            value={newVariantExpiry}
                            onChange={(e) => setNewVariantExpiry(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end space-x-2 pt-1">
                        <button
                          onClick={() => setShowAddVariant(false)}
                          className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleAddVariant}
                          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs"
                        >
                          Save Variant
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Variants List */}
                  {selectedProduct.variants && selectedProduct.variants.length > 0 ? (
                    <div className="space-y-2">
                      {selectedProduct.variants.map((v) => {
                        const isEditingThis = editingVariantId === v.id;

                        return (
                          <div
                            key={v.id}
                            className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                          >
                            {isEditingThis ? (
                              <div className="w-full space-y-2">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  <input
                                    type="text"
                                    value={editVariantData.name ?? v.name}
                                    onChange={(e) => setEditVariantData({ ...editVariantData, name: e.target.value })}
                                    className="bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                                  />
                                  <input
                                    type="text"
                                    placeholder="SKU"
                                    value={editVariantData.sku ?? v.sku ?? ''}
                                    onChange={(e) => setEditVariantData({ ...editVariantData, sku: e.target.value })}
                                    className="bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono"
                                  />
                                  <input
                                    type="number"
                                    placeholder="Price"
                                    value={editVariantData.price ?? v.price ?? ''}
                                    onChange={(e) =>
                                      setEditVariantData({
                                        ...editVariantData,
                                        price: e.target.value ? parseFloat(e.target.value) : null,
                                      })
                                    }
                                    className="bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono"
                                  />
                                  <input
                                    type="number"
                                    placeholder="Stock"
                                    value={editVariantData.stock_quantity ?? v.stock_quantity ?? ''}
                                    onChange={(e) =>
                                      setEditVariantData({
                                        ...editVariantData,
                                        stock_quantity: parseInt(e.target.value) || 0,
                                      })
                                    }
                                    className="bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono"
                                  />
                                </div>
                                <div className="flex justify-end space-x-2">
                                  <button
                                    onClick={() => setEditingVariantId(null)}
                                    className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-[11px]"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSaveVariantEdit(v.id)}
                                    className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="space-y-1">
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold text-white text-xs">{v.name}</span>
                                    <span
                                      className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                                        (v.stock_quantity ?? 0) > 0
                                          ? 'bg-emerald-500/20 text-emerald-400'
                                          : 'bg-rose-500/20 text-rose-400'
                                      }`}
                                    >
                                      {(v.stock_quantity ?? 0) > 0 ? `${v.stock_quantity} in stock` : 'Out of Stock'}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-400 font-mono">
                                    <span>SKU: {v.sku || 'N/A'}</span>
                                    <span>EAN: {v.ean || 'N/A'}</span>
                                    {v.expiry_date && <span>Exp: {v.expiry_date}</span>}
                                  </div>
                                </div>

                                <div className="flex items-center space-x-2">
                                  <span className="text-sm font-bold text-emerald-400">
                                    {v.price !== null ? `€ ${Number(v.price).toFixed(2)}` : 'N/A'}
                                  </span>
                                  <button
                                    onClick={() => {
                                      setEditingVariantId(v.id);
                                      setEditVariantData({ ...v });
                                    }}
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                                    title="Edit variant"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteVariant(v.id)}
                                    className="p-1 rounded bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400"
                                    title="Delete variant"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-slate-500 border border-slate-800 rounded-xl">
                      No separate variants detected for this product.
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 3: IMAGES */}
              {activeTab === 'images' && (
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="url"
                      placeholder="Add image URL (https://...)"
                      value={newImageUrl}
                      onChange={(e) => setNewImageUrl(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-white font-mono text-xs"
                    />
                    <button
                      onClick={handleAddImage}
                      className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-xs inline-flex items-center space-x-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Image</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {selectedProduct.images && selectedProduct.images.length > 0 ? (
                      selectedProduct.images.map((img, idx) => (
                        <div
                          key={idx}
                          className="group relative bg-slate-950 border border-slate-800 rounded-xl overflow-hidden aspect-square flex items-center justify-center"
                        >
                          <img src={img} alt={`Product ${idx + 1}`} className="w-full h-full object-cover" />
                          {idx === 0 && (
                            <span className="absolute top-1.5 left-1.5 bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                              Primary
                            </span>
                          )}
                          <button
                            onClick={() => handleRemoveImage(img)}
                            className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-black/70 hover:bg-rose-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove image"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-4 p-8 text-center text-slate-500 border border-slate-800 rounded-xl">
                        No product images found. Add an image URL above.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SECTION 4: EBAY LISTING */}
              {activeTab === 'ebay' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">Publication Status</span>
                      <span className="text-sm font-bold text-white capitalize">
                        {selectedProduct.ebay_status || 'not_listed'}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        const p = selectedProduct;
                        setSelectedProduct(null);
                        onOpenListingBuilder(p);
                      }}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-xs inline-flex items-center space-x-1.5 shadow-sm"
                    >
                      <Store className="w-4 h-4" />
                      <span>Open in eBay Listing Builder &rarr;</span>
                    </button>
                  </div>

                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">eBay Title Compliance</span>
                    <div className="p-2 bg-slate-900 rounded border border-slate-800 text-white font-mono text-[11px]">
                      {selectedProduct.title.slice(0, 80)}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Length: {selectedProduct.title.length}/80 characters</span>
                      <span className={selectedProduct.title.length <= 80 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                        {selectedProduct.title.length <= 80 ? '✓ Compliant with eBay.it limits' : '⚠ Exceeds 80 character limit'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 6: PRICING */}
              {activeTab === 'pricing' && pricingCalc && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Supplier Cost</span>
                      <span className="text-base font-bold text-white">€ {pricingCalc.supplierCost.toFixed(2)}</span>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Selling Price</span>
                      <span className="text-base font-bold text-emerald-400">
                        € {(selectedProduct.calculated_selling_price || pricingCalc.recommendedPrice).toFixed(2)}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Break-Even Price</span>
                      <span className="text-base font-bold text-amber-400">€ {pricingCalc.breakEvenPrice.toFixed(2)}</span>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Expected Profit</span>
                      <span className="text-base font-bold text-emerald-300">
                        € {pricingCalc.expectedNetProfit.toFixed(2)} ({pricingCalc.profitMarginPercent.toFixed(1)}%)
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-300 space-y-2 leading-relaxed text-[11px]">
                    <span className="font-bold text-slate-200 block text-xs">Cost, Fee &amp; Profit Transparency Breakdown</span>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1">
                      <span>Supplier Product Base Cost:</span>
                      <span className="text-white font-mono">€ {pricingCalc.supplierCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1">
                      <span>Supplier Shipping Fee:</span>
                      <span className="text-slate-300 font-mono">€ {pricingCalc.supplierShipping.toFixed(2)}</span>
                    </div>
                    {pricingCalc.packagingCost !== undefined && pricingCalc.packagingCost > 0 && (
                      <div className="flex justify-between border-b border-slate-800/60 pb-1">
                        <span>Packaging &amp; Additional Materials:</span>
                        <span className="text-slate-300 font-mono">€ {pricingCalc.packagingCost.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-b border-slate-800/60 pb-1">
                      <span>Total Sourcing Cost:</span>
                      <span className="text-amber-400 font-mono font-bold">€ {pricingCalc.totalCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1">
                      <span>Estimated eBay Selling Commission (11.5% + €0.35 fixed):</span>
                      <span className="text-rose-400 font-mono">- € {pricingCalc.expectedEbayFees.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between pt-0.5 font-semibold">
                      <span className="text-emerald-400">Estimated Net Dropship Profit:</span>
                      <span className="text-emerald-400 font-mono font-bold">
                        € {pricingCalc.expectedNetProfit.toFixed(2)} ({pricingCalc.profitMarginPercent.toFixed(1)}% margin)
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-blue-950/30 border border-blue-800/60 rounded-xl text-blue-200 text-[11px] leading-relaxed">
                    <span className="font-bold block text-white mb-0.5">Automated Price Protection Rule</span>
                    Supplier price increases automatically update the listing only when the configured minimum profit threshold is preserved. If an increase reduces profit below minimum, the change is paused and an alert is created. Supplier price decreases are always placed in the approval queue.
                  </div>
                </div>
              )}

              {/* SECTION 7: STOCK */}
              {activeTab === 'stock' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Total Catalog Stock</span>
                      <span className="text-xl font-bold text-white">
                        {selectedProduct.variants?.length
                          ? selectedProduct.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0)
                          : selectedProduct.stock_quantity ?? 0}{' '}
                        units
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-500 block">Availability Flag</span>
                      <span
                        className={`text-sm font-bold block mt-1 ${
                          selectedProduct.availability === 'InStock' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {selectedProduct.availability || 'InStock'}
                      </span>
                    </div>
                  </div>

                  {selectedProduct.variants && selectedProduct.variants.length > 0 && (
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Per-Variant Inventory Breakdown
                      </span>
                      <div className="space-y-1.5">
                        {selectedProduct.variants.map((v) => (
                          <div key={v.id} className="flex justify-between items-center text-xs p-1.5 bg-slate-900 rounded border border-slate-800">
                            <span className="text-white font-medium">{v.name}</span>
                            <span
                              className={`font-mono font-bold ${
                                (v.stock_quantity || 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {v.stock_quantity ?? 0} units
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 8: HISTORY & AUDIT TRAIL */}
              {activeTab === 'history' && (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Audit &amp; Lifecycle Events</span>
                    <div className="space-y-2 text-slate-300 text-[11px]">
                      <div className="flex items-center space-x-2">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Created on: <strong>{new Date(selectedProduct.created_at).toLocaleString()}</strong></span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                        <span>Last updated: <strong>{new Date(selectedProduct.updated_at).toLocaleString()}</strong></span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Package className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Import Source: <strong>{selectedProduct.import_source}</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Price & Stock Monitoring History Log */}
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">
                      Price &amp; Stock Monitoring Audit Log ({activeProductHistory.length})
                    </span>
                    {activeProductHistory.length > 0 ? (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {activeProductHistory.map((item) => (
                          <div key={item.id} className="p-2 bg-slate-900 rounded border border-slate-800 text-[11px] space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-white capitalize">
                                {item.change_type?.replace('_', ' ') || 'Price Change'}
                              </span>
                              <div className="flex items-center space-x-2">
                                <span
                                  className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                    item.status === 'applied' || item.status === 'approved'
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : item.status === 'pending_approval'
                                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  }`}
                                >
                                  {item.status}
                                </span>
                                <span className="text-slate-500 text-[10px]">{new Date(item.changed_at).toLocaleString()}</span>
                              </div>
                            </div>
                            <div className="text-slate-300">
                              Cost: €{item.old_cost?.toFixed(2) ?? item.old_price?.toFixed(2) ?? 'N/A'} → €{item.new_cost?.toFixed(2) ?? item.new_price?.toFixed(2) ?? 'N/A'}
                              {item.new_selling_price && ` | Selling: €${item.new_selling_price.toFixed(2)}`}
                            </div>
                            {item.reason && <p className="text-[10px] text-slate-400 leading-tight">{item.reason}</p>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-500 text-[11px] italic">No price or stock alterations recorded yet.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
