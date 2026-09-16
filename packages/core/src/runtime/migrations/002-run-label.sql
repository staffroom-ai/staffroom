-- A run's name, separate from the instruction the agent was given.
--
-- Needed because a routine that catches up has to say so: "Catch-up: Morning
-- inbox summary" is what the owner should see, while the agent still receives
-- exactly the task they wrote. Putting the marker in the prompt would change
-- what the agent was asked to do.
--
-- Nullable, so every run already in the log stays valid and falls back to its
-- prompt, which is what it was showing before this column existed.
ALTER TABLE runs ADD COLUMN label TEXT;
