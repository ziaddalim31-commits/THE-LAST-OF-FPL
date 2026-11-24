-- THE LAST OF FPL — Chapter-scoped rematch policy
-- Run this migration manually in Supabase SQL Editor.
-- Existing match and player data is not modified.
--
-- New rule: rematches are blocked only when the previous match belongs
-- to the same chapter as the target gameweek. Matches from earlier
-- chapters are allowed.

create or replace function public.save_gameweek_fixtures(
    p_gameweek_id bigint,
    p_fixtures jsonb,
    p_bye_player_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_gw_number integer;
    v_gw_chapter text;
    v_gw_status text;
    v_active_count integer;
    v_fixture_count integer;
    v_expected_fixtures integer;
    v_bye_count integer;
    v_covered_count integer;
    v_inserted_count integer;
begin
    if jsonb_typeof(p_fixtures) is distinct from 'array' then
        raise exception 'INVALID_FIXTURE_PAYLOAD';
    end if;

    select gw_number, chapter, upper(status)
      into v_gw_number, v_gw_chapter, v_gw_status
      from public.gameweeks
     where id = p_gameweek_id
     for update;

    if not found then
        raise exception 'GAMEWEEK_NOT_FOUND';
    end if;
    if v_gw_status <> 'PENDING' then
        raise exception 'GAMEWEEK_NOT_PENDING';
    end if;

    if exists (select 1 from public.matches where gameweek_id = p_gameweek_id)
       or exists (select 1 from public.gameweek_byes where gameweek_id = p_gameweek_id) then
        raise exception 'FIXTURES_ALREADY_EXIST';
    end if;

    select count(*) into v_active_count
      from public.players
     where is_active = true and hearts > 0;

    select count(*) into v_fixture_count
      from jsonb_to_recordset(p_fixtures) as x(
          player_a_id bigint,
          player_b_id bigint
      );

    v_expected_fixtures := floor(v_active_count / 2.0)::integer;
    v_bye_count := case when p_bye_player_id is null then 0 else 1 end;

    if v_active_count < 2 or v_fixture_count <> v_expected_fixtures
       or v_bye_count <> (v_active_count % 2) then
        raise exception 'FIXTURE_ROSTER_COVERAGE_INVALID';
    end if;

    if exists (
        select 1
          from jsonb_to_recordset(p_fixtures) as x(
              player_a_id bigint,
              player_b_id bigint
          )
          left join public.players a on a.id = x.player_a_id
          left join public.players b on b.id = x.player_b_id
         where x.player_a_id is null or x.player_b_id is null
            or x.player_a_id = x.player_b_id
            or a.id is null or b.id is null
            or a.is_active is distinct from true or b.is_active is distinct from true
            or a.hearts <= 0 or b.hearts <= 0
    ) then
        raise exception 'FIXTURE_PLAYER_INVALID';
    end if;

    if (select count(distinct player_id)
          from (
              select player_a_id as player_id
                from jsonb_to_recordset(p_fixtures) as x(player_a_id bigint, player_b_id bigint)
              union all
              select player_b_id as player_id
                from jsonb_to_recordset(p_fixtures) as x(player_a_id bigint, player_b_id bigint)
              union all
              select p_bye_player_id where p_bye_player_id is not null
          ) all_players) <> v_active_count then
        raise exception 'FIXTURE_ROSTER_COVERAGE_INVALID';
    end if;

    if exists (
        select 1
          from (
              select player_a_id as player_id
                from jsonb_to_recordset(p_fixtures) as x(player_a_id bigint, player_b_id bigint)
              union all
              select player_b_id as player_id
                from jsonb_to_recordset(p_fixtures) as x(player_a_id bigint, player_b_id bigint)
              union all
              select p_bye_player_id where p_bye_player_id is not null
          ) covered
          left join public.players p on p.id = covered.player_id
         where p.id is null or p.is_active is distinct from true or p.hearts <= 0
    ) then
        raise exception 'BYE_PLAYER_NOT_ACTIVE';
    end if;

    if exists (
        select 1
          from jsonb_to_recordset(p_fixtures) as x(
              player_a_id bigint,
              player_b_id bigint
          )
          join public.matches old_match
            on old_match.gameweek_id <> p_gameweek_id
           and (
                (old_match.player_a_id = x.player_a_id and old_match.player_b_id = x.player_b_id)
                or
                (old_match.player_a_id = x.player_b_id and old_match.player_b_id = x.player_a_id)
           )
          join public.gameweeks old_gw on old_gw.id = old_match.gameweek_id
         where old_gw.gw_number < v_gw_number
           and upper(trim(coalesce(old_gw.chapter, ''))) = upper(trim(coalesce(v_gw_chapter, '')))
    ) then
        raise exception 'REMATCH_NOT_ALLOWED';
    end if;

    insert into public.matches (gameweek_id, player_a_id, player_b_id, status)
    select p_gameweek_id, x.player_a_id, x.player_b_id, 'PENDING'
      from jsonb_to_recordset(p_fixtures) as x(
          player_a_id bigint,
          player_b_id bigint
      );

    get diagnostics v_inserted_count = row_count;
    if v_inserted_count <> v_fixture_count then
        raise exception 'FIXTURE_INSERT_INCOMPLETE';
    end if;

    if p_bye_player_id is not null then
        insert into public.gameweek_byes (gameweek_id, player_id)
        values (p_gameweek_id, p_bye_player_id);
    end if;

    return jsonb_build_object(
        'success', true,
        'gameweek_id', p_gameweek_id,
        'matches_created', v_inserted_count,
        'bye_player_id', p_bye_player_id
    );
end;
$$;

revoke all on function public.save_gameweek_fixtures(bigint, jsonb, bigint) from public;
revoke all on function public.save_gameweek_fixtures(bigint, jsonb, bigint) from anon;
