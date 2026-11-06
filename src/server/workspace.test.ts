import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_WORKSPACE_ID,
  safeTimingCompare,
  verifyAuthUser,
  bootstrapUserWorkspace,
  claimLegacyWorkspace,
  handleBootstrapWorkspace,
  handleClaimLegacyWorkspace,
} from './workspace.js';

test('safeTimingCompare validates identical strings and rejects mismatches safely', () => {
  const secret = 'SuperSecretServerToken2026!#$';
  assert.equal(safeTimingCompare(secret, secret), true);
  assert.equal(safeTimingCompare(secret, 'WrongSecretPassphrase'), false);
  assert.equal(safeTimingCompare(secret, secret.slice(0, -1)), false);
  assert.equal(safeTimingCompare(secret, undefined), false);
  assert.equal(safeTimingCompare(undefined, undefined), false);
  assert.equal(safeTimingCompare('', ''), false);
});

test('verifyAuthUser rejects missing or invalid tokens', async () => {
  const emptyRes = await verifyAuthUser(undefined);
  assert.equal(emptyRes.user, null);
  assert.ok(emptyRes.error?.includes('Missing or invalid Authorization header'));

  const malformedRes = await verifyAuthUser('Bearer ');
  assert.equal(malformedRes.user, null);
  assert.ok(malformedRes.error?.includes('Empty bearer token'));

  const mockSupabaseWithInvalidToken = {
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: { message: 'Invalid token' },
      }),
    },
  } as any;

  const invalidRes = await verifyAuthUser('Bearer bad_token_123', mockSupabaseWithInvalidToken);
  assert.equal(invalidRes.user, null);
  assert.equal(invalidRes.error, 'Invalid token');
});

test('verifyAuthUser resolves authenticated user from valid token', async () => {
  const mockSupabase = {
    auth: {
      getUser: async (token: string) => {
        if (token === 'valid_jwt_token') {
          return {
            data: {
              user: {
                id: '11111111-2222-3333-4444-555555555555',
                email: 'admin@sinchods.test',
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'Unauthorized' } };
      },
    },
  } as any;

  const res = await verifyAuthUser('Bearer valid_jwt_token', mockSupabase);
  assert.equal(res.error, null);
  assert.ok(res.user);
  assert.equal(res.user.id, '11111111-2222-3333-4444-555555555555');
  assert.equal(res.user.email, 'admin@sinchods.test');
});

test('bootstrapUserWorkspace is safe to retry and returns existing workspace without duplication', async () => {
  const existingUserId = 'user-abc-123';
  const existingWorkspaceId = 'existing-workspace-uuid-999';

  const mockClient = {
    from: (table: string) => {
      assert.equal(table, 'workspace_members');
      return {
        select: () => ({
          eq: (col: string, val: string) => {
            assert.equal(col, 'user_id');
            assert.equal(val, existingUserId);
            return {
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      workspace_id: existingWorkspaceId,
                      role: 'owner',
                      created_at: '2026-01-01T00:00:00Z',
                    },
                  ],
                  error: null,
                }),
              }),
            };
          },
        }),
      };
    },
  };

  const result = await bootstrapUserWorkspace({
    userId: existingUserId,
    userClient: mockClient,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.workspaceId, existingWorkspaceId);
  assert.equal(result.role, 'owner');
  assert.equal(result.isNew, false);
});

test('bootstrapUserWorkspace creates new isolated workspace for new users and never assigns legacy workspace', async () => {
  const newUserId = 'new-user-777';
  let createdWorkspace: any = null;
  let createdMember: any = null;

  const mockClient = {
    from: (table: string) => {
      if (table === 'workspace_members') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
          insert: async (payload: any) => {
            createdMember = payload;
            return { error: null };
          },
        };
      }
      if (table === 'workspaces') {
        return {
          insert: async (payload: any) => {
            createdWorkspace = payload;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const result = await bootstrapUserWorkspace({
    userId: newUserId,
    workspaceName: 'Acme Dropship',
    userClient: mockClient,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.isNew, true);
  assert.equal(result.role, 'owner');
  assert.notEqual(result.workspaceId, LEGACY_WORKSPACE_ID);
  assert.ok(createdWorkspace);
  assert.equal(createdWorkspace.name, 'Acme Dropship');
  assert.equal(createdWorkspace.created_by, newUserId);
  assert.ok(createdMember);
  assert.equal(createdMember.user_id, newUserId);
  assert.equal(createdMember.role, 'owner');
});

test('claimLegacyWorkspace rejects unauthenticated callers', async () => {
  const result = await claimLegacyWorkspace({
    userId: '',
    claimSecret: 'AnySecret',
    serverSecret: 'ServerSecret123',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.ok(result.error?.includes('Authentication required'));
});

test('claimLegacyWorkspace rejects when server secret is unconfigured', async () => {
  const result = await claimLegacyWorkspace({
    userId: 'user-123',
    claimSecret: 'AnySecret',
    serverSecret: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.ok(result.error?.includes('No claim secret is configured on the server'));
});

test('claimLegacyWorkspace rejects missing or invalid claim secrets', async () => {
  const serverSecret = 'ServerSuperSecret2026!';

  // Empty secret
  const emptyRes = await claimLegacyWorkspace({
    userId: 'user-123',
    claimSecret: '',
    serverSecret,
  });
  assert.equal(emptyRes.ok, false);
  assert.equal(emptyRes.status, 400);

  // Wrong secret
  const wrongRes = await claimLegacyWorkspace({
    userId: 'user-123',
    claimSecret: 'WrongSecretGuess',
    serverSecret,
  });
  assert.equal(wrongRes.ok, false);
  assert.equal(wrongRes.status, 403);
  assert.ok(wrongRes.error?.includes('Access Denied'));
});

test('claimLegacyWorkspace enforces that caller cannot choose another user’s ownership', async () => {
  const authenticatedUserId = 'user-owner-authorized';
  const serverSecret = 'ServerSuperSecret2026!';
  let rpcTargetOwnerId: string | null = null;

  const mockServiceClient = {
    from: () => ({
      upsert: async () => ({ error: null }),
    }),
    rpc: async (fnName: string, args: any) => {
      assert.equal(fnName, 'claim_legacy_workspace');
      rpcTargetOwnerId = args.target_owner_id;
      return { data: LEGACY_WORKSPACE_ID, error: null };
    },
  };

  const result = await claimLegacyWorkspace({
    userId: authenticatedUserId,
    claimSecret: serverSecret,
    serverSecret,
    serviceClient: mockServiceClient,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.workspaceId, LEGACY_WORKSPACE_ID);
  assert.equal(rpcTargetOwnerId, authenticatedUserId);
});

test('claimLegacyWorkspace handles repeated attempt gracefully when already claimed (409 Conflict)', async () => {
  const authenticatedUserId = 'user-owner-authorized';
  const serverSecret = 'ServerSuperSecret2026!';

  const mockServiceClient = {
    from: () => ({
      upsert: async () => ({ error: null }),
    }),
    rpc: async (fnName: string) => {
      assert.equal(fnName, 'claim_legacy_workspace');
      return {
        data: null,
        error: { message: 'Access Denied: The legacy workspace has already been claimed and locked.' },
      };
    },
  };

  const result = await claimLegacyWorkspace({
    userId: authenticatedUserId,
    claimSecret: serverSecret,
    serverSecret,
    serviceClient: mockServiceClient,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.ok(result.error?.includes('already been claimed and locked'));
});

test('Express handlers reject unauthenticated requests and protect secrets', async () => {
  // Test handleBootstrapWorkspace 401
  let bootstrapStatusCode = 0;
  let bootstrapJson: any = null;
  const mockReq1 = { headers: {} } as any;
  const mockRes1 = {
    status: (code: number) => {
      bootstrapStatusCode = code;
      return mockRes1;
    },
    json: (data: any) => {
      bootstrapJson = data;
    },
  } as any;

  await handleBootstrapWorkspace(mockReq1, mockRes1);
  assert.equal(bootstrapStatusCode, 401);
  assert.equal(bootstrapJson.ok, false);

  // Test handleClaimLegacyWorkspace 401
  let claimStatusCode = 0;
  let claimJson: any = null;
  const mockReq2 = { headers: {}, body: {} } as any;
  const mockRes2 = {
    status: (code: number) => {
      claimStatusCode = code;
      return mockRes2;
    },
    json: (data: any) => {
      claimJson = data;
    },
  } as any;

  await handleClaimLegacyWorkspace(mockReq2, mockRes2);
  assert.equal(claimStatusCode, 401);
  assert.equal(claimJson.ok, false);

  // Verify that secrets or service keys are never leaked
  const jsonString = JSON.stringify(bootstrapJson) + JSON.stringify(claimJson);
  assert.equal(jsonString.includes('service_role'), false);
  assert.equal(jsonString.includes('secret_value'), false);
});
