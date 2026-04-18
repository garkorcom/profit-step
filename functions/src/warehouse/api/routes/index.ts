/**
 * Barrel export for all warehouse routes.
 *
 * Combined into a single Express router so agentApi only needs one import.
 */

import { Router } from 'express';
import documents from './documents';
import balances from './balances';
import ledger from './ledger';
import items from './items';
import locations from './locations';
import norms from './norms';
import agent from './agent';
import rfqInbound from './rfqInbound';

const warehouseRouter = Router();
warehouseRouter.use(documents);
warehouseRouter.use(balances);
warehouseRouter.use(ledger);
warehouseRouter.use(items);
warehouseRouter.use(locations);
warehouseRouter.use(norms);
warehouseRouter.use(agent);
warehouseRouter.use(rfqInbound);

export default warehouseRouter;
