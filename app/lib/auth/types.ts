export type AuthUser = {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
};

export type OAuthProvider = 'google' | 'apple';
