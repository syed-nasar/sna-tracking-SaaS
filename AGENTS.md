
# SNA Fleet Management SaaS — Codex Project Instructions

## 1. Project Overview

SNA Fleet Management is a multi-tenant GPS vehicle tracking SaaS developed by SNA Technologies.

The platform supports:
- Personal vehicle owners (B2C).
- Business fleet operators (B2B).
- SNA platform administrators.
- Tenant administrators, managers, and viewers.

The application integrates with Traccar for GPS tracking.

## 2. Technology Stack

Backend:
- Node.js, CommonJS, Express 5
- PostgreSQL 16
- JWT authentication
- bcryptjs
- Traccar GPS integration

Frontend:
- React
- Vite
- Tailwind CSS 4
- Leaflet maps

Development environment:
- Windows
- PowerShell
- VS Code

## 3. Project Structure

Root:
G:\Traccar-FleetManagement

Backend:
G:\Traccar-FleetManagement\backend

Frontend:
G:\Traccar-FleetManagement\frontend

Database migrations:
backend\database

Backend API:
http://127.0.0.1:3000/api

Frontend:
http://127.0.0.1:3001

Traccar:
http://localhost:8082

Database:
sna_fleet

## 4. Development Rules

1. Inspect existing files before modifying them.
2. Preserve existing functionality unless explicitly instructed otherwise.
3. Preserve the current folder structure.
4. Maintain strict tenant isolation.
5. Enforce authorization on the backend.
6. Never expose another tenant's data.
7. Preserve Personal and Business login functionality.
8. Preserve the existing platform administrator login.
9. Never expose passwords, JWT secrets, or credentials.
10. Never commit .env files or other secrets.
11. Avoid unnecessary refactoring.
12. Prefer complete, integrated implementations.
13. Complete an entire major development step before consolidated testing.
14. Do not interrupt development for routine testing after every substep.
15. Perform syntax and build checks when appropriate.
16. Do not delete or overwrite working code without understanding its purpose.
17. Do not execute destructive database operations without approval.
18. Do not commit or push changes without approval.
19. Explain architectural decisions concisely.
20. Use PowerShell-compatible commands.

## 5. Authentication and Authorization

Tenant roles:
- tenant_admin
- manager
- viewer

Tenant authentication uses JWT.

JWT settings:
- Algorithm: HS256
- Issuer: sna-fleet-api
- Audience: sna-fleet-users

Personal customers log in without a tenant slug.

Business customers log in with a tenant slug.

Platform administrators use separate authentication.

Authentication middleware checks:
- User existence
- User active status
- Tenant active status

Step 35 introduces token-version validation for session invalidation.

## 6. Multi-Tenant Requirements

All tenant-specific data must be isolated by tenant_id.

Never trust tenant_id supplied by the frontend for tenant-scoped operations.

Derive tenant identity from authenticated server-side context.

Prevent cross-tenant access to:
- Users
- Vehicles
- GPS devices
- Vehicle images
- Account information
- Tracking information

## 7. Customer Types

Personal:
- My Dashboard
- My Vehicles
- My Tracking
- My Account

Business:
- Fleet Dashboard
- Fleet Vehicles
- Live Fleet Tracking
- Company Account
- User Management

Customer type is stored in tenants.customer_type.

Allowed values:
- personal
- business

## 8. Completed Development

Completed:
- Core backend and PostgreSQL integration
- Traccar integration
- Platform authentication
- Multi-tenant authentication and isolation
- Tenant onboarding and invitations
- Vehicle management
- Vehicle image management
- Live GPS tracking map
- Personal and Business customer classification
- Customer-type-aware login
- Customer-type-aware dashboards
- Customer-type-aware vehicle pages
- Customer-type-aware navigation
- Customer-type-aware tracking pages
- GitHub repository initialization

Relevant migrations:
- 001 through 008
- 009_user_token_version.sql

## 9. Current Development — Step 35

Step 35: Customer Account Management.

Scope:
- JWT token-version enforcement
- Personal customer My Account
- Business customer Company Account
- Profile updates
- Password changes
- Session invalidation after password changes
- Business tenant user management
- Role-based access
- Tenant isolation
- Frontend account-management integration

Migration 009 adds users.token_version,
initialized to 0.

Before implementing Step 35, inspect the
actual current files to determine which
JWT changes are already applied.

Do not assume a proposed change has
already been implemented.

Complete Step 35 before consolidated
functional and integration testing.

## 10. Explicitly Deferred Work

Step 33.9.8:
Secure vehicle image management.

This work is intentionally postponed.

Pending requirements:
- Prevent arbitrary imageUrl/imageType assignment
  through general vehicle create/update APIs.
- Enforce tenant image ownership.
- Preserve images during vehicle edits.
- Ensure authorized image removal.

Do not implement this step unless explicitly requested.

## 11. Product Direction

SNA Technologies supplies:
- GPS tracking devices
- Installation
- SIM/data connectivity
- Fleet tracking SaaS
- Support and maintenance

Support both tracker sales and rentals.

Future capabilities may include:
- Subscription plans
- Device inventory
- SIM management
- White-label branding
- Enterprise deployments
- Licensing

Do not implement future features without instruction.

## 12. Testing and Delivery

Development should prioritize speed without
compromising tenant security or existing behavior.

For each major step:
1. Inspect the existing implementation.
2. Implement backend changes.
3. Implement database migrations if needed.
4. Implement frontend changes.
5. Integrate the functionality.
6. Run consolidated tests.
7. Fix identified defects.
8. Request approval before Git commit/push.

Report:
- Files created
- Files modified
- Features completed
- Tests performed
- Remaining risks or limitations
