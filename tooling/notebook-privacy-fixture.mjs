const SHARED_KINDS = new Set(['source', 'conversation', 'artifact']);
const PRIVATE_KINDS = new Set(['memory', 'credential', 'node', 'defaultGrant']);

const deny = (code) => ({ allowed: false, code });

/**
 * 创建 Notebook 隐私研究夹具。
 * Membership 只授予共享资源可见性；个人 Agent 能力必须同时匹配可信 Actor 与 Agent owner。
 */
export const createNotebookPrivacyFixture = ({
  agents,
  memberships,
  sharedResources,
  privateResources,
}) => {
  const agentByActor = new Map(
    agents.map((agent) => [agent.ownerActorId, Object.freeze({ ...agent })]),
  );
  const memberKeys = new Set(
    memberships.map(
      (membership) => `${membership.notebookId}:${membership.actorId}`,
    ),
  );
  const sharedById = new Map(
    sharedResources.map((resource) => [
      resource.id,
      Object.freeze({ ...resource }),
    ]),
  );
  const privateById = new Map(
    privateResources.map((resource) => [
      resource.id,
      Object.freeze({ ...resource }),
    ]),
  );

  return Object.freeze({
    resolveAgent(actorId) {
      const agent = agentByActor.get(actorId);
      return agent ? { ...agent } : undefined;
    },

    readShared({ actorId, notebookId, kind, resourceId }) {
      if (!SHARED_KINDS.has(kind)) return deny('unsupported_shared_kind');
      if (!memberKeys.has(`${notebookId}:${actorId}`)) {
        return deny('notebook_membership_required');
      }
      const resource = sharedById.get(resourceId);
      if (!resource || resource.kind !== kind)
        return deny('resource_unavailable');
      if (resource.notebookId !== notebookId) {
        return deny('resource_notebook_mismatch');
      }
      return { allowed: true, resource: { ...resource } };
    },

    usePrivate({ actorId, agentId, kind, resourceId }) {
      if (!PRIVATE_KINDS.has(kind)) return deny('unsupported_private_kind');
      const trustedAgent = agentByActor.get(actorId);
      if (!trustedAgent || trustedAgent.id !== agentId) {
        return deny('actor_agent_mismatch');
      }
      const resource = privateById.get(resourceId);
      if (!resource || resource.kind !== kind) {
        return deny('private_capability_unavailable');
      }
      if (
        resource.ownerActorId !== actorId ||
        resource.ownerAgentId !== agentId
      ) {
        return deny('private_capability_owner_mismatch');
      }
      return { allowed: true, resource: { ...resource } };
    },
  });
};
