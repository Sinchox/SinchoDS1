import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Package,
  Layers,
  Store,
  Globe,
  Settings as SettingsIcon,
  Database,
  Tag,
  Bell,
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  Check,
} from 'lucide-react';
import { Notification } from '../types.js';

export type PageId = 'dashboard' | 'products' | 'suppliers' | 'listings' | 'scraper' | 'html-import' | 'settings';

interface NavbarProps {
  currentPage: PageId;
  setCurrentPage: (page: PageId) => void;
  productsCount: number;
  listingsCount: number;
  isSupabaseConnected: boolean;
  isEbayConnected: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentPage,
  setCurrentPage,
  productsCount,
  listingsCount,
  isSupabaseConnected,
  isEbayConnected,
}) => {
  // Notifications state (Phase 1.4)
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread'>('unread');
  const [notifSeverity, setNotifSeverity] = useState<string>('all');

  const fetchNotifs = () => {
    fetch('/api/notifications')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 15000);
    return () => clearInterval(interval);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleMarkRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: 'PUT' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const handleResolve = async (id: string) => {
    await fetch(`/api/notifications/${id}/resolve`, { method: 'PUT' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_resolved: true } : n)));
  };

  const handleMarkAllRead = async () => {
    await fetch('/api/notifications/mark-all-read', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const filteredNotifs = notifications.filter((n) => {
    if (notifFilter === 'unread' && n.is_read) return false;
    if (notifSeverity !== 'all' && n.severity !== notifSeverity) return false;
    return true;
  });

  const navItems = [
    { id: 'dashboard' as PageId, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'products' as PageId, label: 'Prodotti', icon: Package, badge: productsCount },
    { id: 'suppliers' as PageId, label: 'Fornitori', icon: Layers },
    { id: 'listings' as PageId, label: 'Inserzioni', icon: Store, badge: listingsCount },
    { id: 'scraper' as PageId, label: 'Scraper', icon: Globe },
    { id: 'html-import' as PageId, label: 'HTML', icon: Database },
    { id: 'settings' as PageId, label: 'Impostazioni', icon: SettingsIcon },
  ];

  return (
    <>
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setCurrentPage('dashboard')}>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-lg shadow-inner">
              ⚡
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-base sm:text-lg tracking-tight text-slate-100">SinchoDS</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  eBay Dropship
                </span>
              </div>
              <p className="text-[10px] text-slate-400 hidden sm:block">Multi-Supplier &amp; eBay Listing Manager</p>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentPage(item.id)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="ml-1 text-[11px] px-1.5 py-0.2 rounded-full bg-slate-700 text-slate-300">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Status Indicators & Notifications */}
          <div className="flex items-center space-x-2">
            {/* Notifications Bell */}
            <button
              onClick={() => setShowNotifModal(true)}
              className="relative p-1.5 rounded-full bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Price & Stock Monitoring Alerts"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white font-bold text-[9px] flex items-center justify-center animate-pulse">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setCurrentPage('settings')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                isEbayConnected
                  ? 'bg-blue-950/60 text-blue-300 border-blue-800/60'
                  : 'bg-slate-850 text-slate-400 border-slate-700'
              }`}
              title={isEbayConnected ? 'eBay.it Connected' : 'eBay not yet connected'}
            >
              <Store className="w-3 h-3" />
              <span className="hidden sm:inline">{isEbayConnected ? 'eBay Active' : 'eBay Draft'}</span>
              <span className="sm:hidden">eBay</span>
            </button>

            <button
              onClick={() => setCurrentPage('settings')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                isSupabaseConnected
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                  : 'bg-amber-950/60 text-amber-300 border-amber-800/60'
              }`}
            >
              <Database className="w-3 h-3" />
              <span className="hidden sm:inline">
                {isSupabaseConnected ? 'Cloud' : 'Local'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Notifications Slide-Over / Popover Modal */}
      {showNotifModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/60 p-3 sm:p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl overflow-hidden mt-12 sm:mt-14">
            {/* Header */}
            <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Bell className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">Monitoring Alerts</h3>
                {unreadCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">
                    {unreadCount} unread
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-[11px] text-slate-400 hover:text-emerald-400 transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setShowNotifModal(false)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="px-3.5 py-2 bg-slate-950/50 border-b border-slate-800 flex items-center justify-between text-xs gap-2">
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setNotifFilter('unread')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                    notifFilter === 'unread' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Unread
                </button>
                <button
                  onClick={() => setNotifFilter('all')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                    notifFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({notifications.length})
                </button>
              </div>

              <select
                value={notifSeverity}
                onChange={(e) => setNotifSeverity(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-[11px] text-white outline-none"
              >
                <option value="all">All Severities</option>
                <option value="error">Critical / Error</option>
                <option value="warning">Warnings</option>
                <option value="info">Info</option>
              </select>
            </div>

            {/* List */}
            <div className="p-3 overflow-y-auto space-y-2.5 flex-1 text-xs">
              {filteredNotifs.length === 0 ? (
                <div className="p-8 text-center text-slate-500 space-y-2">
                  <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500/60" />
                  <p>No {notifFilter === 'unread' ? 'unread ' : ''}notifications at this time.</p>
                </div>
              ) : (
                filteredNotifs.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-xl border transition-all ${
                      n.is_resolved
                        ? 'opacity-60 bg-slate-950/60 border-slate-850'
                        : !n.is_read
                        ? 'bg-slate-950 border-slate-700 shadow-sm ring-1 ring-emerald-500/20'
                        : 'bg-slate-950/80 border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start space-x-2">
                        {n.severity === 'error' ? (
                          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        ) : n.severity === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <h4 className="font-bold text-white text-xs">{n.title}</h4>
                          <p className="text-slate-300 text-[11px] mt-0.5 leading-relaxed">{n.message}</p>
                          <span className="text-[10px] text-slate-500 mt-1 block">
                            {new Date(n.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end space-y-1 flex-shrink-0">
                        {!n.is_read && (
                          <button
                            onClick={() => handleMarkRead(n.id)}
                            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white text-[10px]"
                            title="Mark as read"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        )}
                        {!n.is_resolved && (
                          <button
                            onClick={() => handleResolve(n.id)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-emerald-950 hover:text-emerald-400 text-slate-400"
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar (iPhone-First) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 pb-[env(safe-area-inset-bottom,8px)] pt-2 px-2">
        <div className="grid grid-cols-7 gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentPage(item.id)}
                className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all relative ${
                  isActive
                    ? 'text-emerald-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 active:scale-95'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-4 h-4 ${isActive ? 'stroke-[2.5px]' : 'stroke-[1.8px]'}`} />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute -top-1 -right-2 text-[8px] bg-emerald-500 text-slate-950 font-bold px-1 rounded-full min-w-3 h-3 flex items-center justify-center">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[9px] mt-1 tracking-tight truncate max-w-full">{item.label}</span>
                {isActive && (
                  <span className="w-1 h-1 rounded-full bg-emerald-400 mt-0.5 absolute bottom-0.5" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
