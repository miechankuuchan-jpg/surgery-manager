-- This event-trigger helper only needs database-internal execution.
-- Keep it unavailable through the public API roles.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
