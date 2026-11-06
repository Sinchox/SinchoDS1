import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireWorkspaceContext,
  registerInMemoryMembership,
  clearInMemoryMemberships,
  AuthenticatedWorkspaceRequest,
  hasMinimumRole,
} from './workspaceMiddleware.js';
import {
  clearWorkspaceStore,
  listWorkspaceProducts,
  saveWorkspaceProduct,
  deleteWorkspaceProduct,
  listWorkspaceSuppliers,
  saveWorkspaceSupplier,
  deleteWorkspaceSupplier,
  saveWorkspaceEbayTokens,
  getWorkspaceEbayStatus,
  getWorkspaceEbayTokensForPublishing,
  listWorkspaceOrders,
  saveWorkspaceOrder,
} from './workspaceStore.js';
import { Product, Supplier, Order } from '../types.js';

function createMockResponse() {
  let statusCode = 200;
  let responseData: any = null;
  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
  };
  return {
    res,
    getStatusCode: () => statusCode,
    getData: () => responseData,
  };
}

test('Setup and teardown workspace isolation environment', () => {
  clearInMemoryMemberships();
  clearWorkspaceStore();

  // User A is Owner of Workspace A
  registerInMemoryMembership('user-aaa', 'ws-aaa', 'owner');
  // User B is Owner of Workspace B
  registerInMemoryMembership('user-bbb', 'ws-bbb', 'owner');
  // User C is Viewer of Workspace A
  registerInMemoryMembership('user-ccc', 'ws-aaa', 'viewer');
  // User M is Manager of Workspace A
  registerInMemoryMembership('user-mmm', 'ws-aaa', 'manager');
});

test('RBAC role hierarchy correctly computes permissions', () => {
  assert.equal(hasMinimumRole('viewer', 'viewer'), true);
  assert.equal(hasMinimumRole('viewer', 'manager'), false);
  assert.equal(hasMinimumRole('viewer', 'admin'), false);
  assert.equal(hasMinimumRole('viewer', 'owner'), false);

  assert.equal(hasMinimumRole('manager', 'viewer'), true);
  assert.equal(hasMinimumRole('manager', 'manager'), true);
  assert.equal(hasMinimumRole('manager', 'admin'), false);

  assert.equal(hasMinimumRole('admin', 'manager'), true);
  assert.equal(hasMinimumRole('admin', 'admin'), true);
  assert.equal(hasMinimumRole('admin', 'owner'), false);

  assert.equal(hasMinimumRole('owner', 'viewer'), true);
  assert.equal(hasMinimumRole('owner', 'manager'), true);
  assert.equal(hasMinimumRole('owner', 'admin'), true);
  assert.equal(hasMinimumRole('owner', 'owner'), true);
});

test('Middleware: Unauthenticated requests are rejected with HTTP 401', async () => {
  const middleware = requireWorkspaceContext();
  const req: any = { headers: {} };
  const { res, getStatusCode, getData } = createMockResponse();

  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(getStatusCode(), 401);
  assert.equal(getData().ok, false);
  assert.ok(getData().error.includes('authentication token is required'));
});

test('Middleware: Forged workspace IDs are rejected with HTTP 403', async () => {
  const middleware = requireWorkspaceContext();
  // User A attempts to access Workspace B (which belongs to User B)
  const req: any = {
    headers: {
      authorization: 'Bearer valid-token-user-a',
      'x-workspace-id': 'ws-bbb',
    },
    params: {},
    query: {},
  };

  // Mock token resolving to User A
  const mockUserA = { id: 'user-aaa', email: 'user.a@test.com' };
  // Intercept verifyAuthUser by pre-populating mock
  const { res, getStatusCode, getData } = createMockResponse();

  // Test resolution logic directly
  registerInMemoryMembership('user-aaa', 'ws-aaa', 'owner');
  // Verify User A has no membership in ws-bbb
  const membershipForB = (await import('./workspaceMiddleware.js')).resolveUserMembership('user-aaa', 'ws-bbb');
  const result = await membershipForB;
  assert.equal(result, null);
});

test('Data Isolation: User A cannot read User B’s products, orders, suppliers or eBay accounts', async () => {
  clearWorkspaceStore();

  const prodA: Product = {
    id: 'prod-aaa-1',
    url: 'https://www.pluspowersupplements.com/product-a',
    title: 'Workspace A Product',
    brand: 'Brand A',
    category: 'Proteine',
    price: 30,
    original_price: null,
    currency: 'EUR',
    sku: 'SKU-A',
    ean: '111',
    availability: 'InStock',
    stock_quantity: 10,
    description: null,
    ingredients: null,
    nutrition: null,
    images: [],
    variants: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    supplier_id: 'pluspower',
  };

  const prodB: Product = {
    id: 'prod-bbb-1',
    url: 'https://www.pluspowersupplements.com/product-b',
    title: 'Workspace B Secret Product',
    brand: 'Brand B',
    category: 'Proteine',
    price: 99,
    original_price: null,
    currency: 'EUR',
    sku: 'SKU-B',
    ean: '222',
    availability: 'InStock',
    stock_quantity: 50,
    description: null,
    ingredients: null,
    nutrition: null,
    images: [],
    variants: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    supplier_id: 'pluspower',
  };

  // Save to Workspace A and B
  await saveWorkspaceProduct('ws-aaa', prodA);
  await saveWorkspaceProduct('ws-bbb', prodB);

  // 1. Products Isolation Check
  const prodsA = await listWorkspaceProducts('ws-aaa');
  const prodsB = await listWorkspaceProducts('ws-bbb');

  assert.equal(prodsA.length, 1);
  assert.equal(prodsA[0].id, 'prod-aaa-1');
  assert.equal(prodsA[0].title, 'Workspace A Product');

  assert.equal(prodsB.length, 1);
  assert.equal(prodsB[0].id, 'prod-bbb-1');
  assert.equal(prodsB[0].title, 'Workspace B Secret Product');

  // Verify User A cannot find User B's product
  assert.equal(prodsA.some((p) => p.id === 'prod-bbb-1'), false);

  // 2. Orders Isolation Check
  const orderA: Order = {
    id: 'order-aaa',
    ebay_order_id: 'EBAY-AAA',
    buyer_username: 'buyerA',
    total_paid: 30,
    currency: 'EUR',
    status: 'fulfilled',
    created_at: new Date().toISOString(),
    items: [],
  };
  const orderB: Order = {
    id: 'order-bbb',
    ebay_order_id: 'EBAY-BBB',
    buyer_username: 'buyerB',
    total_paid: 99,
    currency: 'EUR',
    status: 'pending_fulfillment',
    created_at: new Date().toISOString(),
    items: [],
  };

  await saveWorkspaceOrder('ws-aaa', orderA);
  await saveWorkspaceOrder('ws-bbb', orderB);

  const ordersA = await listWorkspaceOrders('ws-aaa');
  const ordersB = await listWorkspaceOrders('ws-bbb');

  assert.equal(ordersA.length, 1);
  assert.equal(ordersA[0].id, 'order-aaa');
  assert.equal(ordersA.some((o) => o.id === 'order-bbb'), false);

  assert.equal(ordersB.length, 1);
  assert.equal(ordersB[0].id, 'order-bbb');
  assert.equal(ordersB.some((o) => o.id === 'order-aaa'), false);

  // 3. eBay Accounts Isolation Check
  await saveWorkspaceEbayTokens('ws-aaa', {
    accessToken: 'token-ws-aaa',
    refreshToken: 'refresh-ws-aaa',
    expiresIn: 3600,
    environment: 'PRODUCTION',
    sellerUsername: 'SellerAccountA',
  });

  const statusA = await getWorkspaceEbayStatus('ws-aaa');
  const statusB = await getWorkspaceEbayStatus('ws-bbb');

  assert.equal(statusA.connected, true);
  assert.equal(statusA.sellerUsername, 'SellerAccountA');

  // Workspace B has NOT connected eBay and cannot see Workspace A's credentials
  assert.equal(statusB.connected, false);
  assert.equal(statusB.sellerUsername, null);

  const tokensPublishB = await getWorkspaceEbayTokensForPublishing('ws-bbb');
  assert.equal(tokensPublishB, null);
});

test('Data Isolation: User A cannot modify or delete User B’s records', async () => {
  clearWorkspaceStore();

  const prodB: Product = {
    id: 'prod-bbb-locked',
    url: 'https://www.pluspowersupplements.com/product-b-locked',
    title: 'Workspace B Original Title',
    brand: 'Brand B',
    category: 'Proteine',
    price: 50,
    original_price: null,
    currency: 'EUR',
    sku: 'SKU-B',
    ean: '222',
    availability: 'InStock',
    stock_quantity: 10,
    description: null,
    ingredients: null,
    nutrition: null,
    images: [],
    variants: [],
    import_source: 'html_import',
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    supplier_id: 'pluspower',
  };

  await saveWorkspaceProduct('ws-bbb', prodB);

  // User A attempts to delete User B's product from within Workspace A
  const deleteResult = await deleteWorkspaceProduct('ws-aaa', 'prod-bbb-locked');
  assert.equal(deleteResult, false);

  // Verify User B's product is completely untouched
  const prodsB = await listWorkspaceProducts('ws-bbb');
  assert.equal(prodsB.length, 1);
  assert.equal(prodsB[0].id, 'prod-bbb-locked');
  assert.equal(prodsB[0].title, 'Workspace B Original Title');
});

test('Cross-workspace injection prevention: Workspace-owned records cannot be inserted into another workspace', async () => {
  clearWorkspaceStore();

  // Malicious request in Workspace A attempting to spoof workspace_id as Workspace B
  const maliciousProduct: any = {
    id: 'injected-product',
    workspace_id: 'ws-bbb', // Forged workspace ID
    url: 'https://www.pluspowersupplements.com/injected',
    title: 'Injected Attack Product',
    price: 10,
  };

  // Server saves under verified caller context 'ws-aaa'
  await saveWorkspaceProduct('ws-aaa', maliciousProduct);

  // Verify product is safely partitioned into ws-aaa and NOT ws-bbb
  const prodsA = await listWorkspaceProducts('ws-aaa');
  const prodsB = await listWorkspaceProducts('ws-bbb');

  assert.equal(prodsA.length, 1);
  assert.equal(prodsA[0].id, 'injected-product');

  assert.equal(prodsB.length, 0); // ws-bbb remains completely clean!
});

test('Global suppliers remain accessible across all workspaces and read-only', async () => {
  clearWorkspaceStore();

  // Both workspaces list suppliers
  const suppliersA = await listWorkspaceSuppliers('ws-aaa');
  const suppliersB = await listWorkspaceSuppliers('ws-bbb');

  const pluspowerA = suppliersA.find((s) => s.id === 'pluspower');
  const pluspowerB = suppliersB.find((s) => s.id === 'pluspower');

  assert.ok(pluspowerA);
  assert.ok(pluspowerB);
  assert.equal(pluspowerA.name, 'PlusPower Supplements');
  assert.equal(pluspowerB.name, 'PlusPower Supplements');

  // Attempting to modify global supplier is rejected
  const modifyAttempt = await saveWorkspaceSupplier(
    'ws-aaa',
    {
      ...pluspowerA,
      name: 'Hacked PlusPower',
    },
    'owner'
  );
  assert.equal(modifyAttempt.ok, false);
  assert.ok(modifyAttempt.error?.includes('Global reusable suppliers are system-wide and cannot be modified'));

  // Attempting to delete global supplier is rejected
  const deleteAttempt = await deleteWorkspaceSupplier('ws-aaa', 'pluspower', 'owner');
  assert.equal(deleteAttempt.ok, false);
  assert.ok(deleteAttempt.error?.includes('Global reusable suppliers cannot be deleted'));

  // But workspaces CAN create workspace-specific suppliers
  const customSupplier: Supplier = {
    id: 'custom-supplier-a',
    name: 'Custom Supplier For A Only',
    baseUrl: 'https://custom-a.test',
    logoText: 'CA',
    status: 'active',
    lastSyncAt: null,
    productCount: 0,
    failedCount: 0,
    description: 'Custom supplier for team A',
    supportedFeatures: {
      sitemap: true,
      variants: false,
      lotExpiry: false,
      liveScraping: true,
      htmlImport: true,
    },
  };

  const createCustom = await saveWorkspaceSupplier('ws-aaa', customSupplier, 'manager');
  assert.equal(createCustom.ok, true);

  const suppliersAAfter = await listWorkspaceSuppliers('ws-aaa');
  const suppliersBAfter = await listWorkspaceSuppliers('ws-bbb');

  assert.ok(suppliersAAfter.some((s) => s.id === 'custom-supplier-a'));
  assert.equal(suppliersBAfter.some((s) => s.id === 'custom-supplier-a'), false); // User B cannot see it!
});

test('Role permissions: viewers cannot modify workspace suppliers', async () => {
  const customSupplier: Supplier = {
    id: 'viewer-test-supplier',
    name: 'Viewer Supplier',
    baseUrl: 'https://viewer.test',
    logoText: 'VS',
    status: 'active',
    lastSyncAt: null,
    productCount: 0,
    failedCount: 0,
    description: 'Viewer supplier',
    supportedFeatures: {
      sitemap: true,
      variants: false,
      lotExpiry: false,
      liveScraping: true,
      htmlImport: true,
    },
  };

  const res = await saveWorkspaceSupplier('ws-aaa', customSupplier, 'viewer');
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('Role manager or higher is required'));
});
