-- Training / test incident flag for analytics exclusion.
-- npm run db:migrate:v15
-- Does not rewrite history; defaults to 0 (operational).

ALTER TABLE incidents ADD COLUMN is_training INTEGER NOT NULL DEFAULT 0;

-- Mark the known audit test incident if present (AUTHORIZED AUDIT TEST).
UPDATE incidents
SET is_training = 1
WHERE id = 'df2903f1-ee96-49b9-983d-aac37424d85e'
   OR description LIKE '%AUTHORIZED AUDIT TEST%'
   OR description LIKE '%NO REAL EMERGENCY%';
