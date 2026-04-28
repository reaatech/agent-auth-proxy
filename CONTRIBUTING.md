# Contributing to agent-auth-proxy

Thank you for your interest in contributing to agent-auth-proxy! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Security](#security)
- [License](#license)

## Code of Conduct

### Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, religion, or sexual identity
and orientation.

### Our Standards

Examples of behavior that contributes to a positive environment:

* Demonstrating empathy and kindness toward other people
* Being respectful of differing opinions, viewpoints, and experiences
* Giving and gracefully accepting constructive feedback
* Accepting responsibility and apologizing to those affected by our mistakes
* Focusing on what is best for the overall community

Examples of unacceptable behavior:

* The use of sexualized language or imagery, and sexual attention or advances
* Trolling, insulting or derogatory comments, and personal or political attacks
* Public or private harassment
* Publishing others' private information without explicit permission
* Other conduct which could reasonably be considered inappropriate

## Getting Started

### Prerequisites

- Node.js 20+ (LTS version recommended)
- pnpm 9+
- PostgreSQL 15+ (for development)
- Docker and Docker Compose (optional, for containerized development)
- Git

### Repository Structure

```
agent-auth-proxy/
├── src/                    # Source code
│   ├── api/               # API routes and middleware
│   ├── auth/              # Authentication strategies and managers
│   ├── config/            # Configuration files
│   ├── db/                # Database schema and migrations
│   ├── services/          # Business logic services
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── proxy/             # Proxy engine
├── tests/                 # Test files
├── docs/                  # Documentation
├── skills/                # Agent skills for development
├── scripts/               # Utility scripts
├── .github/               # GitHub workflows and templates
├── docker/                # Docker configuration
├── k8s/                   # Kubernetes manifests
└── package.json           # Project dependencies
```

## Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub (github.com/reaatech/agent-auth-proxy)

# Clone your fork
git clone https://github.com/<your-username>/agent-auth-proxy.git
cd agent-auth-proxy

# Add upstream remote
git remote add upstream https://github.com/reaatech/agent-auth-proxy.git
```

### 2. Install Dependencies

```bash
# Install pnpm if you haven't already
npm install -g pnpm

# Install dependencies
pnpm install
```

### 3. Set Up Environment

```bash
# Copy environment example
cp .env.example .env

# Edit .env with your configuration
# Required: Database URL, OAuth provider credentials
```

### 4. Set Up Database

```bash
# Using Docker (recommended)
docker-compose up -d db

# Or connect to your local PostgreSQL
# Update DATABASE_URL in .env

# Run migrations
pnpm db:migrate

# (Optional) Seed database with test data
pnpm db:seed
```

### 5. Start Development Server

```bash
# Start development server with hot reload
pnpm run dev

# Server will be available at http://localhost:3000
```

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, include:

* A clear, descriptive title
* Steps to reproduce the behavior
* Expected vs actual behavior
* Environment details (Node version, OS, database version)
* Any relevant logs or error messages

**Example:**
```markdown
**Title:** Token refresh fails with PostgreSQL 15

**Steps to Reproduce:**
1. Configure OAuth2 with Google
2. Complete authorization flow
3. Wait for token to expire
4. Attempt API call through proxy

**Expected:** Token should refresh automatically
**Actual:** 500 error with "connection timeout"

**Environment:**
- Node.js 20.10.0
- PostgreSQL 15.4
- macOS Ventura 13.5
```

### Suggesting Features

Feature suggestions are welcome! Please provide:

* Use case and motivation
* Proposed solution
* Alternatives considered
* Additional context

### Your First Code Contribution

Unsure where to start? Look for issues labeled:
- `good first issue` - Good for newcomers
- `help wanted` - Needs contribution
- `enhancement` - New features

## Coding Standards

### TypeScript

* Use strict mode (`strict: true` in tsconfig.json)
* Define explicit return types for functions
* Use interfaces for object shapes
* Prefer `const` over `let` where possible
* Use meaningful variable names

### Code Style

We use ESLint and Prettier to maintain consistent code style:

```bash
# Check code style
pnpm run lint

# Fix auto-fixable issues
pnpm run lint:fix

# Format code
pnpm run format

# Check formatting
pnpm run format:check
```

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add OAuth2 token caching
fix: resolve race condition in token refresh
docs: update API documentation
refactor: improve error handling in proxy engine
test: add integration tests for scope enforcement
chore: update dependencies
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Security Considerations

When writing code:

* Never log sensitive data (tokens, keys, passwords)
* Always validate and sanitize user input
* Use parameterized queries for database operations
* Implement proper error handling without leaking information
* Follow the principle of least privilege

## Testing

### Running Tests

```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run with coverage
pnpm run test:coverage

# Run security tests
pnpm run test:security
```

### Writing Tests

* Write tests for all new features and bug fixes
* Aim for >80% code coverage
* Include unit, integration, and security tests
* Use descriptive test names

**Example Test Structure:**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { OAuth2Manager } from '@/auth/managers/oauth2Manager';

describe('OAuth2Manager', () => {
  let oauth2Manager: OAuth2Manager;

  beforeEach(() => {
    oauth2Manager = new OAuth2Manager(testConfig);
  });

  describe('generatePKCE', () => {
    it('should generate valid PKCE parameters', () => {
      const { codeVerifier, codeChallenge, state } = oauth2Manager.generatePKCE();
      
      expect(codeVerifier).toHaveLength(43);
      expect(codeChallenge).toHaveLength(43);
      expect(state).toHaveLength(22);
    });
  });
});
```

## Pull Request Process

### Before Submitting

1. **Update Documentation**
   - Update README.md if user-facing changes
   - Add inline comments for complex logic
   - Update API documentation if endpoints change

2. **Add Tests**
   - Write tests for new functionality
   - Ensure all tests pass
   - Maintain or improve code coverage

3. **Check Code Quality**
   ```bash
   pnpm run lint
   pnpm run format
   pnpm run typecheck
   pnpm run test
   ```

4. **Update CHANGELOG.md**
   - Add entry under appropriate section
   - Include PR number and GitHub username

### Submitting PR

1. **Create Branch**
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Make Changes**
   - Follow coding standards
   - Write tests
   - Commit frequently with clear messages

3. **Push and Create PR**
   ```bash
   git push origin feat/your-feature-name
   ```

4. **Fill PR Template**
   - Describe changes
   - Link related issues
   - Add screenshots if UI changes
   - Checklist all completed items

### PR Review Process

1. **Automated Checks**
   - CI pipeline must pass
   - Code coverage requirements met
   - Security scans pass

2. **Code Review**
   - At least one maintainer approval required
   - Address all review comments
   - Request re-review after changes

3. **Merge**
   - Squash and merge for feature branches
   - Maintain clean commit history
   - Delete branch after merge

## Security

### Reporting Security Vulnerabilities

**DO NOT** create public issues for security vulnerabilities. Instead:

1. Email security@reaatech.dev
2. Include detailed description
3. Provide reproduction steps
4. Allow 48 hours for response

### Security Best Practices

When contributing:

* Never commit secrets or credentials
* Use environment variables for sensitive configuration
* Implement input validation and sanitization
* Follow OWASP guidelines
* Keep dependencies updated
* Use security scanning tools

## License

By contributing, you agree that your contributions will be licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and general discussion
- **Discord**: Join our community server (link in README)
- **Email**: contributors@reaatech.dev

## Recognition

Contributors will be recognized in:

- README.md contributors section
- GitHub Contributors graph
- Release notes for significant contributions
- Annual contributor appreciation

Thank you for contributing to agent-auth-proxy! 🎉
