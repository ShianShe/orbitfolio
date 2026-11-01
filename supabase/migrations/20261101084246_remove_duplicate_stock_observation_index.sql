-- The unique (user_id, symbol) constraint already provides this index.
drop index if exists public.stock_observations_user_idx;
