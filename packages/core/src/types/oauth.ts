export interface OAuthProviderConfig {
  name: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl?: string;
  scopes: string[];
  scopeSeparator?: string;
}

export interface OAuth2IntegrationInputs {
  providers: OAuthProviderConfig[];
  redirectBaseUri: string;
  tokenRefreshBufferMinutes?: number;
}

export interface OAuth2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export interface OAuth2UserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  emailVerified?: boolean;
}
