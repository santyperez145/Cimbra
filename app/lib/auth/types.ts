export type AuthUser = {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
};

export type OAuthProvider = 'google' | 'apple';
