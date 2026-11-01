-- Allow users to record free shares received as stock dividends.
-- Existing holdings and trade rows remain unchanged.
alter table public.holdings
  drop constraint if exists holdings_average_cost_check;
alter table public.holdings
  add constraint holdings_average_cost_check check (average_cost >= 0);

alter table public.trades
  drop constraint if exists trades_side_check;
alter table public.trades
  add constraint trades_side_check check (side in ('buy', 'sell', 'stock_dividend'));

alter table public.trades
  drop constraint if exists trades_execution_price_check;
alter table public.trades
  add constraint trades_execution_price_check check (
    (side = 'stock_dividend' and execution_price = 0)
    or (side in ('buy', 'sell') and execution_price > 0)
  );
