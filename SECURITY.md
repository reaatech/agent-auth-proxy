# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

**Do not create public issues for security vulnerabilities.**

Please report security vulnerabilities to: **security@reaatech.dev**

Include in your report:
- Detailed description of the vulnerability
- Steps to reproduce
- Affected versions
- Any potential mitigations you've identified

You will receive a response within 48 hours. Please allow up to 14 days for a fix to be developed and released.

## Security Model

The agent-auth-proxy is an identity-aware proxy that handles sensitive credentials:

- All OAuth tokens and API keys are encrypted at rest with AES-256-GCM
- Data encryption keys are derived per-user/provider using scrypt (N=16384)
- The master key must be provided as a base64-encoded 32-byte value
- Agent authentication uses short-lived JWTs (default: 1 hour)
- Admin API endpoints are protected by a pre-shared key with constant-time comparison
- Security-sensitive response headers are stripped from downstream responses
- Requests follow defense-in-depth with multiple validation layers

## Best Practices

1. **Master Key**: Generate a unique 32-byte key per deployment
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. **Admin API Key**: Use a strong random key (32+ bytes, base64url-encoded)
3. **Agent JWT Secret**: Rotate regularly and never commit to source control
4. **Database**: Run behind a firewall, use TLS for connections
5. **Deployment**: Front with a reverse proxy (nginx, ALB) for TLS termination

## Bug Bounty

We do not currently offer a bug bounty program. We appreciate responsible disclosure.
