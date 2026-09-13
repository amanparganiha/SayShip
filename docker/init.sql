-- Runs once when the container's data volume is first created.
-- The main "sayship" database is created by POSTGRES_DB; tests get their own database.
CREATE DATABASE sayship_test OWNER sayship;
