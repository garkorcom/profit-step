/**
 * @fileoverview Shopping Module Public API
 * 
 * Export all public components, hooks, types, and services.
 */

// Types
export * from './types';
export * from './constants';

// Hooks
export { useShoppingLists } from './hooks/useShoppingLists';
export { useClients } from './hooks/useClients';

// Services
export * from './services/shoppingService';

// Components
export { default as ShoppingItemRow } from './components/ShoppingItemRow';
export { default as ShoppingListCard } from './components/ShoppingListCard';
export { default as EditItemDialog } from './components/EditItemDialog';
export { default as SelectClientDialog } from './components/SelectClientDialog';

// Views
export { default as ShoppingTabView } from './views/ShoppingTabView';
