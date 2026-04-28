import { OAuth2Manager, type OAuth2IntegrationInputs } from '@/auth/managers/oauth2Manager';
import { config } from '@/config';

let instance: OAuth2Manager | null = null;

export function getOAuth2Manager(): OAuth2Manager {
  instance ??= (() => {
    const managerConfig: OAuth2IntegrationInputs = {
      redirectBaseUri: config.oauthRedirectUri ?? 'http://localhost:3000',
      providers: [
        {
          name: 'google',
          clientId: config.googleClientId ?? '',
          clientSecret: config.googleClientSecret ?? '',
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
          scopes: ['openid', 'email', 'profile'],
        },
        {
          name: 'github',
          clientId: config.githubClientId ?? '',
          clientSecret: config.githubClientSecret ?? '',
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userinfoUrl: 'https://api.github.com/user',
          scopes: ['user:email', 'read:user'],
        },
      ],
    };
    return new OAuth2Manager(managerConfig);
  })();
  return instance;
}
