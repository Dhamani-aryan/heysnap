# Cloud Server Database

The cloud server uses Postgres through Drizzle.

Default local database URL:

```sh
postgres://postgres:postgres@localhost:5432/ank1015_app
```

Create the local database if it does not exist:

```sh
PGPASSWORD=postgres createdb -h localhost -U postgres ank1015_app
```

Generate migrations after schema changes:

```sh
pnpm --filter @ank1015-app/cloud-server db:generate
```

Apply migrations:

```sh
pnpm --filter @ank1015-app/cloud-server db:migrate
```

Run the Postgres-backed smoke test:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ank1015_app \
SESSION_SECRET=postgres-test-session-secret \
pnpm --filter @ank1015-app/cloud-server test:db
```

Run the cloud server locally:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ank1015_app \
SESSION_SECRET=development-session-secret \
pnpm --filter @ank1015-app/cloud-server dev
```
