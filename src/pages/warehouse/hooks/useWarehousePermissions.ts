import { useMemo } from 'react';
import { useAuth } from '../../../auth/AuthContext';

export interface WarehousePermissions {
  canRead: boolean;
  canWriteCatalog: boolean;
  canCreateDocuments: boolean;
  canPostDocuments: boolean;
  canVoidPosted: boolean;
}

export function useWarehousePermissions(): WarehousePermissions {
  const { userProfile } = useAuth();

  return useMemo(() => {
    const role = userProfile?.role;
    const isAdmin = role === 'superadmin' || role === 'company_admin' || role === 'admin';
    const isManager = role === 'manager';

    return {
      canRead: !!userProfile,
      canWriteCatalog: isAdmin,
      canCreateDocuments: isAdmin || isManager,
      canPostDocuments: isAdmin || isManager,
      canVoidPosted: isAdmin,
    };
  }, [userProfile]);
}
