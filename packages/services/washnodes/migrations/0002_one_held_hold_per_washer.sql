-- The durable store reserves the washer before inserting this row. Keep the same invariant in the hold table.
create unique index holds_one_held_per_washer on holds (washer_id) where state = 'held';
