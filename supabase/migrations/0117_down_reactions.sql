-- 0117_down_reactions.sql -- undoes 0117_reactions.sql (every reaction is deleted).
--     begin; set local search_path to qa; \i 0117_down_reactions.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists item_reactions(text, uuid[]);
drop function if exists set_reaction(text, uuid, text);
drop function if exists reaction_ministry(text, uuid, uuid, boolean);
drop table if exists reactions;
