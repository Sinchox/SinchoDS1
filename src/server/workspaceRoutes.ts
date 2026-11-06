import express, { Response } from 'express';
import {
  requireWorkspaceContext,
  AuthenticatedWorkspaceRequest,
  resolveUserMembership,
  inMemoryMemberships,
} from './workspaceMiddleware.js';
import {
  listWorkspaceProducts,
  getWorkspaceProduct,
  saveWorkspaceProduct,
  deleteWorkspaceProduct,
  bulkDeleteWorkspaceProducts,
  archiveWorkspaceProduct,
  restoreWorkspaceProduct,
  bulkArchiveWorkspaceProducts,
  bulkRestoreWorkspaceProducts,
  addWorkspaceProductVariant,
  updateWorkspaceProductVariant,
  deleteWorkspaceProductVariant,
  listWorkspaceSuppliers,
  saveWorkspaceSupplier,
  deleteWorkspaceSupplier,
  toggleWorkspaceSupplierConnection,
  testSupplierParser,
  importSingleProductUrl,
  createWorkspaceImportJob,
  getWorkspaceImportJob,
  getWorkspaceImportJobs,
  getWorkspaceEbayStatus,
  saveWorkspaceEbayTokens,
  getWorkspaceEbayTokensForPublishing,
  listWorkspaceEbayListings,
  saveWorkspaceEbayListing,
  deleteWorkspaceEbayListing,
  listWorkspaceOrders,
  getWorkspaceOrder,
  saveWorkspaceOrder,
  createWorkspaceOrder,
  cancelWorkspaceOrder,
  updateOrderFulfillment,
  updateOrderSupplierPurchase,
  recordOrderReturn,
  recordOrderRefund,
  deleteWorkspaceOrder,
  getWorkspaceOrderSummaryStats,
  getWorkspaceFinancialReport,
  exportWorkspaceFinancialOrdersCsv,
  listWorkspacePriceHistory,
  recordWorkspacePriceChange,
  approveWorkspacePriceChange,
  rejectWorkspacePriceChange,
  listWorkspaceImportHistory,
  addWorkspaceImportHistory,
  clearWorkspaceImportHistory,
} from './workspaceStore.js';
import {
  checkProductNow,
  checkProductsBulk,
  getWorkspaceMonitoringSettings,
  saveWorkspaceMonitoringSettings,
  listWorkspaceNotifications,
  markWorkspaceNotificationRead,
  resolveWorkspaceNotification,
  markAllWorkspaceNotificationsRead,
  listWorkspaceChangeReviews,
  approveWorkspaceChangeReview,
  rejectWorkspaceChangeReview,
  listWorkspaceMonitoringJobs,
  listWorkspaceEbaySyncEvents,
} from './monitoringService.js';
import { verifyAuthUser, getWorkspaceConfig, createServiceRoleClient } from './workspace.js';

export const workspaceRouter = express.Router();

// ==============================================================================
// 1. WORKSPACE SWITCHING & MEMBERSHIP DIRECTORY
// ==============================================================================

/**
 * GET /api/workspaces
 * List all workspaces the authenticated user is a verified member of.
 */
workspaceRouter.get('/workspaces', async (req: AuthenticatedWorkspaceRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const { user, error } = await verifyAuthUser(authHeader);

    if (error || !user) {
      res.status(401).json({ ok: false, error: error || 'Unauthorized' });
      return;
    }

    const config = getWorkspaceConfig();
    const workspaces: { id: string; name: string; role: string }[] = [];

    if (config.supabaseUrl && config.serviceRoleKey) {
      try {
        const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
        if (client) {
          const { data, error: qError } = await client
            .from('workspace_members')
            .select('workspace_id, role, workspaces (id, name, slug)')
            .eq('user_id', user.id);

          if (!qError && Array.isArray(data)) {
            for (const item of data) {
              const ws = item.workspaces as any;
              workspaces.push({
                id: item.workspace_id,
                name: ws?.name || 'Workspace',
                role: item.role,
              });
            }
          }
        }
      } catch {
        // Fallback
      }
    }

    // In-memory registry fallback / merge
    const local = inMemoryMemberships.get(user.id) || [];
    for (const mem of local) {
      if (!workspaces.some((w) => w.id === mem.workspaceId)) {
        workspaces.push({
          id: mem.workspaceId,
          name: `Workspace ${mem.workspaceId.slice(0, 8)}`,
          role: mem.role,
        });
      }
    }

    res.json({ ok: true, workspaces });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Error listing workspaces' });
  }
});

/**
 * GET /api/workspaces/current
 * Returns verified active workspace details for the caller.
 */
workspaceRouter.get(
  '/workspaces/current',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    res.json({
      ok: true,
      workspace: req.workspace,
      user: req.user,
    });
  }
);

/**
 * POST /api/workspaces/switch
 * Validates target workspace membership server-side.
 */
workspaceRouter.post('/workspaces/switch', async (req: AuthenticatedWorkspaceRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const { user, error } = await verifyAuthUser(authHeader);

    if (error || !user) {
      res.status(401).json({ ok: false, error: error || 'Unauthorized' });
      return;
    }

    const targetWorkspaceId = (req.body?.workspaceId || req.body?.workspace_id || '').trim();
    if (!targetWorkspaceId) {
      res.status(400).json({ ok: false, error: 'targetWorkspaceId is required.' });
      return;
    }

    const membership = await resolveUserMembership(user.id, targetWorkspaceId);
    if (!membership) {
      res.status(403).json({
        ok: false,
        error: 'Access Denied: You are not a member of the requested workspace.',
        workspaceId: targetWorkspaceId,
      });
      return;
    }

    res.json({
      ok: true,
      workspaceId: membership.workspaceId,
      role: membership.role,
      message: `Successfully switched to workspace ${membership.workspaceId}`,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Error switching workspace' });
  }
});

// ==============================================================================
// 2. PRODUCTS & VARIANTS
// ==============================================================================

/**
 * GET /api/products
 * List products for verified workspace.
 */
workspaceRouter.get(
  '/products',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const products = await listWorkspaceProducts(req.workspace!.id);
      res.json({ ok: true, products, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching products' });
    }
  }
);

/**
 * GET /api/products/:id
 */
workspaceRouter.get(
  '/products/:id',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const product = await getWorkspaceProduct(req.workspace!.id, req.params.id);
      if (!product) {
        res.status(404).json({ ok: false, error: 'Product not found in this workspace' });
        return;
      }
      res.json({ ok: true, product });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching product' });
    }
  }
);

/**
 * POST /api/products
 * Saves product scoped strictly to req.workspace.id (requires manager, admin, or owner)
 */
workspaceRouter.post(
  '/products',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const rawProduct = req.body?.product || req.body;
      if (!rawProduct || !rawProduct.title || !rawProduct.url) {
        res.status(400).json({ ok: false, error: 'Product title and url are required.' });
        return;
      }

      const result = await saveWorkspaceProduct(req.workspace!.id, rawProduct);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, product: result.product, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error saving product' });
    }
  }
);

/**
 * PUT /api/products/:id
 */
workspaceRouter.put(
  '/products/:id',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const rawProduct = req.body?.product || req.body;
      rawProduct.id = req.params.id;

      const result = await saveWorkspaceProduct(req.workspace!.id, rawProduct);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, product: result.product });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error updating product' });
    }
  }
);

/**
 * DELETE /api/products/:id
 */
workspaceRouter.delete(
  '/products/:id',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const success = await deleteWorkspaceProduct(req.workspace!.id, req.params.id);
      if (!success) {
        res.status(404).json({ ok: false, error: 'Product not found in this workspace' });
        return;
      }
      res.json({ ok: true, message: 'Product deleted from workspace' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error deleting product' });
    }
  }
);

/**
 * POST /api/products/bulk-delete
 */
workspaceRouter.post(
  '/products/bulk-delete',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ ok: false, error: 'ids array is required.' });
        return;
      }
      await bulkDeleteWorkspaceProducts(req.workspace!.id, ids);
      res.json({ ok: true, count: ids.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error deleting products' });
    }
  }
);

/**
 * PUT /api/products/:id/archive
 */
workspaceRouter.put(
  '/products/:id/archive',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const product = await archiveWorkspaceProduct(req.workspace!.id, req.params.id);
      if (!product) {
        res.status(404).json({ ok: false, error: 'Product not found in this workspace' });
        return;
      }
      res.json({ ok: true, product, message: 'Product archived' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error archiving product' });
    }
  }
);

/**
 * PUT /api/products/:id/restore
 */
workspaceRouter.put(
  '/products/:id/restore',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const product = await restoreWorkspaceProduct(req.workspace!.id, req.params.id);
      if (!product) {
        res.status(404).json({ ok: false, error: 'Product not found in this workspace' });
        return;
      }
      res.json({ ok: true, product, message: 'Product restored' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error restoring product' });
    }
  }
);

/**
 * POST /api/products/bulk-archive
 */
workspaceRouter.post(
  '/products/bulk-archive',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ ok: false, error: 'ids array is required.' });
        return;
      }
      const count = await bulkArchiveWorkspaceProducts(req.workspace!.id, ids);
      res.json({ ok: true, count });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error archiving products' });
    }
  }
);

/**
 * POST /api/products/bulk-restore
 */
workspaceRouter.post(
  '/products/bulk-restore',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ ok: false, error: 'ids array is required.' });
        return;
      }
      const count = await bulkRestoreWorkspaceProducts(req.workspace!.id, ids);
      res.json({ ok: true, count });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error restoring products' });
    }
  }
);

/**
 * POST /api/products/:id/variants
 * Adds a new variant to product
 */
workspaceRouter.post(
  '/products/:id/variants',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const variant = req.body?.variant || req.body;
      const result = await addWorkspaceProductVariant(req.workspace!.id, req.params.id, variant);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, product: result.product });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error adding variant' });
    }
  }
);

/**
 * PUT /api/products/:id/variants/:variantId
 * Updates an existing variant without flattening
 */
workspaceRouter.put(
  '/products/:id/variants/:variantId',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const updates = req.body?.variant || req.body;
      const result = await updateWorkspaceProductVariant(req.workspace!.id, req.params.id, req.params.variantId, updates);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, product: result.product });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error updating variant' });
    }
  }
);

/**
 * DELETE /api/products/:id/variants/:variantId
 */
workspaceRouter.delete(
  '/products/:id/variants/:variantId',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const result = await deleteWorkspaceProductVariant(req.workspace!.id, req.params.id, req.params.variantId);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, product: result.product });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error deleting variant' });
    }
  }
);

/**
 * POST /api/products/import-url
 * Single URL import with workspace duplicate prevention and Draft status
 */
workspaceRouter.post(
  '/products/import-url',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const { url, supplierId, fetchMethod, jsRender } = req.body;
      if (!url) {
        res.status(400).json({ ok: false, error: 'Product URL is required.' });
        return;
      }

      const result = await importSingleProductUrl(
        req.workspace!.id,
        url,
        supplierId,
        fetchMethod || 'direct',
        Boolean(jsRender)
      );

      if (result.isDuplicate) {
        res.status(409).json({
          ok: false,
          isDuplicate: true,
          error: result.error,
          product: result.product,
        });
        return;
      }

      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }

      res.json({ ok: true, product: result.product });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error importing product URL' });
    }
  }
);

/**
 * POST /api/imports/jobs
 * Starts an asynchronous background import job that continues even if browser disconnects
 */
workspaceRouter.post(
  '/imports/jobs',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const { urls, supplierId, fetchMethod, jsRender } = req.body;
      if (!Array.isArray(urls) || urls.length === 0) {
        res.status(400).json({ ok: false, error: 'urls array is required.' });
        return;
      }

      const job = createWorkspaceImportJob(
        req.workspace!.id,
        urls,
        supplierId,
        fetchMethod || 'direct',
        Boolean(jsRender)
      );

      res.json({ ok: true, jobId: job.id, job });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error starting import job' });
    }
  }
);

/**
 * GET /api/imports/jobs/:jobId
 */
workspaceRouter.get(
  '/imports/jobs/:jobId',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const job = getWorkspaceImportJob(req.workspace!.id, req.params.jobId);
      if (!job) {
        res.status(404).json({ ok: false, error: 'Import job not found' });
        return;
      }
      res.json({ ok: true, job });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching import job' });
    }
  }
);

/**
 * GET /api/imports/jobs
 */
workspaceRouter.get(
  '/imports/jobs',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const jobs = getWorkspaceImportJobs(req.workspace!.id);
      res.json({ ok: true, jobs });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error listing import jobs' });
    }
  }
);

// ==============================================================================
// 3. SUPPLIERS (Global + Workspace-Specific)
// ==============================================================================

/**
 * GET /api/suppliers
 * Returns global suppliers + workspace's suppliers.
 */
workspaceRouter.get(
  '/suppliers',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const suppliers = await listWorkspaceSuppliers(req.workspace!.id);
      res.json({ ok: true, suppliers, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error listing suppliers' });
    }
  }
);

/**
 * POST /api/suppliers
 * Adds a custom workspace supplier (cannot be global).
 */
workspaceRouter.post(
  '/suppliers',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const supplier = req.body?.supplier || req.body;
      if (!supplier || !supplier.name || !supplier.baseUrl) {
        res.status(400).json({ ok: false, error: 'Supplier name and baseUrl are required.' });
        return;
      }

      const result = await saveWorkspaceSupplier(req.workspace!.id, supplier, req.workspace!.role);
      if (!result.ok) {
        res.status(403).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, supplier: result.supplier });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error saving supplier' });
    }
  }
);

/**
 * PUT /api/suppliers/:id
 * Updates a custom workspace supplier
 */
workspaceRouter.put(
  '/suppliers/:id',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const supplier = req.body?.supplier || req.body;
      supplier.id = req.params.id;

      const result = await saveWorkspaceSupplier(req.workspace!.id, supplier, req.workspace!.role);
      if (!result.ok) {
        res.status(403).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, supplier: result.supplier });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error updating supplier' });
    }
  }
);

/**
 * POST /api/suppliers/:id/connect
 */
workspaceRouter.post(
  '/suppliers/:id/connect',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const result = await toggleWorkspaceSupplierConnection(req.workspace!.id, req.params.id, true, req.workspace!.role);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, supplier: result.supplier, message: 'Supplier connected' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error connecting supplier' });
    }
  }
);

/**
 * POST /api/suppliers/:id/disconnect
 */
workspaceRouter.post(
  '/suppliers/:id/disconnect',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const result = await toggleWorkspaceSupplierConnection(req.workspace!.id, req.params.id, false, req.workspace!.role);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, supplier: result.supplier, message: 'Supplier disconnected' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error disconnecting supplier' });
    }
  }
);

/**
 * POST /api/suppliers/test-parser
 * Runs parser test mode on supplied product URL and returns detected fields / errors
 */
workspaceRouter.post(
  '/suppliers/test-parser',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const { url, supplierId, parserConfig, fetchMethod, jsRender } = req.body;
      if (!url) {
        res.status(400).json({ ok: false, error: 'Product URL is required for parser test mode.' });
        return;
      }

      const result = await testSupplierParser(
        req.workspace!.id,
        url,
        supplierId,
        parserConfig,
        fetchMethod || 'direct',
        Boolean(jsRender)
      );

      if (!result.ok) {
        res.status(400).json({
          ok: false,
          error: result.error,
          detectedFields: result.detectedFields,
        });
        return;
      }

      res.json({
        ok: true,
        product: result.product,
        detectedFields: result.detectedFields,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error testing parser' });
    }
  }
);

/**
 * DELETE /api/suppliers/:id
 */
workspaceRouter.delete(
  '/suppliers/:id',
  requireWorkspaceContext({ minRole: 'admin' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const result = await deleteWorkspaceSupplier(req.workspace!.id, req.params.id, req.workspace!.role);
      if (!result.ok) {
        res.status(403).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, message: 'Supplier deleted from workspace' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error deleting supplier' });
    }
  }
);

// ==============================================================================
// 4. EBAY LISTINGS
// ==============================================================================

/**
 * GET /api/ebay-listings
 */
workspaceRouter.get(
  '/ebay-listings',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const listings = await listWorkspaceEbayListings(req.workspace!.id);
      res.json({ ok: true, listings, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching listings' });
    }
  }
);

/**
 * POST /api/ebay-listings
 */
workspaceRouter.post(
  '/ebay-listings',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const listing = req.body?.listing || req.body;
      if (!listing || !listing.title || !listing.price) {
        res.status(400).json({ ok: false, error: 'Listing title and price are required.' });
        return;
      }

      const result = await saveWorkspaceEbayListing(req.workspace!.id, listing);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, listing: result.listing });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error saving listing' });
    }
  }
);

/**
 * DELETE /api/ebay-listings/:id
 */
workspaceRouter.delete(
  '/ebay-listings/:id',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const deleted = await deleteWorkspaceEbayListing(req.workspace!.id, req.params.id);
      if (!deleted) {
        res.status(404).json({ ok: false, error: 'Listing not found in this workspace' });
        return;
      }
      res.json({ ok: true, message: 'Listing deleted' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error deleting listing' });
    }
  }
);

// ==============================================================================
// 5. ORDERS & FULFILLMENT FOUNDATION (Phase 1.6A)
// ==============================================================================

/**
 * GET /api/orders/summary/stats
 */
workspaceRouter.get(
  '/orders/summary/stats',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const stats = await getWorkspaceOrderSummaryStats(req.workspace!.id);
      res.json({ ok: true, stats, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching order summary statistics' });
    }
  }
);

/**
 * GET /api/orders
 * Supports query filters: status, supplierId, deliveryStatus, startDate, endDate, search
 */
workspaceRouter.get(
  '/orders',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const { status, supplierId, deliveryStatus, startDate, endDate, search } = req.query;
      const orders = await listWorkspaceOrders(req.workspace!.id, {
        status: status as string,
        supplierId: supplierId as string,
        deliveryStatus: deliveryStatus as string,
        startDate: startDate as string,
        endDate: endDate as string,
        search: search as string,
      });
      res.json({ ok: true, orders, workspaceId: req.workspace!.id, total: orders.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching orders' });
    }
  }
);

/**
 * GET /api/orders/:id
 */
workspaceRouter.get(
  '/orders/:id',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const order = await getWorkspaceOrder(req.workspace!.id, req.params.id);
      if (!order) {
        res.status(404).json({ ok: false, error: 'Order not found in this workspace' });
        return;
      }
      res.json({ ok: true, order, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching order' });
    }
  }
);

/**
 * POST /api/orders
 * Create new order (manager, admin, or owner)
 */
workspaceRouter.post(
  '/orders',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const order = req.body?.order || req.body;
      if (!order) {
        res.status(400).json({ ok: false, error: 'Order payload is required.' });
        return;
      }

      const actor = req.user?.id || req.user?.email || 'manager';
      const result = await createWorkspaceOrder(req.workspace!.id, order, actor);

      if (!result.ok) {
        const isConflict = result.error?.includes('Duplicate external order ID');
        res.status(isConflict ? 409 : 400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, order: result.order, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error creating order' });
    }
  }
);

/**
 * PUT /api/orders/:id
 * Update existing order (manager, admin, or owner)
 */
workspaceRouter.put(
  '/orders/:id',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const updates = req.body?.order || req.body;
      updates.id = req.params.id;

      const actor = req.user?.id || req.user?.email || 'manager';
      const result = await saveWorkspaceOrder(req.workspace!.id, updates, actor);

      if (!result.ok) {
        const isConflict = result.error?.includes('Duplicate external order ID');
        res.status(isConflict ? 409 : 400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, order: result.order, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error updating order' });
    }
  }
);

/**
 * POST /api/orders/:id/cancel
 * Cancel order with reason
 */
workspaceRouter.post(
  '/orders/:id/cancel',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const reason = req.body?.reason || req.body?.cancellation_reason || 'Annullato manualmente';
      const actor = req.user?.id || req.user?.email || 'manager';

      const result = await cancelWorkspaceOrder(req.workspace!.id, req.params.id, reason, actor);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, order: result.order, message: 'Order successfully cancelled' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error cancelling order' });
    }
  }
);

/**
 * POST /api/orders/:id/fulfillment
 * Update manual fulfillment (carrier, tracking, delivery status)
 */
workspaceRouter.post(
  '/orders/:id/fulfillment',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const fulfillment = req.body?.fulfillment || req.body;
      const actor = req.user?.id || req.user?.email || 'manager';

      const result = await updateOrderFulfillment(req.workspace!.id, req.params.id, fulfillment, actor);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, order: result.order, message: 'Fulfillment successfully updated' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error updating fulfillment' });
    }
  }
);

/**
 * POST /api/orders/:id/supplier-purchase
 * Record supplier purchase reference and status
 */
workspaceRouter.post(
  '/orders/:id/supplier-purchase',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const supplierData = req.body?.supplierData || req.body;
      const actor = req.user?.id || req.user?.email || 'manager';

      const result = await updateOrderSupplierPurchase(req.workspace!.id, req.params.id, supplierData, actor);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, order: result.order, message: 'Supplier purchase recorded' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error updating supplier purchase' });
    }
  }
);

/**
 * POST /api/orders/:id/return
 * Record customer return
 */
workspaceRouter.post(
  '/orders/:id/return',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const returnData = req.body?.returnData || req.body;
      const actor = req.user?.id || req.user?.email || 'manager';

      const result = await recordOrderReturn(req.workspace!.id, req.params.id, returnData, actor);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, order: result.order, message: 'Return recorded' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error recording return' });
    }
  }
);

/**
 * POST /api/orders/:id/refund
 * Record customer refund
 */
workspaceRouter.post(
  '/orders/:id/refund',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const refundData = req.body?.refundData || req.body;
      const actor = req.user?.id || req.user?.email || 'manager';

      const result = await recordOrderRefund(req.workspace!.id, req.params.id, refundData, actor);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json({ ok: true, order: result.order, message: 'Refund recorded' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error recording refund' });
    }
  }
);

/**
 * DELETE /api/orders/:id
 * Delete order (admin or owner only)
 */
workspaceRouter.delete(
  '/orders/:id',
  requireWorkspaceContext({ minRole: 'admin' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const deleted = await deleteWorkspaceOrder(req.workspace!.id, req.params.id);
      if (!deleted) {
        res.status(404).json({ ok: false, error: 'Order not found in this workspace' });
        return;
      }
      res.json({ ok: true, message: 'Order successfully deleted from workspace' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error deleting order' });
    }
  }
);

// ==============================================================================
// 5B. FINANCIAL REPORTING & PROFIT ANALYTICS (Phase 1.6B)
// ==============================================================================

/**
 * GET /api/financials/report
 * Returns comprehensive workspace financial analytics filtered by date preset or range.
 */
workspaceRouter.get(
  '/financials/report',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const { range, startDate, endDate } = req.query;
      const report = await getWorkspaceFinancialReport(req.workspace!.id, {
        range: (range as any) || 'this_month',
        startDate: startDate as string,
        endDate: endDate as string,
      });
      res.json({ ok: true, report, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error generating financial report' });
    }
  }
);

/**
 * GET /api/financials/export-csv
 * Exports RFC 4180 CSV with transaction-level financial records.
 */
workspaceRouter.get(
  '/financials/export-csv',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const { range, startDate, endDate } = req.query;
      const result = await exportWorkspaceFinancialOrdersCsv(req.workspace!.id, {
        range: (range as any) || 'this_month',
        startDate: startDate as string,
        endDate: endDate as string,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.status(200).send(result.csv);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error exporting financial CSV' });
    }
  }
);

// ==============================================================================
// 6. PRICE HISTORY & IMPORT HISTORY
// ==============================================================================

/**
 * GET /api/price-history
 */
workspaceRouter.get(
  '/price-history',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const productId = req.query.productId as string;
      const history = await listWorkspacePriceHistory(req.workspace!.id, productId);
      res.json({ ok: true, history, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching price history' });
    }
  }
);

/**
 * POST /api/price-history
 */
workspaceRouter.post(
  '/price-history',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const item = req.body?.item || req.body;
      await recordWorkspacePriceChange(req.workspace!.id, item);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error recording price change' });
    }
  }
);

/**
 * GET /api/import-history
 */
workspaceRouter.get(
  '/import-history',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const history = await listWorkspaceImportHistory(req.workspace!.id);
      res.json({ ok: true, history, workspaceId: req.workspace!.id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching import history' });
    }
  }
);

/**
 * POST /api/import-history
 */
workspaceRouter.post(
  '/import-history',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const item = req.body?.item || req.body;
      await addWorkspaceImportHistory(req.workspace!.id, item);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error recording import history' });
    }
  }
);

/**
 * DELETE /api/import-history
 */
workspaceRouter.delete(
  '/import-history',
  requireWorkspaceContext({ minRole: 'admin' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      await clearWorkspaceImportHistory(req.workspace!.id);
      res.json({ ok: true, message: 'Import history cleared' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error clearing import history' });
    }
  }
);

// ==============================================================================
// 7. WORKSPACE-SCOPED EBAY INTEGRATION
// ==============================================================================

/**
 * GET /api/ebay/status (workspace scoped)
 */
workspaceRouter.get(
  '/ebay/status',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const status = await getWorkspaceEbayStatus(req.workspace!.id);
      res.json({
        ok: true,
        workspaceId: req.workspace!.id,
        ...status,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error getting eBay status' });
    }
  }
);

/**
 * POST /api/ebay/exchange-code (requires admin or owner of workspace)
 */
workspaceRouter.post(
  '/ebay/exchange-code',
  requireWorkspaceContext({ minRole: 'admin' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const { code, clientId, clientSecret, ruName, environment } = req.body;

      if (!code || !clientId || !clientSecret || !ruName) {
        res.status(400).json({
          ok: false,
          error: 'All parameters (code, clientId, clientSecret, ruName) are required.',
        });
        return;
      }

      const env = (environment || 'PRODUCTION').toUpperCase();
      const tokenEndpoint = env === 'SANDBOX'
        ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
        : 'https://api.ebay.com/identity/v1/oauth2/token';

      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', ruName);

      const tokenRes = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
        body: params.toString(),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        res.status(tokenRes.status).json({
          ok: false,
          error: tokenData.error_description || tokenData.error || 'eBay token exchange error',
        });
        return;
      }

      // Save tokens strictly scoped to this workspace
      await saveWorkspaceEbayTokens(req.workspace!.id, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        environment: env as any,
        sellerUsername: 'Connected eBay Account',
        clientId,
      });

      // Never return access_token or refresh_token to client!
      res.json({
        ok: true,
        connected: true,
        workspaceId: req.workspace!.id,
        expiresIn: tokenData.expires_in,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error during token exchange' });
    }
  }
);

/**
 * POST /api/ebay/publish (workspace scoped)
 */
workspaceRouter.post(
  '/ebay/publish',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const { listing } = req.body;
      if (!listing) {
        res.status(400).json({ ok: false, error: 'Listing payload is required.' });
        return;
      }

      if (listing.title && listing.title.length > 80) {
        res.status(400).json({
          ok: false,
          error: `Title exceeds the 80 character limit allowed by eBay (${listing.title.length}/80).`,
        });
        return;
      }

      const tokens = await getWorkspaceEbayTokensForPublishing(req.workspace!.id);

      if (tokens && tokens.accessToken) {
        const apiHost = tokens.environment === 'SANDBOX'
          ? 'https://api.sandbox.ebay.com'
          : 'https://api.ebay.com';

        const sku = listing.sku || `SINCHO-${listing.id.substring(0, 8)}`;

        const inventoryPayload = {
          availability: {
            shipToLocationAvailability: {
              quantity: listing.quantity || 1,
            },
          },
          condition: listing.condition_id || 'NEW',
          product: {
            title: listing.title,
            description: listing.description_html,
            aspects: listing.item_specifics || {},
            brand: listing.brand || 'Generic',
            imageUrls: listing.images || [],
            ean: listing.ean ? [listing.ean] : undefined,
          },
        };

        const invRes = await fetch(`${apiHost}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'Content-Type': 'application/json',
            'Content-Language': 'it-IT',
          },
          body: JSON.stringify(inventoryPayload),
        });

        if (!invRes.ok && invRes.status !== 204 && invRes.status !== 201 && invRes.status !== 200) {
          const invErr = await invRes.text();
          res.status(400).json({
            ok: false,
            error: `eBay Inventory Item error: ${invErr}`,
          });
          return;
        }

        const offerPayload = {
          sku,
          marketplaceId: listing.marketplace_id || 'EBAY_IT',
          format: 'FIXED_PRICE',
          pricingSummary: {
            price: {
              value: Number(listing.price).toFixed(2),
              currency: 'EUR',
            },
          },
          categoryId: listing.category_id || '180959',
          listingPolicies: {
            shippingPolicyId: listing.shipping_policy_id || undefined,
            returnPolicyId: listing.return_policy_id || undefined,
            paymentPolicyId: listing.payment_policy_id || undefined,
          },
        };

        const offerRes = await fetch(`${apiHost}/sell/inventory/v1/offer`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'Content-Type': 'application/json',
            'Content-Language': 'it-IT',
          },
          body: JSON.stringify(offerPayload),
        });

        const offerData = await offerRes.json();
        if (!offerRes.ok) {
          res.status(400).json({
            ok: false,
            error: offerData.errors?.[0]?.message || 'eBay Offer creation error',
          });
          return;
        }

        const offerId = offerData.offerId;
        const pubRes = await fetch(`${apiHost}/sell/inventory/v1/offer/${offerId}/publish`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        const pubData = await pubRes.json();
        if (!pubRes.ok) {
          res.status(400).json({
            ok: false,
            error: pubData.errors?.[0]?.message || 'eBay Offer publication error',
          });
          return;
        }

        // Save published listing with workspace scoping
        await saveWorkspaceEbayListing(req.workspace!.id, {
          ...listing,
          status: 'active',
          ebay_item_id: pubData.listingId,
          ebay_offer_id: offerId,
          published_at: new Date().toISOString(),
        });

        res.json({
          ok: true,
          status: 'active',
          ebayItemId: pubData.listingId,
          ebayOfferId: offerId,
          workspaceId: req.workspace!.id,
          message: 'Listing successfully published to eBay.it!',
        });
        return;
      }

      // Not connected for this workspace
      res.json({
        ok: false,
        notConnected: true,
        status: 'draft',
        workspaceId: req.workspace!.id,
        message: 'eBay account not authorized for this workspace. Please connect eBay Developer credentials in Settings.',
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Internal publication error' });
    }
  }
);

// ==============================================================================
// 7. AUTOMATIC PRICE & STOCK MONITORING (Phase 1.4)
// ==============================================================================

/**
 * POST /api/monitoring/check-now
 * Trigger immediate monitoring check for one or multiple products in workspace.
 */
workspaceRouter.post(
  '/monitoring/check-now',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const workspaceId = req.workspace!.id;
      const { productIds, productId } = req.body || {};

      const targetIds: string[] = Array.isArray(productIds)
        ? productIds.map(String).filter(Boolean)
        : productId
        ? [String(productId)]
        : [];

      if (targetIds.length === 0) {
        // If no productIds supplied, check all products in the workspace
        const prods = await listWorkspaceProducts(workspaceId);
        targetIds.push(...prods.map((p) => p.id));
      }

      if (targetIds.length === 0) {
        res.json({ ok: true, results: [], message: 'No products to monitor in this workspace.' });
        return;
      }

      const results = await checkProductsBulk(workspaceId, targetIds);
      res.json({ ok: true, results, count: results.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Monitoring execution failed' });
    }
  }
);

/**
 * GET /api/monitoring/status
 * Returns workspace monitoring status, count of due products, and queues.
 */
workspaceRouter.get(
  '/monitoring/status',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const workspaceId = req.workspace!.id;
      const products = await listWorkspaceProducts(workspaceId);
      const reviews = await listWorkspaceChangeReviews(workspaceId, { status: 'pending' });
      const priceHistory = await listWorkspacePriceHistory(workspaceId);
      const pendingPriceApprovals = priceHistory.filter((h) => h.status === 'pending_approval');
      const notifications = await listWorkspaceNotifications(workspaceId, { unreadOnly: true });
      const settings = getWorkspaceMonitoringSettings(workspaceId);

      const statusCounts = {
        total: products.length,
        idle: 0,
        checking: 0,
        error: 0,
        out_of_stock: 0,
        pending_approval: 0,
        changes_detected: 0,
      };

      let nextDueTimestamp: string | null = null;
      const now = Date.now();

      for (const p of products) {
        const s = (p.monitoring_status || 'idle') as keyof typeof statusCounts;
        if (statusCounts[s] !== undefined) {
          statusCounts[s]++;
        } else {
          statusCounts.idle++;
        }

        if (p.next_check_at) {
          if (!nextDueTimestamp || new Date(p.next_check_at).getTime() < new Date(nextDueTimestamp).getTime()) {
            nextDueTimestamp = p.next_check_at;
          }
        }
      }

      res.json({
        ok: true,
        workspaceId,
        statusCounts,
        pendingReviewsCount: reviews.length,
        pendingPriceApprovalsCount: pendingPriceApprovals.length,
        unreadNotificationsCount: notifications.length,
        nextDueTimestamp,
        settings,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching monitoring status' });
    }
  }
);

/**
 * GET /api/monitoring/settings
 */
workspaceRouter.get(
  '/monitoring/settings',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const settings = getWorkspaceMonitoringSettings(req.workspace!.id);
      res.json({ ok: true, settings });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error fetching monitoring settings' });
    }
  }
);

/**
 * PUT /api/monitoring/settings
 */
workspaceRouter.put(
  '/monitoring/settings',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const updated = saveWorkspaceMonitoringSettings(req.workspace!.id, req.body || {});
      res.json({ ok: true, settings: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error saving monitoring settings' });
    }
  }
);

/**
 * GET /api/monitoring/reviews
 * List pending or filtered product content change reviews.
 */
workspaceRouter.get(
  '/monitoring/reviews',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const status = req.query.status as any;
      const productId = req.query.productId as string;
      const reviews = await listWorkspaceChangeReviews(req.workspace!.id, { status, productId });
      res.json({ ok: true, reviews });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error listing change reviews' });
    }
  }
);

/**
 * POST /api/monitoring/reviews/:id/approve
 */
workspaceRouter.post(
  '/monitoring/reviews/:id/approve',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const result = await approveWorkspaceChangeReview(req.workspace!.id, req.params.id);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error approving change review' });
    }
  }
);

/**
 * POST /api/monitoring/reviews/:id/reject
 */
workspaceRouter.post(
  '/monitoring/reviews/:id/reject',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const result = await rejectWorkspaceChangeReview(req.workspace!.id, req.params.id);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error rejecting change review' });
    }
  }
);

/**
 * GET /api/monitoring/price-approvals
 * Lists price changes pending manual approval.
 */
workspaceRouter.get(
  '/monitoring/price-approvals',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const history = await listWorkspacePriceHistory(req.workspace!.id);
      const pending = history.filter((h) => h.status === 'pending_approval');
      res.json({ ok: true, pendingApprovals: pending });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error listing pending price approvals' });
    }
  }
);

/**
 * POST /api/monitoring/price-approvals/:id/approve
 */
workspaceRouter.post(
  '/monitoring/price-approvals/:id/approve',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const result = await approveWorkspacePriceChange(req.workspace!.id, req.params.id);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error approving price change' });
    }
  }
);

/**
 * POST /api/monitoring/price-approvals/:id/reject
 */
workspaceRouter.post(
  '/monitoring/price-approvals/:id/reject',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const result = await rejectWorkspacePriceChange(req.workspace!.id, req.params.id);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error rejecting price change' });
    }
  }
);

/**
 * GET /api/notifications
 */
workspaceRouter.get(
  '/notifications',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const unreadOnly = req.query.unreadOnly === 'true';
      const severity = req.query.severity as string;
      const notifications = await listWorkspaceNotifications(req.workspace!.id, { unreadOnly, severity });
      res.json({ ok: true, notifications });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error listing notifications' });
    }
  }
);

/**
 * PUT /api/notifications/:id/read
 */
workspaceRouter.put(
  '/notifications/:id/read',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const ok = await markWorkspaceNotificationRead(req.workspace!.id, req.params.id);
      res.json({ ok });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error marking notification read' });
    }
  }
);

/**
 * PUT /api/notifications/:id/resolve
 */
workspaceRouter.put(
  '/notifications/:id/resolve',
  requireWorkspaceContext({ minRole: 'manager' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const ok = await resolveWorkspaceNotification(req.workspace!.id, req.params.id);
      res.json({ ok });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error resolving notification' });
    }
  }
);

/**
 * POST /api/notifications/mark-all-read
 */
workspaceRouter.post(
  '/notifications/mark-all-read',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const count = await markAllWorkspaceNotificationsRead(req.workspace!.id);
      res.json({ ok: true, count });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error marking all notifications read' });
    }
  }
);

/**
 * GET /api/monitoring/sync-events
 */
workspaceRouter.get(
  '/monitoring/sync-events',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const productId = req.query.productId as string;
      const events = await listWorkspaceEbaySyncEvents(req.workspace!.id, productId);
      res.json({ ok: true, events });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error listing sync events' });
    }
  }
);

/**
 * GET /api/monitoring/jobs
 */
workspaceRouter.get(
  '/monitoring/jobs',
  requireWorkspaceContext({ minRole: 'viewer' }),
  async (req: AuthenticatedWorkspaceRequest, res: Response) => {
    try {
      const jobs = await listWorkspaceMonitoringJobs(req.workspace!.id);
      res.json({ ok: true, jobs });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Error listing monitoring jobs' });
    }
  }
);

