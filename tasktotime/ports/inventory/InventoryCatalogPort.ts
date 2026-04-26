/**
 * InventoryCatalogPort — read-only access to `inventory_catalog/{itemId}`.
 *
 * See spec/04-storage/data-dependencies.md §inventory_catalog/{itemId}.
 * Resolves `Task.materials[].catalogItemId` to price + unit + stock.
 */

import type { CompanyId, CatalogItemId } from '../../domain/identifiers';

export interface CatalogItemSnapshot {
  id: CatalogItemId;
  companyId: CompanyId;
  name: string;
  category: string;
  /** 'pc', 'm', 'kg', ... */
  unit: string;
  lastPurchasePrice: number;
  avgPrice: number;
  clientMarkupPercent?: number;
  totalStock?: number;
}

export interface InventoryCatalogPort {
  findById(id: CatalogItemId): Promise<CatalogItemSnapshot | null>;
  findByIds(ids: CatalogItemId[]): Promise<CatalogItemSnapshot[]>;
  search(
    companyId: CompanyId,
    query: string,
    limit?: number,
  ): Promise<CatalogItemSnapshot[]>;
}
