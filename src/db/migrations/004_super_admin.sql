-- Execute manualmente: psql $DATABASE_URL -f src/db/migrations/004_super_admin.sql

UPDATE users SET role = 'super_admin' WHERE email = 'tiago@vitissouls.com';

INSERT INTO users (email, role) VALUES ('brenoaugusto@vitissouls.com', 'super_admin')
ON CONFLICT (email) DO UPDATE SET role = 'super_admin';

UPDATE users SET role = 'user' WHERE email = 'brenoaugustoalves@gmail.com';
