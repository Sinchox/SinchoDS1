import type { Request, Response, NextFunction } from 'express';
import { verifyAuthUser, getWorkspaceConfig, createServiceRoleClient } from './workspace.js';

export type WorkspaceRole = 'viewer' | 'manager' | 'admin' | 'owner';

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  viewer: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

export function hasMinimumRole(userRole: string | undefined, requiredRole: WorkspaceRole): boolean {
  if (!userRole) return false;
  const userLevel = ROLE_HIERARCHY[userRole as WorkspaceRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] || 999;
  return userLevel >= requiredLevel;
}

export interface WorkspaceAuthContext {
  id: string;
  role: WorkspaceRole;
}

export interface AuthenticatedUserContext {
  id: string;
  email?: string;
}

export interface AuthenticatedWorkspaceRequest extends Request {
  user?: AuthenticatedUserContext;
  workspace?: WorkspaceAuthContext;
}

export interface WorkspaceMiddlewareOptions {
  minRole?: WorkspaceRole;
  allowedRoles?: WorkspaceRole[];
  mockMemberships?: Map<string, { workspaceId: string; role: WorkspaceRole }[]>;
}

// In-memory membership cache / registry for test environments and server tracking
export const inMemoryMemberships = new Map<string, { workspaceId: string; role: WorkspaceRole }[]>();

export function registerInMemoryMembership(userId: string, workspaceId: string, role: WorkspaceRole): void {
  const existing = inMemoryMemberships.get(userId) || [];
  const filtered = existing.filter((m) => m.workspaceId !== workspaceId);
  filtered.push({ workspaceId, role });
  inMemoryMemberships.set(userId, filtered);
}

export function clearInMemoryMemberships(): void {
  inMemoryMemberships.clear();
}

/**
 * Resolves user's membership for the requested workspace from Supabase or in-memory registry.
 * Strictly verifies that the user is an active member. Never trusts arbitrary client input.
 */
export async function resolveUserMembership(
  userId: string,
  requestedWorkspaceId?: string,
  customMemberships?: Map<string, { workspaceId: string; role: WorkspaceRole }[]>
): Promise<{ workspaceId: string; role: WorkspaceRole } | null> {
  const registry = customMemberships || inMemoryMemberships;
  const localList = registry.get(userId) || [];

  // Check Supabase if configured
  const config = getWorkspaceConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    try {
      const client = createServiceRoleClient(config.supabaseUrl, config.serviceRoleKey);
      if (client) {
        let query = client
          .from('workspace_members')
          .select('workspace_id, role, created_at')
          .eq('user_id', userId);

        if (requestedWorkspaceId) {
          query = query.eq('workspace_id', requestedWorkspaceId);
        } else {
          query = query.order('created_at', { ascending: true });
        }

        const { data, error } = await query.limit(1);
        if (!error && data && data.length > 0) {
          return {
            workspaceId: data[0].workspace_id,
            role: data[0].role as WorkspaceRole,
          };
        }
      }
    } catch {
      // Fallback to in-memory registry
    }
  }

  // Fallback to in-memory registry
  if (requestedWorkspaceId) {
    const match = localList.find((m) => m.workspaceId === requestedWorkspaceId);
    return match || null;
  }

  // If no workspace was explicitly requested, resolve user's primary membership
  if (localList.length > 0) {
    return localList[0];
  }

  return null;
}

/**
 * Express middleware that enforces:
 * 1. User authentication via verified Supabase JWT (returns 401 if missing/invalid).
 * 2. Workspace membership verification (returns 403 if user is not a verified member).
 * 3. Role-based permission checks (returns 403 if role is insufficient).
 * 4. Never falls back silently to the legacy default workspace.
 */
export function requireWorkspaceContext(options: WorkspaceMiddlewareOptions = {}) {
  const { minRole = 'viewer', allowedRoles, mockMemberships } = options;

  return async (req: AuthenticatedWorkspaceRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      const { user, error: authError } = await verifyAuthUser(authHeader);

      if (authError || !user) {
        res.status(401).json({
          ok: false,
          error: 'Unauthorized: A valid Supabase authentication token is required.',
          details: authError || undefined,
        });
        return;
      }

      req.user = user;

      // Identify requested workspace ID from header, params, query, or body
      const rawWorkspaceId = (
        (req.headers['x-workspace-id'] as string) ||
        req.params.workspaceId ||
        (req.query.workspace_id as string) ||
        req.body?.workspace_id ||
        ''
      ).trim();

      // Resolve and verify user's actual membership in the workspace
      const membership = await resolveUserMembership(user.id, rawWorkspaceId || undefined, mockMemberships);

      if (!membership) {
        if (rawWorkspaceId) {
          res.status(403).json({
            ok: false,
            error: 'Access Denied: You do not have permission to access the requested workspace.',
            workspaceId: rawWorkspaceId,
          });
          return;
        }

        res.status(403).json({
          ok: false,
          error: 'Access Denied: No accessible workspace found for this user. Please bootstrap or select a workspace.',
        });
        return;
      }

      // If client requested a specific workspace, verify it strictly matches their verified membership
      if (rawWorkspaceId && membership.workspaceId !== rawWorkspaceId) {
        res.status(403).json({
          ok: false,
          error: 'Access Denied: You are not a verified member of this workspace.',
          workspaceId: rawWorkspaceId,
        });
        return;
      }

      // Enforce role-based access control
      if (allowedRoles && allowedRoles.length > 0) {
        if (!allowedRoles.includes(membership.role)) {
          res.status(403).json({
            ok: false,
            error: `Access Denied: Workspace role '${membership.role}' is not authorized for this action. Allowed: ${allowedRoles.join(', ')}.`,
          });
          return;
        }
      } else if (minRole) {
        if (!hasMinimumRole(membership.role, minRole)) {
          res.status(403).json({
            ok: false,
            error: `Access Denied: Workspace role '${membership.role}' is insufficient. Required minimum role: '${minRole}'.`,
          });
          return;
        }
      }

      // Attach verified workspace context to request
      req.workspace = {
        id: membership.workspaceId,
        role: membership.role,
      };

      next();
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: 'Internal error resolving workspace authorization context.',
        details: err.message || String(err),
      });
    }
  };
}
