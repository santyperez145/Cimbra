export type OrganizationRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type AssignableRole = Exclude<OrganizationRole, 'owner'>;

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
