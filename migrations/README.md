# Migrations

Schema changes are made only by adding a new numbered file here (`0002_name.sql`, `0003_name.sql`, ...). Never edit a file that has already been applied. `scripts/migrate.mjs` applies each file not yet listed in `schema_migrations`, in name order, one transaction per file.

## Dev

Put the dev connection string in `.env` as `DATABASE_URL=...` (git-ignored), then:

```bash
node scripts/migrate.mjs
```

It reads `DATABASE_URL` from the environment first, then `.env`. It prints the name of each file it applies and never prints the connection string.

## Production (for the human only)

Agents must not run this, and must never ask for, store or paste the production connection string.

```bash
DATABASE_URL='<production connection string>' node scripts/migrate.mjs
```
