export type OrganizationRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type AssignableRole = Exclude<OrganizationRole, 'owner'>;

export const ACCESS_POLICY = {
  'console.read': ['owner', 'admin', 'operator', 'viewer'],
  'finance.write': ['owner', 'admin', 'operator'],
  'payouts.beneficiaries.manage': ['owner', 'admin'],
  'billers.manage': ['owner', 'admin'],
  'cards.program.manage': ['owner', 'admin'],
  'wallets.program.manage': ['owner', 'admin'],
  'compliance.write': ['owner', 'admin', 'operator'],
  'risk.cases.resolve': ['owner', 'admin', 'operator'],
  'risk.rules.manage': ['owner', 'admin'],
  'disputes.read': ['owner', 'admin', 'operator', 'viewer'],
  'disputes.write': ['owner', 'admin', 'operator'],
  'reconciliation.write': ['owner', 'admin', 'operator'],
  'operations.read': ['owner', 'admin', 'operator', 'viewer'],
  'operations.write': ['owner', 'admin', 'operator'],
  'approvals.read': ['owner', 'admin', 'operator', 'viewer'],
  'approvals.request': ['owner', 'admin', 'operator'],
  'approvals.decide': ['owner', 'admin'],
  'approvals.policy.manage': ['owner'],
  'organization.manage': ['owner', 'admin'],
  'credentials.manage': ['owner', 'admin'],
  'security.manage_self': ['owner', 'admin', 'operator', 'viewer'],
} as const satisfies Record<string, readonly OrganizationRole[]>;

export type AccessCapability = keyof typeof ACCESS_POLICY;

export const ROLE_PROFILES: Record<OrganizationRole, { label: string; posture: string; description: string }> = {
  owner: { label: 'Owner', posture: 'Gobierno total', description: 'Gobierna el tenant, la seguridad, las políticas, los accesos y toda la operación.' },
  admin: { label: 'Admin', posture: 'Administración delegada', description: 'Configura la organización y gestiona operadores y viewers sin desplazar al owner.' },
  operator: { label: 'Operator', posture: 'Operación controlada', description: 'Ejecuta y resuelve flujos operativos sin administrar credenciales ni privilegios.' },
  viewer: { label: 'Viewer', posture: 'Sólo lectura', description: 'Consulta operación, evidencia y auditoría sin acciones mutantes.' },
};

export function rolesFor(capability: AccessCapability): readonly OrganizationRole[] {
  return ACCESS_POLICY[capability];
}

export function roleCan(role: OrganizationRole, capability: AccessCapability) {
  return (ACCESS_POLICY[capability] as readonly OrganizationRole[]).includes(role);
}

export function normalizeAccessEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function assignableRole(value: unknown): AssignableRole | null {
  return value === 'admin' || value === 'operator' || value === 'viewer' ? value : null;
}

export function canManageRole(actorRole: 'owner' | 'admin', targetRole: OrganizationRole, nextRole?: AssignableRole) {
  if (targetRole === 'owner') return false;
  return actorRole === 'owner' || (targetRole !== 'admin' && nextRole !== 'admin');
}
