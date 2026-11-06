import React, { useState, useMemo } from 'react';
import {
  Order,
  OrderLineItem,
  OrderStatus,
  SupplierPurchasingStatus,
  DeliveryStatus,
  ReturnStatus,
  Product,
  Supplier,
} from '../types.js';
import {
  calculateOrderFinancials,
  DEFAULT_PRICING_RULE,
} from '../utils/pricing.js';
import {
  ShoppingBag,
  Plus,
  Search,
  Filter,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  XCircle,
  Package,
  DollarSign,
  TrendingUp,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  User,
  MapPin,
  Calendar,
  Send,
  CreditCard,
  Edit,
  Trash2,
  X,
  RefreshCw,
  Eye,
  Info,
} from 'lucide-react';

interface OrdersProps {
  orders: Order[];
  products: Product[];
  suppliers: Supplier[];
  onSaveOrder: (order: Partial<Order>) => Promise<{ ok: boolean; order?: Order; error?: string }>;
  onCancelOrder: (id: string, reason: string) => Promise<{ ok: boolean; order?: Order; error?: string }>;
  onUpdateFulfillment: (id: string, fulfillment: any) => Promise<{ ok: boolean; order?: Order; error?: string }>;
  onUpdateSupplierPurchase: (id: string, supplierData: any) => Promise<{ ok: boolean; order?: Order; error?: string }>;
  onRecordReturn: (id: string, returnData: any) => Promise<{ ok: boolean; order?: Order; error?: string }>;
  onRecordRefund: (id: string, refundData: any) => Promise<{ ok: boolean; order?: Order; error?: string }>;
  onDeleteOrder: (id: string) => Promise<boolean>;
  initialFilterStatus?: string;
}

export const Orders: React.FC<OrdersProps> = ({
  orders,
  products,
  suppliers,
  onSaveOrder,
  onCancelOrder,
  onUpdateFulfillment,
  onUpdateSupplierPurchase,
  onRecordReturn,
  onRecordRefund,
  onDeleteOrder,
  initialFilterStatus,
}) => {
  // Filter states
  const [filterStatus, setFilterStatus] = useState<string>(initialFilterStatus || 'all');
  const [filterSupplier, setFilterSupplier] = useState<string>('all');
  const [filterDelivery, setFilterDelivery] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);

  // Action sub-modals
  const [fulfillmentOrder, setFulfillmentOrder] = useState<Order | null>(null);
  const [supplierOrderModal, setSupplierOrderModal] = useState<Order | null>(null);
  const [returnRefundOrder, setReturnRefundOrder] = useState<Order | null>(null);
  const [cancelOrderModal, setCancelOrderModal] = useState<Order | null>(null);

  // Form states for modals
  const [cancelReason, setCancelReason] = useState<string>('Richiesta annullamento cliente');

  // Fulfillment form
  const [fulfillmentCarrier, setFulfillmentCarrier] = useState<string>('GLS');
  const [fulfillmentTracking, setFulfillmentTracking] = useState<string>('');
  const [fulfillmentUrl, setFulfillmentUrl] = useState<string>('');
  const [fulfillmentStatus, setFulfillmentStatus] = useState<DeliveryStatus>('in_transit');

  // Supplier purchase form
  const [supOrderRef, setSupOrderRef] = useState<string>('');
  const [supStatus, setSupStatus] = useState<SupplierPurchasingStatus>('ordered');
  const [supShippingCost, setSupShippingCost] = useState<number>(0);
  const [supNotes, setSupNotes] = useState<string>('');

  // Return & Refund form
  const [returnStatusVal, setReturnStatusVal] = useState<ReturnStatus>('requested');
  const [returnReasonVal, setReturnReasonVal] = useState<string>('Prodotto non conforme o reso cliente');
  const [refundAmountVal, setRefundAmountVal] = useState<number>(0);
  const [refundReasonVal, setRefundReasonVal] = useState<string>('Rimborso per reso');

  // New Order Line Items Form State
  const [orderBuyerName, setOrderBuyerName] = useState<string>('');
  const [orderBuyerEmail, setOrderBuyerEmail] = useState<string>('');
  const [orderBuyerPhone, setOrderBuyerPhone] = useState<string>('');
  const [orderExternalId, setOrderExternalId] = useState<string>('');
  const [orderBuyerAddress, setOrderBuyerAddress] = useState({
    name: '',
    address_line1: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: 'Italia',
  });
  const [orderBuyerShippingFee, setOrderBuyerShippingFee] = useState<number>(0);
  const [orderSupplierShippingCost, setOrderSupplierShippingCost] = useState<number>(0);
  const [orderPackagingCost, setOrderPackagingCost] = useState<number>(0);
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [orderItems, setOrderItems] = useState<OrderLineItem[]>([
    {
      id: 'item-1',
      title: '',
      quantity: 1,
      purchase_cost: 0,
      selling_price: 0,
      supplier_id: 'pluspower',
      supplier_name: 'PlusPower Supplements',
    },
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Compute Summary Statistics
  const stats = useMemo(() => {
    let pending = 0;
    let awaitingPurchase = 0;
    let awaitingDispatch = 0;
    let shipped = 0;
    let delivered = 0;
    let returned = 0;
    let cancelled = 0;
    let totalRev = 0;
    let totalCost = 0;
    let totalProfit = 0;

    for (const o of orders) {
      totalRev += Number(o.total_paid) || 0;
      totalCost += Number(o.total_cost) || 0;
      totalProfit += Number(o.net_profit) || 0;

      switch (o.status) {
        case 'pending':
        case 'pending_fulfillment':
          pending++;
          break;
        case 'awaiting_purchase':
          awaitingPurchase++;
          break;
        case 'purchased':
          awaitingDispatch++;
          break;
        case 'shipped':
          shipped++;
          break;
        case 'delivered':
        case 'fulfilled':
          delivered++;
          break;
        case 'returned':
          returned++;
          break;
        case 'cancelled':
          cancelled++;
          break;
        default:
          pending++;
          break;
      }
    }

    return {
      total: orders.length,
      pending,
      awaitingPurchase,
      awaitingDispatch,
      shipped,
      delivered,
      returned,
      cancelled,
      totalRevenue: Math.round(totalRev * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      avgMargin: totalRev > 0 ? Math.round((totalProfit / totalRev) * 1000) / 10 : 0,
    };
  }, [orders]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Status filter
      if (filterStatus !== 'all') {
        if (filterStatus === 'pending' && order.status !== 'pending' && order.status !== 'pending_fulfillment') return false;
        if (filterStatus === 'awaiting_purchase' && order.status !== 'awaiting_purchase') return false;
        if (filterStatus === 'purchased' && order.status !== 'purchased') return false;
        if (filterStatus === 'shipped' && order.status !== 'shipped') return false;
        if (filterStatus === 'delivered' && order.status !== 'delivered' && order.status !== 'fulfilled') return false;
        if (filterStatus === 'returned' && order.status !== 'returned') return false;
        if (filterStatus === 'cancelled' && order.status !== 'cancelled') return false;
      }

      // Supplier filter
      if (filterSupplier !== 'all') {
        const matchesSupplier =
          order.supplier_id === filterSupplier ||
          order.items?.some((i) => i.supplier_id === filterSupplier);
        if (!matchesSupplier) return false;
      }

      // Delivery status filter
      if (filterDelivery !== 'all') {
        if (order.delivery_status !== filterDelivery) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchNum = order.order_number?.toLowerCase().includes(q);
        const matchExt = order.external_order_id?.toLowerCase().includes(q);
        const matchBuyer = (
          (order.buyer_name || '') +
          ' ' +
          (order.buyer_username || '') +
          ' ' +
          (order.buyer_email || '')
        ).toLowerCase().includes(q);
        const matchTrack = order.tracking_number?.toLowerCase().includes(q);
        const matchSupRef = order.supplier_order_reference?.toLowerCase().includes(q);
        const matchItems = order.items?.some(
          (i) =>
            i.title?.toLowerCase().includes(q) ||
            i.sku?.toLowerCase().includes(q) ||
            i.variant_name?.toLowerCase().includes(q)
        );

        if (!matchNum && !matchExt && !matchBuyer && !matchTrack && !matchSupRef && !matchItems) {
          return false;
        }
      }

      return true;
    });
  }, [orders, filterStatus, filterSupplier, filterDelivery, searchQuery]);

  // Live financials calculation for the creation modal
  const liveFormFinancials = useMemo(() => {
    return calculateOrderFinancials(orderItems, {
      shippingChargedToBuyer: orderBuyerShippingFee,
      supplierShippingCost: orderSupplierShippingCost,
      packagingCost: orderPackagingCost,
    });
  }, [orderItems, orderBuyerShippingFee, orderSupplierShippingCost, orderPackagingCost]);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingOrder(null);
    setOrderBuyerName('');
    setOrderBuyerEmail('');
    setOrderBuyerPhone('');
    setOrderExternalId('');
    setOrderBuyerAddress({
      name: '',
      address_line1: '',
      city: '',
      state_province: '',
      postal_code: '',
      country: 'Italia',
    });
    setOrderBuyerShippingFee(0);
    setOrderSupplierShippingCost(0);
    setOrderPackagingCost(0);
    setOrderNotes('');
    setOrderItems([
      {
        id: `item-${Date.now()}-1`,
        title: products[0]?.title || 'Prodotto da ordinare',
        variant_name: products[0]?.variants?.[0]?.name || '',
        sku: products[0]?.variants?.[0]?.sku || products[0]?.sku || 'SKU-001',
        ean: products[0]?.variants?.[0]?.ean || products[0]?.ean || '',
        quantity: 1,
        purchase_cost: Number(products[0]?.price) || 25,
        selling_price: Math.round((Number(products[0]?.price) || 25) * 1.35 * 100) / 100,
        supplier_id: products[0]?.supplier_id || 'pluspower',
        supplier_name: products[0]?.supplier_name || 'PlusPower Supplements',
      },
    ]);
    setFormError(null);
    setShowCreateModal(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (order: Order) => {
    setEditingOrder(order);
    setOrderBuyerName(order.buyer_name || order.buyer_username || '');
    setOrderBuyerEmail(order.buyer_email || '');
    setOrderBuyerPhone(order.buyer_phone || '');
    setOrderExternalId(order.external_order_id || '');
    setOrderBuyerAddress({
      name: order.shipping_address?.name || order.buyer_name || '',
      address_line1: order.shipping_address?.address_line1 || '',
      city: order.shipping_address?.city || '',
      state_province: order.shipping_address?.state_province || '',
      postal_code: order.shipping_address?.postal_code || '',
      country: order.shipping_address?.country || 'Italia',
    });
    setOrderBuyerShippingFee(order.shipping_charged_to_buyer || 0);
    setOrderSupplierShippingCost(order.supplier_shipping_cost || 0);
    setOrderPackagingCost(order.packaging_cost || 0);
    setOrderNotes(order.notes || '');
    setOrderItems(
      order.items && order.items.length > 0
        ? order.items.map((i) => ({ ...i }))
        : [
            {
              id: 'item-1',
              title: 'Articolo',
              quantity: 1,
              purchase_cost: 10,
              selling_price: 15,
            },
          ]
    );
    setFormError(null);
    setShowCreateModal(true);
  };

  // Add Item Line
  const handleAddLineItem = () => {
    const newItem: OrderLineItem = {
      id: `item-${Date.now()}-${orderItems.length + 1}`,
      title: '',
      quantity: 1,
      purchase_cost: 0,
      selling_price: 0,
      supplier_id: 'pluspower',
      supplier_name: 'PlusPower Supplements',
    };
    setOrderItems([...orderItems, newItem]);
  };

  // Update Item Line
  const handleUpdateLineItem = (index: number, updates: Partial<OrderLineItem>) => {
    const updated = [...orderItems];
    updated[index] = { ...updated[index], ...updates };
    setOrderItems(updated);
  };

  // Select Catalog Product for a Line Item
  const handleSelectCatalogProduct = (index: number, productId: string) => {
    const p = products.find((prod) => prod.id === productId);
    if (!p) return;

    const variant = p.variants?.[0];
    const cost = Number(variant?.price ?? p.price) || 0;
    const sell = Math.round(cost * 1.35 * 100) / 100;

    handleUpdateLineItem(index, {
      product_id: p.id,
      variant_id: variant?.id || null,
      title: p.title,
      variant_name: variant?.name || '',
      sku: variant?.sku || p.sku || '',
      ean: variant?.ean || p.ean || '',
      purchase_cost: cost,
      selling_price: sell,
      supplier_id: p.supplier_id || 'pluspower',
      supplier_name: p.supplier_name || 'PlusPower Supplements',
      supplier_url: p.url,
    });
  };

  // Remove Item Line
  const handleRemoveLineItem = (index: number) => {
    if (orderItems.length <= 1) return;
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  // Submit Order Creation / Update
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!orderBuyerName.trim()) {
      setFormError("Inserisci il nome dell'acquirente.");
      return;
    }

    if (orderItems.length === 0 || orderItems.some((i) => !i.title.trim())) {
      setFormError('Ogni riga ordine deve avere un titolo di prodotto.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Partial<Order> = {
        id: editingOrder?.id,
        order_number: editingOrder?.order_number,
        external_order_id: orderExternalId.trim() || null,
        order_source: 'manual',
        buyer_name: orderBuyerName.trim(),
        buyer_username: orderBuyerName.trim().toLowerCase().replace(/\s+/g, '_'),
        buyer_email: orderBuyerEmail.trim(),
        buyer_phone: orderBuyerPhone.trim(),
        shipping_address: {
          name: orderBuyerAddress.name || orderBuyerName.trim(),
          address_line1: orderBuyerAddress.address_line1.trim(),
          city: orderBuyerAddress.city.trim(),
          state_province: orderBuyerAddress.state_province.trim(),
          postal_code: orderBuyerAddress.postal_code.trim(),
          country: orderBuyerAddress.country.trim() || 'Italia',
        },
        status: editingOrder ? editingOrder.status : 'awaiting_purchase',
        items: orderItems,
        shipping_charged_to_buyer: orderBuyerShippingFee,
        supplier_shipping_cost: orderSupplierShippingCost,
        packaging_cost: orderPackagingCost,
        currency: 'EUR',
        notes: orderNotes.trim() || null,
      };

      const res = await onSaveOrder(payload);
      if (!res.ok) {
        setFormError(res.error || 'Errore nel salvataggio dell’ordine');
        setIsSubmitting(false);
        return;
      }

      setShowCreateModal(false);
      setEditingOrder(null);
    } catch (err: any) {
      setFormError(err.message || 'Errore imprevisto');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Fulfillment Modal
  const handleOpenFulfillment = (order: Order) => {
    setFulfillmentOrder(order);
    setFulfillmentCarrier(order.carrier || 'GLS');
    setFulfillmentTracking(order.tracking_number || '');
    setFulfillmentUrl(order.tracking_url || '');
    setFulfillmentStatus(order.delivery_status || 'in_transit');
  };

  // Submit Fulfillment
  const handleSubmitFulfillment = async () => {
    if (!fulfillmentOrder) return;
    setIsSubmitting(true);
    try {
      const res = await onUpdateFulfillment(fulfillmentOrder.id, {
        carrier: fulfillmentCarrier,
        tracking_number: fulfillmentTracking.trim(),
        tracking_url: fulfillmentUrl.trim() || undefined,
        delivery_status: fulfillmentStatus,
        dispatched_at: fulfillmentTracking.trim() ? new Date().toISOString() : undefined,
      });
      if (res.ok) {
        setFulfillmentOrder(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Supplier Purchase Modal
  const handleOpenSupplierModal = (order: Order) => {
    setSupplierOrderModal(order);
    setSupOrderRef(order.supplier_order_reference || '');
    setSupStatus(order.supplier_purchasing_status || 'ordered');
    setSupShippingCost(order.supplier_shipping_cost || 0);
    setSupNotes(order.supplier_notes || '');
  };

  // Submit Supplier Purchase
  const handleSubmitSupplierPurchase = async () => {
    if (!supplierOrderModal) return;
    setIsSubmitting(true);
    try {
      const res = await onUpdateSupplierPurchase(supplierOrderModal.id, {
        supplier_order_reference: supOrderRef.trim(),
        supplier_purchasing_status: supStatus,
        supplier_shipping_cost: supShippingCost,
        supplier_notes: supNotes.trim() || undefined,
        supplier_purchased_at: new Date().toISOString(),
      });
      if (res.ok) {
        setSupplierOrderModal(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Return / Refund Modal
  const handleOpenReturnRefund = (order: Order) => {
    setReturnRefundOrder(order);
    setReturnStatusVal(order.return_status && order.return_status !== 'none' ? order.return_status : 'requested');
    setReturnReasonVal(order.return_reason || '');
    setRefundAmountVal(0);
    setRefundReasonVal('Rimborso reso cliente');
  };

  // Submit Return
  const handleSubmitReturn = async () => {
    if (!returnRefundOrder) return;
    setIsSubmitting(true);
    try {
      await onRecordReturn(returnRefundOrder.id, {
        return_status: returnStatusVal,
        return_reason: returnReasonVal,
        returned_at: new Date().toISOString(),
      });
      if (refundAmountVal > 0) {
        await onRecordRefund(returnRefundOrder.id, {
          amount: refundAmountVal,
          reason: refundReasonVal,
          refunded_at: new Date().toISOString(),
        });
      }
      setReturnRefundOrder(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Cancel
  const handleSubmitCancel = async () => {
    if (!cancelOrderModal) return;
    setIsSubmitting(true);
    try {
      const res = await onCancelOrder(cancelOrderModal.id, cancelReason);
      if (res.ok) {
        setCancelOrderModal(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helpers for Status Badges
  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'pending':
      case 'pending_fulfillment':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3 h-3" />
            <span>In Attesa</span>
          </span>
        );
      case 'awaiting_purchase':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <ShoppingBag className="w-3 h-3" />
            <span>Da Ordinare</span>
          </span>
        );
      case 'purchased':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Package className="w-3 h-3" />
            <span>Acquistato / Da Spedire</span>
          </span>
        );
      case 'shipped':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Truck className="w-3 h-3" />
            <span>Spedito</span>
          </span>
        );
      case 'delivered':
      case 'fulfilled':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            <span>Consegnato</span>
          </span>
        );
      case 'returned':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <RotateCcw className="w-3 h-3" />
            <span>Reso</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <XCircle className="w-3 h-3" />
            <span>Annullato</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300">
            <span>{status}</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8 animate-in fade-in">
      {/* Top Banner / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-sm">
        <div>
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Gestione Ordini &amp; Fulfillment
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
            Elaborazione ordini dropshipping multi-fornitore, tracciamento spedizioni, calcolo utile netto e gestione resi con isolamento di workspace.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="flex items-center justify-center space-x-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium text-sm transition-all shadow-md active:scale-95 flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Nuovo Ordine</span>
        </button>
      </div>

      {/* Financial & Status Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 sm:gap-3">
        <button
          onClick={() => setFilterStatus('all')}
          className={`p-3 rounded-xl border text-left transition-all ${
            filterStatus === 'all'
              ? 'bg-slate-800/90 border-slate-700 ring-1 ring-slate-600'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Tutti</span>
            <ShoppingBag className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <p className="text-lg font-bold text-white mt-1">{stats.total}</p>
        </button>

        <button
          onClick={() => setFilterStatus('pending')}
          className={`p-3 rounded-xl border text-left transition-all ${
            filterStatus === 'pending'
              ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-amber-400">In Attesa</span>
            <Clock className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <p className="text-lg font-bold text-amber-300 mt-1">{stats.pending}</p>
        </button>

        <button
          onClick={() => setFilterStatus('awaiting_purchase')}
          className={`p-3 rounded-xl border text-left transition-all ${
            filterStatus === 'awaiting_purchase'
              ? 'bg-purple-500/10 border-purple-500/40 ring-1 ring-purple-500/30'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-purple-400">Da Ordinare</span>
            <Package className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <p className="text-lg font-bold text-purple-300 mt-1">{stats.awaitingPurchase}</p>
        </button>

        <button
          onClick={() => setFilterStatus('purchased')}
          className={`p-3 rounded-xl border text-left transition-all ${
            filterStatus === 'purchased'
              ? 'bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/30'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-blue-400">Da Spedire</span>
            <Truck className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <p className="text-lg font-bold text-blue-300 mt-1">{stats.awaitingDispatch}</p>
        </button>

        <button
          onClick={() => setFilterStatus('shipped')}
          className={`p-3 rounded-xl border text-left transition-all ${
            filterStatus === 'shipped'
              ? 'bg-cyan-500/10 border-cyan-500/40 ring-1 ring-cyan-500/30'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-cyan-400">Spediti</span>
            <Truck className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <p className="text-lg font-bold text-cyan-300 mt-1">{stats.shipped}</p>
        </button>

        <button
          onClick={() => setFilterStatus('delivered')}
          className={`p-3 rounded-xl border text-left transition-all ${
            filterStatus === 'delivered'
              ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/30'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-emerald-400">Consegnati</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-lg font-bold text-emerald-300 mt-1">{stats.delivered}</p>
        </button>

        <button
          onClick={() => setFilterStatus('returned')}
          className={`p-3 rounded-xl border text-left transition-all ${
            filterStatus === 'returned'
              ? 'bg-rose-500/10 border-rose-500/40 ring-1 ring-rose-500/30'
              : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-rose-400">Resi</span>
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <p className="text-lg font-bold text-rose-300 mt-1">{stats.returned}</p>
        </button>
      </div>

      {/* Financial Summary Highlight Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs sm:text-sm">
        <div>
          <span className="text-slate-400 text-[11px] block">Fatturato Ordini</span>
          <span className="text-base sm:text-lg font-bold text-white">€{stats.totalRevenue.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-slate-400 text-[11px] block">Costo Fornitori & Spedizioni</span>
          <span className="text-base sm:text-lg font-bold text-slate-300">€{stats.totalCost.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-slate-400 text-[11px] block">Utile Netto Calcolato</span>
          <span
            className={`text-base sm:text-lg font-bold ${
              stats.totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            €{stats.totalProfit.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-slate-400 text-[11px] block">Margine Medio Netto</span>
          <span className="text-base sm:text-lg font-bold text-blue-400">{stats.avgMargin}%</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca per acquirente, n° ordine, tracking, fornitore, SKU..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Supplier filter */}
          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-300 outline-none focus:border-emerald-500"
          >
            <option value="all">Tutti i Fornitori</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Delivery status filter */}
          <select
            value={filterDelivery}
            onChange={(e) => setFilterDelivery(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-300 outline-none focus:border-emerald-500"
          >
            <option value="all">Stato Spedizione (Tutti)</option>
            <option value="unfulfilled">Da Spedire</option>
            <option value="in_transit">In Transito</option>
            <option value="delivered">Consegnati</option>
            <option value="failed_delivery">Mancata Consegna</option>
            <option value="returned">Reso al Mittente</option>
          </select>

          {(filterStatus !== 'all' || filterSupplier !== 'all' || filterDelivery !== 'all' || searchQuery) && (
            <button
              onClick={() => {
                setFilterStatus('all');
                setFilterSupplier('all');
                setFilterDelivery('all');
                setSearchQuery('');
              }}
              className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Reset Filtri
            </button>
          )}
        </div>
      </div>

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
          <ShoppingBag className="w-12 h-12 mx-auto text-slate-600" />
          <h3 className="text-base font-bold text-white">Nessun ordine trovato</h3>
          <p className="text-xs max-w-sm mx-auto">
            Non ci sono ordini corrispondenti ai filtri correnti. Crea un nuovo ordine manuale per iniziare la gestione.
          </p>
          <button
            onClick={handleOpenCreateModal}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            <span>Crea Primo Ordine</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const itemCount = order.items?.reduce((acc, i) => acc + (i.quantity || 1), 0) || 0;
            const netProfit = Number(order.net_profit) || 0;

            return (
              <div
                key={order.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 sm:p-5 shadow-sm transition-all space-y-4"
              >
                {/* Header row: Order #, source, external id, status badges */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-800 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-white text-sm sm:text-base">
                      {order.order_number || `#ORD-${order.id.slice(0, 8).toUpperCase()}`}
                    </span>

                    {order.external_order_id && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                        Ext: {order.external_order_id}
                      </span>
                    )}

                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      {order.order_source === 'manual' ? 'Manuale' : 'eBay Sync'}
                    </span>

                    <span className="text-xs text-slate-500">
                      {new Date(order.created_at).toLocaleString('it-IT')}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    {getStatusBadge(order.status)}

                    {/* Supplier Purchasing status badge */}
                    {order.supplier_purchasing_status === 'ordered' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        Ordinato al Fornitore
                      </span>
                    )}
                    {order.supplier_purchasing_status === 'confirmed' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        Confermato da Fornitore
                      </span>
                    )}
                  </div>
                </div>

                {/* Content grid: Buyer info, Items summary, Financials */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  {/* Column 1: Buyer Info */}
                  <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3 space-y-2">
                    <div className="flex items-center space-x-1.5 text-slate-400 font-semibold text-[11px]">
                      <User className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Destinatario &amp; Acquirente</span>
                    </div>
                    <div>
                      <p className="font-bold text-white text-xs">{order.buyer_name || 'Acquirente Privato'}</p>
                      {order.buyer_email && (
                        <p className="text-slate-400 text-[11px] truncate">{order.buyer_email}</p>
                      )}
                      {order.buyer_phone && (
                        <p className="text-slate-400 text-[11px]">{order.buyer_phone}</p>
                      )}
                    </div>
                    {order.shipping_address?.address_line1 && (
                      <div className="text-[11px] text-slate-300 border-t border-slate-850 pt-1.5 flex items-start space-x-1">
                        <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0 mt-0.5" />
                        <span>
                          {order.shipping_address.address_line1},{' '}
                          {order.shipping_address.postal_code} {order.shipping_address.city} (
                          {order.shipping_address.state_province})
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Column 2: Items & Supplier summary */}
                  <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px]">
                      <div className="flex items-center space-x-1.5">
                        <Package className="w-3.5 h-3.5 text-blue-400" />
                        <span>Articoli ({itemCount})</span>
                      </div>
                      <span className="text-[10px] text-slate-500">{order.supplier_name || 'PlusPower'}</span>
                    </div>

                    <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                      {order.items?.map((item, idx) => (
                        <div key={idx} className="flex items-start justify-between gap-2 text-[11px]">
                          <div>
                            <p className="font-medium text-slate-200 line-clamp-1">{item.title}</p>
                            {item.variant_name && (
                              <p className="text-[10px] text-slate-400">Variante: {item.variant_name}</p>
                            )}
                            <p className="text-[10px] text-slate-500">
                              SKU: {item.sku || '-'} &bull; Q.tà: {item.quantity}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="font-semibold text-white">
                              €{((Number(item.selling_price) || 0) * (item.quantity || 1)).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {order.supplier_order_reference && (
                      <div className="border-t border-slate-850 pt-1.5 text-[10px] text-purple-300">
                        Rif. Fornitore: <span className="font-mono font-bold">{order.supplier_order_reference}</span>
                      </div>
                    )}
                  </div>

                  {/* Column 3: Financials & Fulfillment summary */}
                  <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px]">
                      <div className="flex items-center space-x-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Riepilogo Finanziario</span>
                      </div>
                      <span
                        className={`font-bold ${
                          netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        Utile: €{netProfit.toFixed(2)}
                      </span>
                    </div>

                    <div className="space-y-1 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Incasso Totale:</span>
                        <span className="font-bold text-white">€{Number(order.total_paid || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Costo Merci & Sped. Fornitore:</span>
                        <span className="text-slate-300">€{Number(order.total_cost || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Stima Comm. eBay (11.5% + 0.35€):</span>
                        <span className="text-slate-400">€{Number(order.estimated_ebay_fees || 0).toFixed(2)}</span>
                      </div>
                      {Number(order.refund_amount) > 0 && (
                        <div className="flex justify-between text-rose-400">
                          <span>Rimborsi Emessi:</span>
                          <span>-€{Number(order.refund_amount).toFixed(2)}</span>
                        </div>
                      )}
                    </div>

                    {/* Tracking Info if available */}
                    <div className="border-t border-slate-850 pt-1.5 text-[11px]">
                      {order.tracking_number ? (
                        <div className="flex items-center justify-between">
                          <span className="text-cyan-400 font-medium">
                            {order.carrier || 'GLS'}: {order.tracking_number}
                          </span>
                          {order.tracking_url && (
                            <a
                              href={order.tracking_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-400 hover:text-blue-300"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[10px]">Tracking non ancora inserito</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bottom Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <button
                    onClick={() => setDetailOrder(order)}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5 text-blue-400" />
                    <span>Dettagli &amp; Cronologia Eventi ({order.events?.length || 0})</span>
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Supplier Purchase button */}
                    <button
                      onClick={() => handleOpenSupplierModal(order)}
                      className="flex items-center space-x-1 px-2.5 py-1.5 bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 border border-purple-800/60 rounded-lg text-xs font-medium transition-colors"
                    >
                      <Package className="w-3.5 h-3.5" />
                      <span>Fornitore</span>
                    </button>

                    {/* Fulfillment button */}
                    <button
                      onClick={() => handleOpenFulfillment(order)}
                      className="flex items-center space-x-1 px-2.5 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-medium transition-colors"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      <span>Tracking &amp; Spedizione</span>
                    </button>

                    {/* Return / Refund button */}
                    <button
                      onClick={() => handleOpenReturnRefund(order)}
                      className="flex items-center space-x-1 px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs font-medium transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reso / Rimborso</span>
                    </button>

                    {/* Edit button */}
                    <button
                      onClick={() => handleOpenEditModal(order)}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                      title="Modifica Ordine"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>

                    {/* Cancel button */}
                    {order.status !== 'cancelled' && (
                      <button
                        onClick={() => {
                          setCancelOrderModal(order);
                          setCancelReason('Richiesta annullamento cliente');
                        }}
                        className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-lg text-xs"
                        title="Annulla Ordine"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: Nuovo / Modifica Ordine Manuale                                   */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShoppingBag className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base sm:text-lg text-white">
                  {editingOrder ? `Modifica Ordine ${editingOrder.order_number}` : 'Nuovo Ordine Manuale'}
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitOrder} className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs sm:text-sm flex-1">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Section A: Customer Details */}
              <div className="space-y-3">
                <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center space-x-1.5">
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Dati Acquirente &amp; Spedizione</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Nome Completo *</label>
                    <input
                      type="text"
                      required
                      value={orderBuyerName}
                      onChange={(e) => setOrderBuyerName(e.target.value)}
                      placeholder="Mario Rossi"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Email</label>
                    <input
                      type="email"
                      value={orderBuyerEmail}
                      onChange={(e) => setOrderBuyerEmail(e.target.value)}
                      placeholder="mario@esempio.it"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Telefono</label>
                    <input
                      type="tel"
                      value={orderBuyerPhone}
                      onChange={(e) => setOrderBuyerPhone(e.target.value)}
                      placeholder="+39 333 1234567"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-slate-400 block mb-1">Indirizzo di Spedizione</label>
                    <input
                      type="text"
                      value={orderBuyerAddress.address_line1}
                      onChange={(e) =>
                        setOrderBuyerAddress({ ...orderBuyerAddress, address_line1: e.target.value })
                      }
                      placeholder="Via Roma 10"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Città</label>
                    <input
                      type="text"
                      value={orderBuyerAddress.city}
                      onChange={(e) => setOrderBuyerAddress({ ...orderBuyerAddress, city: e.target.value })}
                      placeholder="Milano"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">CAP &amp; Prov</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="text"
                        value={orderBuyerAddress.postal_code}
                        onChange={(e) =>
                          setOrderBuyerAddress({ ...orderBuyerAddress, postal_code: e.target.value })
                        }
                        placeholder="20100"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                      />
                      <input
                        type="text"
                        value={orderBuyerAddress.state_province}
                        onChange={(e) =>
                          setOrderBuyerAddress({ ...orderBuyerAddress, state_province: e.target.value })
                        }
                        placeholder="MI"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    ID Ordine Esterno (Opzionale &bull; Univoco nel workspace)
                  </label>
                  <input
                    type="text"
                    value={orderExternalId}
                    onChange={(e) => setOrderExternalId(e.target.value)}
                    placeholder="Es. EBAY-1234567890 o SYNC-REF-01"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-xs"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Preparato per sincronizzazione API futura. Se compilato, non deve essere duplicato in questo workspace.
                  </p>
                </div>
              </div>

              {/* Section B: Line Items */}
              <div className="space-y-3 border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center space-x-1.5">
                    <Package className="w-3.5 h-3.5 text-blue-400" />
                    <span>Righe Ordine (Multi-Item &amp; Varianti)</span>
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg text-xs font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Aggiungi Riga</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {orderItems.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-400">Articolo #{idx + 1}</span>
                        {orderItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveLineItem(idx)}
                            className="p-1 text-slate-500 hover:text-rose-400"
                            title="Rimuovi riga"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Select product from catalog shortcut */}
                      {products.length > 0 && (
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">
                            Carica da catalogo prodotti (compila costi &amp; prezzi suggeriti):
                          </label>
                          <select
                            onChange={(e) => handleSelectCatalogProduct(idx, e.target.value)}
                            defaultValue=""
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-slate-300"
                          >
                            <option value="" disabled>
                              -- Seleziona un prodotto dal catalogo --
                            </option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title} ({p.supplier_name || 'PlusPower'}) - €{Number(p.price).toFixed(2)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="sm:col-span-2">
                          <label className="text-[11px] text-slate-400 block mb-0.5">Titolo Prodotto *</label>
                          <input
                            type="text"
                            required
                            value={item.title}
                            onChange={(e) => handleUpdateLineItem(idx, { title: e.target.value })}
                            placeholder="Es. 100% Hydro Isolate 2kg"
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-0.5">Variante / Gusto</label>
                          <input
                            type="text"
                            value={item.variant_name || ''}
                            onChange={(e) => handleUpdateLineItem(idx, { variant_name: e.target.value })}
                            placeholder="Es. Cioccolato Belga"
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white text-xs"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-0.5">SKU</label>
                          <input
                            type="text"
                            value={item.sku || ''}
                            onChange={(e) => handleUpdateLineItem(idx, { sku: e.target.value })}
                            placeholder="YAM-HYDRO-01"
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-0.5">Quantità *</label>
                          <input
                            type="number"
                            min="1"
                            required
                            value={item.quantity}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white text-xs font-semibold"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-0.5">Costo Unit. Fornitore (€) *</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            value={item.purchase_cost}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, {
                                purchase_cost: Math.max(0, parseFloat(e.target.value) || 0),
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white text-xs font-semibold"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-emerald-400 block mb-0.5">Prezzo Vendita Unit. (€) *</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            value={item.selling_price}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, {
                                selling_price: Math.max(0, parseFloat(e.target.value) || 0),
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-emerald-400 text-xs font-bold"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section C: Additional Shipping & Packaging Costs */}
              <div className="space-y-3 border-t border-slate-800 pt-4">
                <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center space-x-1.5">
                  <Truck className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Costi Spedizione &amp; Imballaggio</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Spedizione addebitata al cliente (€)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={orderBuyerShippingFee}
                      onChange={(e) => setOrderBuyerShippingFee(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Costo Spedizione Fornitore (€)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={orderSupplierShippingCost}
                      onChange={(e) => setOrderSupplierShippingCost(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Costo Imballo Extra (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={orderPackagingCost}
                      onChange={(e) => setOrderPackagingCost(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Note Ordine (Opzionale)</label>
                  <textarea
                    rows={2}
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Note interne o istruzioni speciali per la spedizione..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                  />
                </div>
              </div>

              {/* Section D: Live Calculated Preview */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span>Anteprima Finanziaria Calcolata in Tempo Reale:</span>
                  <span
                    className={`font-bold ${
                      liveFormFinancials.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    Utile Netto Stimato: €{liveFormFinancials.netProfit.toFixed(2)} ({liveFormFinancials.profitMargin}%)
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500 block">Totale Vendita:</span>
                    <span className="font-bold text-white">€{liveFormFinancials.totalRevenue.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Costo Totale Fornitori:</span>
                    <span className="text-slate-300 font-medium">€{liveFormFinancials.totalCost.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Comm. eBay Stimate:</span>
                    <span className="text-slate-400 font-medium">€{liveFormFinancials.estimatedEbayFees.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Margine Percentuale:</span>
                    <span className="font-bold text-blue-400">{liveFormFinancials.profitMargin}%</span>
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold shadow-md"
                >
                  {isSubmitting ? 'Salvataggio...' : editingOrder ? 'Salva Modifiche' : 'Conferma Ordine'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: Dettagli Ordine & Cronologia Eventi Completa                     */}
      {/* ========================================================================= */}
      {detailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            <div className="p-4 sm:p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="font-bold text-base text-white">
                    Ordine {detailOrder.order_number || detailOrder.id}
                  </h3>
                  <span className="text-xs text-slate-400">
                    Creato il {new Date(detailOrder.created_at).toLocaleString('it-IT')}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setDetailOrder(null)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs sm:text-sm flex-1">
              {/* Financial Summary Box */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center border-b border-slate-850 pb-2">
                  <span className="font-bold text-slate-300">Stato Ordine:</span>
                  <div>{getStatusBadge(detailOrder.status)}</div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Totale Vendita</span>
                    <span className="font-bold text-white text-sm">€{Number(detailOrder.total_paid || 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Costo Fornitore</span>
                    <span className="font-bold text-slate-300 text-sm">€{Number(detailOrder.total_cost || 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Stima Comm. eBay</span>
                    <span className="font-bold text-slate-400 text-sm">€{Number(detailOrder.estimated_ebay_fees || 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Utile Netto</span>
                    <span
                      className={`font-bold text-sm ${
                        Number(detailOrder.net_profit) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      €{Number(detailOrder.net_profit || 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                {Number(detailOrder.refund_amount) > 0 && (
                  <div className="text-rose-400 text-xs border-t border-slate-850 pt-2 flex justify-between">
                    <span>Rimborsi Totali Emessi:</span>
                    <span className="font-bold">-€{Number(detailOrder.refund_amount).toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider">
                  Dettaglio Articoli Ordinati ({detailOrder.items?.length || 0})
                </h4>
                <div className="space-y-2">
                  {detailOrder.items?.map((item, i) => (
                    <div
                      key={item.id || i}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-bold text-white">{item.title}</p>
                        {item.variant_name && <p className="text-slate-400">Variante: {item.variant_name}</p>}
                        <p className="text-[11px] text-slate-500">
                          SKU: {item.sku || '-'} &bull; Q.tà: {item.quantity} &bull; Fornitore:{' '}
                          {item.supplier_name || detailOrder.supplier_name || 'PlusPower'}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-emerald-400 text-sm">
                          €{((Number(item.selling_price) || 0) * (item.quantity || 1)).toFixed(2)}
                        </span>
                        <p className="text-[10px] text-slate-500">
                          Costo: €{((Number(item.purchase_cost) || 0) * (item.quantity || 1)).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Event Timeline (Audit History) */}
              <div className="space-y-2 border-t border-slate-800 pt-4">
                <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-400" />
                  <span>Cronologia Eventi &amp; Audit Trail</span>
                </h4>

                <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                  {!detailOrder.events || detailOrder.events.length === 0 ? (
                    <p className="text-xs text-slate-500">Nessun evento registrato per questo ordine.</p>
                  ) : (
                    detailOrder.events.map((evt, idx) => (
                      <div
                        key={evt.id || idx}
                        className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-850 flex items-start space-x-3 text-xs"
                      >
                        <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-200">{evt.description}</span>
                            <span className="text-[10px] text-slate-500">
                              {new Date(evt.timestamp).toLocaleString('it-IT')}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400">Autore: {evt.actor || 'system'}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setDetailOrder(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: Aggiorna Acquisto da Fornitore                                   */}
      {/* ========================================================================= */}
      {supplierOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Package className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-sm text-white">Aggiorna Acquisto Fornitore</h3>
              </div>
              <button
                onClick={() => setSupplierOrderModal(null)}
                className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Riferimento Ordine Fornitore (ID / Fattura) *</label>
                <input
                  type="text"
                  required
                  value={supOrderRef}
                  onChange={(e) => setSupOrderRef(e.target.value)}
                  placeholder="Es. PP-2026-9812 o ORD-SUP-44"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Stato Acquisto Fornitore</label>
                <select
                  value={supStatus}
                  onChange={(e) => setSupStatus(e.target.value as SupplierPurchasingStatus)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                >
                  <option value="ordered">Ordinato (In elaborazione fornitore)</option>
                  <option value="confirmed">Confermato dal Fornitore</option>
                  <option value="failed">Problema / Fallito</option>
                  <option value="not_purchased">Non ancora acquistato</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Costo Spedizione Fornitore Effettivo (€)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={supShippingCost}
                  onChange={(e) => setSupShippingCost(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Note Fornitore</label>
                <textarea
                  rows={2}
                  value={supNotes}
                  onChange={(e) => setSupNotes(e.target.value)}
                  placeholder="Eventuali comunicazioni o codici fornitore..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSupplierOrderModal(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSubmitSupplierPurchase}
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs shadow-md"
              >
                {isSubmitting ? 'Salvataggio...' : 'Conferma Acquisto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: Aggiorna Spedizione & Tracking Manuale                           */}
      {/* ========================================================================= */}
      {fulfillmentOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Truck className="w-4 h-4 text-cyan-400" />
                <h3 className="font-bold text-sm text-white">Aggiorna Tracking &amp; Spedizione</h3>
              </div>
              <button
                onClick={() => setFulfillmentOrder(null)}
                className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Corriere</label>
                <select
                  value={fulfillmentCarrier}
                  onChange={(e) => setFulfillmentCarrier(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                >
                  <option value="GLS">GLS</option>
                  <option value="BRT">BRT / Bartolini</option>
                  <option value="DHL">DHL Express</option>
                  <option value="Poste Italiane">Poste Italiane / SDA</option>
                  <option value="UPS">UPS</option>
                  <option value="TNT">TNT / FedEx</option>
                  <option value="Altro">Altro Corriere</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Numero di Tracciamento (Tracking Code) *</label>
                <input
                  type="text"
                  required
                  value={fulfillmentTracking}
                  onChange={(e) => setFulfillmentTracking(e.target.value)}
                  placeholder="Es. ZY891234567IT"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Link Tracciamento (Opzionale)</label>
                <input
                  type="url"
                  value={fulfillmentUrl}
                  onChange={(e) => setFulfillmentUrl(e.target.value)}
                  placeholder="https://www.gls-italy.com/track/..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Stato Consegna</label>
                <select
                  value={fulfillmentStatus}
                  onChange={(e) => setFulfillmentStatus(e.target.value as DeliveryStatus)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                >
                  <option value="in_transit">In Transito (Spedito)</option>
                  <option value="delivered">Consegnato al Cliente</option>
                  <option value="failed_delivery">Mancata Consegna / Giacenza</option>
                  <option value="returned">Reso al Mittente</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setFulfillmentOrder(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSubmitFulfillment}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs shadow-md"
              >
                {isSubmitting ? 'Salvataggio...' : 'Conferma Spedizione'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: Reso & Rimborso                                                  */}
      {/* ========================================================================= */}
      {returnRefundOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <RotateCcw className="w-4 h-4 text-rose-400" />
                <h3 className="font-bold text-sm text-white">Gestione Reso &amp; Rimborso</h3>
              </div>
              <button
                onClick={() => setReturnRefundOrder(null)}
                className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Stato Reso</label>
                <select
                  value={returnStatusVal}
                  onChange={(e) => setReturnStatusVal(e.target.value as ReturnStatus)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                >
                  <option value="requested">Reso Richiesto dall'Acquirente</option>
                  <option value="approved">Reso Approvato (In attesa rientro)</option>
                  <option value="item_received">Articolo Ricevuto</option>
                  <option value="completed">Reso Completato</option>
                  <option value="rejected">Reso Respinto</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Motivo del Reso</label>
                <input
                  type="text"
                  value={returnReasonVal}
                  onChange={(e) => setReturnReasonVal(e.target.value)}
                  placeholder="Es. Confezione danneggiata, gusto errato..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>

              <div className="border-t border-slate-800 pt-3">
                <label className="text-rose-400 font-bold block mb-1">
                  Emetti Rimborso Economico (€) (Opzionale)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={returnRefundOrder.total_paid || 1000}
                  value={refundAmountVal}
                  onChange={(e) => setRefundAmountVal(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-rose-300 font-bold"
                />
                <span className="text-[10px] text-slate-500 block mt-1">
                  Massimo rimborsabile: €{Number(returnRefundOrder.total_paid || 0).toFixed(2)}
                </span>
              </div>

              {refundAmountVal > 0 && (
                <div>
                  <label className="text-slate-400 block mb-1">Causale Rimborso</label>
                  <input
                    type="text"
                    value={refundReasonVal}
                    onChange={(e) => setRefundReasonVal(e.target.value)}
                    placeholder="Es. Rimborso totale reso merce"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setReturnRefundOrder(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                Chiudi
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSubmitReturn}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-md"
              >
                {isSubmitting ? 'Registrazione...' : 'Registra Reso/Rimborso'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: Annulla Ordine                                                   */}
      {/* ========================================================================= */}
      {cancelOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-rose-400 border-b border-slate-800 pb-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <h3 className="font-bold text-sm text-white">Annulla Ordine</h3>
            </div>

            <p className="text-xs text-slate-300">
              Sei sicuro di voler annullare l’ordine{' '}
              <span className="font-mono font-bold text-white">
                {cancelOrderModal.order_number || cancelOrderModal.id}
              </span>
              ? L’evento verrà registrato nella cronologia audit.
            </p>

            <div className="text-xs space-y-1">
              <label className="text-slate-400 block">Motivo dell'annullamento *</label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
              >
                <option value="Richiesta annullamento cliente">Richiesta annullamento cliente</option>
                <option value="Prodotto esaurito presso fornitore">Prodotto esaurito presso fornitore</option>
                <option value="Prezzo fornitore aumentato / Non conveniente">
                  Prezzo fornitore aumentato / Non conveniente
                </option>
                <option value="Indirizzo destinatario errato o incompleto">
                  Indirizzo destinatario errato o incompleto
                </option>
                <option value="Altro motivo operativo">Altro motivo operativo</option>
              </select>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCancelOrderModal(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSubmitCancel}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-md"
              >
                {isSubmitting ? 'Annullamento...' : 'Conferma Annullamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
