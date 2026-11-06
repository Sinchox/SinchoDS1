import React, { useState, useMemo } from 'react';
import { EbayListing, Product } from '../types.js';
import { PageId } from './Navbar.js';
import {
  Store,
  ExternalLink,
  Edit3,
  Trash2,
  Send,
  Eye,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  ArrowUpDown,
  Tag,
  DollarSign,
  TrendingUp,
  Package,
  FileText,
  ShieldCheck,
} from 'lucide-react';

interface ListingsProps {
  listings: EbayListing[];
  products: Product[];
  onUpdateListing: (listing: EbayListing) => Promise<void>;
  onDeleteListing: (id: string) => Promise<void>;
  onOpenListingBuilder: (product: Product) => void;
  setCurrentPage: (page: PageId) => void;
}

export const Listings: React.FC<ListingsProps> = ({
  listings,
  products,
  onUpdateListing,
  onDeleteListing,
  onOpenListingBuilder,
  setCurrentPage,
}) => {
  const [tabFilter, setTabFilter] = useState<'all' | 'draft' | 'active' | 'ended' | 'error'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedListing, setSelectedListing] = useState<EbayListing | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isPublishingId, setIsPublishingId] = useState<string | null>(null);

  // Filter listings
  const filteredListings = useMemo(() => {
    return listings.filter((l) => {
      if (tabFilter !== 'all' && l.status !== tabFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = l.title.toLowerCase().includes(q);
        const matchBrand = l.brand ? l.brand.toLowerCase().includes(q) : false;
        const matchSku = l.sku ? l.sku.toLowerCase().includes(q) : false;
        const matchId = l.ebay_item_id ? l.ebay_item_id.toLowerCase().includes(q) : false;
        if (!matchTitle && !matchBrand && !matchSku && !matchId) return false;
      }
      return true;
    });
  }, [listings, tabFilter, searchQuery]);

  // Counts
  const draftCount = listings.filter((l) => l.status === 'draft').length;
  const activeCount = listings.filter((l) => l.status === 'active').length;
  const totalProfitEstimate = listings.reduce((acc, l) => acc + (l.expected_profit || 0), 0);

  // Publish draft handler
  const handlePublishDraft = async (listing: EbayListing) => {
    setIsPublishingId(listing.id);
    try {
      const res = await fetch('/api/ebay/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing }),
      });
      const data = await res.json();

      if (data.ok && data.ebayItemId) {
        const updated: EbayListing = {
          ...listing,
          status: 'active',
          ebay_item_id: data.ebayItemId,
          published_at: new Date().toISOString(),
        };
        await onUpdateListing(updated);
        alert(`Listing published successfully to eBay.it! Item ID: ${data.ebayItemId}`);
      } else {
        alert(data.message || 'eBay seller account not yet authorized. The listing remains saved as a draft.');
      }
    } catch (err: any) {
      alert(`Publishing error: ${err.message || 'Network communication failure'}`);
    } finally {
      setIsPublishingId(null);
    }
  };

  return (
    <div className="space-y-4 pb-20 md:pb-8">
      {/* Top Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-2">
            <Store className="w-5 h-5 text-blue-400" />
            <span>eBay.it Listing Manager</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Monitor created drafts, listings published with official eBay APIs, supplier costs, and projected net profits.
          </p>
        </div>

        {/* Quick KPI stats */}
        <div className="flex items-center space-x-2">
          <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-400 block">Drafts</span>
            <span className="text-xs font-bold text-amber-400">{draftCount}</span>
          </div>
          <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-400 block">Published</span>
            <span className="text-xs font-bold text-emerald-400">{activeCount}</span>
          </div>
          <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-center">
            <span className="text-[10px] text-slate-400 block">Est. Profit</span>
            <span className="text-xs font-bold text-white">€ {totalProfitEstimate.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Tabs Filter Bar */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setTabFilter('all')}
          className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
            tabFilter === 'all'
              ? 'bg-emerald-600 text-white font-semibold'
              : 'bg-slate-900 text-slate-400 hover:text-white'
          }`}
        >
          All ({listings.length})
        </button>
        <button
          onClick={() => setTabFilter('draft')}
          className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
            tabFilter === 'draft'
              ? 'bg-amber-600 text-white font-semibold'
              : 'bg-slate-900 text-slate-400 hover:text-white'
          }`}
        >
          Drafts ({draftCount})
        </button>
        <button
          onClick={() => setTabFilter('active')}
          className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
            tabFilter === 'active'
              ? 'bg-emerald-600 text-white font-semibold'
              : 'bg-slate-900 text-slate-400 hover:text-white'
          }`}
        >
          Published ({activeCount})
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search listings by title, SKU, or eBay Item ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
        />
      </div>

      {/* Listings Cards Grid */}
      {filteredListings.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center text-slate-400">
          <Store className="w-12 h-12 mx-auto text-slate-600 mb-2" />
          <p className="text-base font-semibold text-slate-300">No eBay listings found</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {tabFilter === 'all'
              ? 'You have not created any drafts yet. Go to the Product Catalogue and tap "Create eBay Listing" on any product.'
              : `No listings match the filter "${tabFilter}".`}
          </p>
          <button
            onClick={() => setCurrentPage('products')}
            className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl"
          >
            Go to Product Catalogue
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {filteredListings.map((listing) => {
            const isDraft = listing.status === 'draft';
            const isActive = listing.status === 'active';
            const isReady = listing.validation_status === 'ready';

            return (
              <div
                key={listing.id}
                className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3 hover:border-slate-700 shadow-sm"
              >
                <div>
                  {/* Card Header: Status pill, word count & Marketplace */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center space-x-1.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isActive
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : isReady
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {isActive ? '● PUBLISHED' : isReady ? 'READY DRAFT' : 'NEEDS REVIEW'}
                      </span>

                      {listing.word_count && (
                        <span className="text-[10px] text-slate-400 bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded font-mono">
                          {listing.word_count} words
                        </span>
                      )}
                    </div>

                    <span className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full font-mono">
                      eBay.it
                    </span>
                  </div>

                  {/* Title & Brand */}
                  <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-2 leading-snug">
                    {listing.title}
                  </h3>

                  {listing.brand && (
                    <span className="text-[11px] text-purple-400 block mt-1">
                      Brand: {listing.brand}
                    </span>
                  )}

                  {/* Price & Profit Matrix */}
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-slate-800 text-center">
                    <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">Selling Price</span>
                      <span className="text-xs font-bold text-white">€ {Number(listing.price).toFixed(2)}</span>
                    </div>

                    <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">Supplier Cost</span>
                      <span className="text-xs font-mono text-slate-300">
                        € {Number(listing.original_supplier_cost).toFixed(2)}
                      </span>
                    </div>

                    <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">Net Profit</span>
                      <span className="text-xs font-bold text-emerald-400">
                        € {Number(listing.expected_profit).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Identifiers & Details */}
                  <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[10px] text-slate-400 font-mono">
                    {listing.ebay_item_id && (
                      <span className="text-blue-300 font-semibold">
                        eBay ID: {listing.ebay_item_id}
                      </span>
                    )}
                    {listing.sku && <span>SKU: {listing.sku}</span>}
                    {listing.ean && <span>EAN: {listing.ean}</span>}
                    <span className="text-slate-300">Qty: {listing.quantity}</span>
                  </div>
                </div>

                {/* Bottom Card Actions */}
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <button
                    onClick={() => setSelectedListing(listing)}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium inline-flex items-center space-x-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </button>

                  <div className="flex items-center space-x-2">
                    {isDraft && (
                      <button
                        onClick={() => handlePublishDraft(listing)}
                        disabled={isPublishingId === listing.id}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1"
                      >
                        <Send className="w-3 h-3" />
                        <span>{isPublishingId === listing.id ? 'Publishing...' : 'Publish'}</span>
                      </button>
                    )}

                    <button
                      onClick={() => setDeleteConfirmId(listing.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                      title="Delete listing"
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

      {/* Listing Preview Modal */}
      {selectedListing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-850 rounded-t-2xl">
              <h3 className="font-bold text-white text-sm truncate max-w-md">
                eBay Listing Preview: {selectedListing.title}
              </h3>
              <button
                onClick={() => setSelectedListing(null)}
                className="text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
                <div>
                  <span className="text-slate-400 block text-[10px]">eBay Italy Price</span>
                  <span className="text-base font-bold text-emerald-400 font-mono">
                    € {Number(selectedListing.price).toFixed(2)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 block text-[10px]">Status</span>
                  <span className="font-semibold text-white uppercase">{selectedListing.status}</span>
                </div>
              </div>

              {/* HTML Description preview container */}
              <div>
                <span className="font-bold text-slate-300 block mb-2">Description Template (Italian SEO):</span>
                <div
                  className="bg-white p-4 rounded-xl text-slate-900 max-h-80 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: selectedListing.description_html }}
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-850 flex justify-end rounded-b-2xl">
              <button
                onClick={() => setSelectedListing(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-55 flex items-center justify-center bg-black/75 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="text-sm font-bold text-white">Delete Listing Draft</h3>
            <p className="text-xs text-slate-400">
              Are you sure you want to delete this listing? The draft will be removed from SinchoDS.
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = deleteConfirmId;
                  setDeleteConfirmId(null);
                  await onDeleteListing(id);
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
