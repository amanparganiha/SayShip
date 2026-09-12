-- Runs once when the container's data volume is first created.
-- The main "promptship" database is created by POSTGRES_DB; tests get their own database.
CREATE DATABASE promptship_test OWNER promptship;
