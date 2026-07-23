import 'server-only';

import {
  DrizzleChatRepository,
  DrizzleKnowledgeRetrievalRepository,
  DrizzleTeachingTurnLedger,
  DrizzleTurnLeaseRepository,
  DrizzleTurnSafetyDecisionRepository,
} from '@educanvas/db';

const ledger = new DrizzleTeachingTurnLedger();
const chat = new DrizzleChatRepository();
const leases = new DrizzleTurnLeaseRepository();
const safetyDecisions = new DrizzleTurnSafetyDecisionRepository();
const knowledge = new DrizzleKnowledgeRetrievalRepository();

/** Web 教学 Turn 的进程级持久化单例；拆分模块共享原有账本与仓储实例。 */
export const webTeachingPersistence = {
  ledger,
  chat,
  leases,
  safetyDecisions,
  knowledge,
};
