create type "public"."status" as enum ('online', 'offline', 'away');


  create table "public"."ig_bio" (
    "bio_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "content" text
      );



  create table "public"."user_status" (
    "user_status_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "status" public.status not null
      );



  create table "public"."users" (
    "user_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "clerk_user_id" text not null default (auth.jwt() ->> 'sub'::text)
      );


CREATE UNIQUE INDEX ig_bio_pkey ON public.ig_bio USING btree (bio_id);

CREATE UNIQUE INDEX user_status_pkey ON public.user_status USING btree (user_status_id);

CREATE UNIQUE INDEX users_pkey ON public.users USING btree (user_id);

alter table "public"."ig_bio" add constraint "ig_bio_pkey" PRIMARY KEY using index "ig_bio_pkey";

alter table "public"."user_status" add constraint "user_status_pkey" PRIMARY KEY using index "user_status_pkey";

alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";

alter table "public"."ig_bio" add constraint "ig_bio_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) not valid;

alter table "public"."ig_bio" validate constraint "ig_bio_user_id_fkey";

alter table "public"."user_status" add constraint "user_status_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) not valid;

alter table "public"."user_status" validate constraint "user_status_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_owner()
 RETURNS TABLE(owner_id uuid)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    v_clerk_user_id TEXT := (SELECT auth.jwt() ->> 'sub');
    v_user_id       UUID;
BEGIN
    SELECT u.user_id
    INTO v_user_id
    FROM public.users AS u
    WHERE u.clerk_user_id = v_clerk_user_id
    LIMIT 1;

    IF v_user_id IS NULL THEN
        INSERT INTO public.users (clerk_user_id) VALUES (v_clerk_user_id);
    END IF;

    RETURN QUERY
        SELECT user_id AS owner_id
        FROM public.users
        WHERE clerk_user_id = v_clerk_user_id
        LIMIT 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_tk()
 RETURNS TABLE(jwt jsonb)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    RETURN QUERY
        SELECT auth.jwt() AS jwt;
END;
$function$
;

grant delete on table "public"."ig_bio" to "anon";

grant insert on table "public"."ig_bio" to "anon";

grant references on table "public"."ig_bio" to "anon";

grant select on table "public"."ig_bio" to "anon";

grant trigger on table "public"."ig_bio" to "anon";

grant truncate on table "public"."ig_bio" to "anon";

grant update on table "public"."ig_bio" to "anon";

grant delete on table "public"."ig_bio" to "authenticated";

grant insert on table "public"."ig_bio" to "authenticated";

grant references on table "public"."ig_bio" to "authenticated";

grant select on table "public"."ig_bio" to "authenticated";

grant trigger on table "public"."ig_bio" to "authenticated";

grant truncate on table "public"."ig_bio" to "authenticated";

grant update on table "public"."ig_bio" to "authenticated";

grant delete on table "public"."ig_bio" to "service_role";

grant insert on table "public"."ig_bio" to "service_role";

grant references on table "public"."ig_bio" to "service_role";

grant select on table "public"."ig_bio" to "service_role";

grant trigger on table "public"."ig_bio" to "service_role";

grant truncate on table "public"."ig_bio" to "service_role";

grant update on table "public"."ig_bio" to "service_role";

grant delete on table "public"."user_status" to "anon";

grant insert on table "public"."user_status" to "anon";

grant references on table "public"."user_status" to "anon";

grant select on table "public"."user_status" to "anon";

grant trigger on table "public"."user_status" to "anon";

grant truncate on table "public"."user_status" to "anon";

grant update on table "public"."user_status" to "anon";

grant delete on table "public"."user_status" to "authenticated";

grant insert on table "public"."user_status" to "authenticated";

grant references on table "public"."user_status" to "authenticated";

grant select on table "public"."user_status" to "authenticated";

grant trigger on table "public"."user_status" to "authenticated";

grant truncate on table "public"."user_status" to "authenticated";

grant update on table "public"."user_status" to "authenticated";

grant delete on table "public"."user_status" to "service_role";

grant insert on table "public"."user_status" to "service_role";

grant references on table "public"."user_status" to "service_role";

grant select on table "public"."user_status" to "service_role";

grant trigger on table "public"."user_status" to "service_role";

grant truncate on table "public"."user_status" to "service_role";

grant update on table "public"."user_status" to "service_role";

grant delete on table "public"."users" to "anon";

grant insert on table "public"."users" to "anon";

grant references on table "public"."users" to "anon";

grant select on table "public"."users" to "anon";

grant trigger on table "public"."users" to "anon";

grant truncate on table "public"."users" to "anon";

grant update on table "public"."users" to "anon";

grant delete on table "public"."users" to "authenticated";

grant insert on table "public"."users" to "authenticated";

grant references on table "public"."users" to "authenticated";

grant select on table "public"."users" to "authenticated";

grant trigger on table "public"."users" to "authenticated";

grant truncate on table "public"."users" to "authenticated";

grant update on table "public"."users" to "authenticated";

grant delete on table "public"."users" to "service_role";

grant insert on table "public"."users" to "service_role";

grant references on table "public"."users" to "service_role";

grant select on table "public"."users" to "service_role";

grant trigger on table "public"."users" to "service_role";

grant truncate on table "public"."users" to "service_role";

grant update on table "public"."users" to "service_role";


  create policy "objects_delete_policy"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((owner_id)::uuid IN ( SELECT public.get_owner() AS get_owner)));



  create policy "objects_insert_policy"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((owner_id)::uuid IN ( SELECT public.get_owner() AS get_owner)));



  create policy "objects_select_policy"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((owner_id)::uuid IN ( SELECT public.get_owner() AS get_owner)));



  create policy "objects_update_policy"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((owner_id)::uuid IN ( SELECT public.get_owner() AS get_owner)));



