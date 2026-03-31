create type "public"."status" as enum ('online', 'offline', 'away');


  create table "public"."ig_bio" (
    "bio_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "content" text
      );



  create table "public"."ig_followers" (
    "hashtag_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "leader_id" uuid not null
      );



  create table "public"."ig_hashtags" (
    "hashtag_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "hashtag_name" character varying(24) not null,
    "created_by" uuid not null
      );



  create table "public"."ig_mentions" (
    "mention_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "post_id" uuid not null,
    "post_comment_id" uuid
      );



  create table "public"."ig_post_attachment_info" (
    "post_attachment_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "post_id" uuid not null,
    "bucket_id" text default 'ig_post_attachments'::text,
    "object_id" uuid
      );



  create table "public"."ig_post_comment_attachment_info" (
    "comment_attachment_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "post_comment_id" uuid not null,
    "bucket_id" text default 'ig_post_comment_attachments'::text,
    "object_id" uuid
      );



  create table "public"."ig_post_comment_likes" (
    "post_comment_like_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "post_comment_id" uuid not null
      );



  create table "public"."ig_post_comment_text_content" (
    "post_comment_text_content_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "post_comment_id" uuid not null,
    "text_content" text
      );



  create table "public"."ig_post_comments" (
    "post_comment_id" uuid not null default gen_random_uuid(),
    "post_id" uuid,
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "is_deleted" boolean not null default false,
    "deleted_at" timestamp with time zone
      );



  create table "public"."ig_post_likes" (
    "post_like_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "post_id" uuid not null
      );



  create table "public"."ig_post_text_content" (
    "post_content_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "post_id" uuid not null,
    "text_content" text
      );



  create table "public"."ig_posts" (
    "post_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "is_deleted" boolean not null default false,
    "deleted_at" timestamp with time zone
      );



  create table "public"."ig_user_post_hashtag" (
    "user_hashtag_id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "hashtag_id" uuid not null,
    "post_id" uuid not null,
    "post_comment_id" uuid
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

CREATE UNIQUE INDEX ig_followers_pkey ON public.ig_followers USING btree (hashtag_id);

CREATE UNIQUE INDEX ig_followers_user_id_leader_id_key ON public.ig_followers USING btree (user_id, leader_id);

CREATE UNIQUE INDEX ig_hashtags_hashtag_name_created_by_key ON public.ig_hashtags USING btree (hashtag_name, created_by);

CREATE UNIQUE INDEX ig_hashtags_hashtag_name_key ON public.ig_hashtags USING btree (hashtag_name);

CREATE UNIQUE INDEX ig_hashtags_pkey ON public.ig_hashtags USING btree (hashtag_id);

CREATE UNIQUE INDEX ig_mentions_pkey ON public.ig_mentions USING btree (mention_id);

CREATE UNIQUE INDEX ig_mentions_user_id_post_id_post_comment_id_key ON public.ig_mentions USING btree (user_id, post_id, post_comment_id);

CREATE UNIQUE INDEX ig_post_attachment_info_pkey ON public.ig_post_attachment_info USING btree (post_attachment_id);

CREATE UNIQUE INDEX ig_post_comment_attachment_info_pkey ON public.ig_post_comment_attachment_info USING btree (comment_attachment_id);

CREATE UNIQUE INDEX ig_post_comment_likes_pkey ON public.ig_post_comment_likes USING btree (post_comment_like_id);

CREATE UNIQUE INDEX ig_post_comment_likes_user_id_post_comment_id_key ON public.ig_post_comment_likes USING btree (user_id, post_comment_id);

CREATE UNIQUE INDEX ig_post_comment_text_content_pkey ON public.ig_post_comment_text_content USING btree (post_comment_text_content_id);

CREATE UNIQUE INDEX ig_post_comments_pkey ON public.ig_post_comments USING btree (post_comment_id);

CREATE UNIQUE INDEX ig_post_likes_pkey ON public.ig_post_likes USING btree (post_like_id);

CREATE UNIQUE INDEX ig_post_likes_user_id_post_id_key ON public.ig_post_likes USING btree (user_id, post_id);

CREATE UNIQUE INDEX ig_post_text_content_pkey ON public.ig_post_text_content USING btree (post_content_id);

CREATE UNIQUE INDEX ig_posts_pkey ON public.ig_posts USING btree (post_id);

CREATE UNIQUE INDEX ig_user_post_hashtag_hashtag_id_post_id_post_comment_id_key ON public.ig_user_post_hashtag USING btree (hashtag_id, post_id, post_comment_id);

CREATE UNIQUE INDEX ig_user_post_hashtag_pkey ON public.ig_user_post_hashtag USING btree (user_hashtag_id);

CREATE UNIQUE INDEX user_status_pkey ON public.user_status USING btree (user_status_id);

CREATE UNIQUE INDEX users_pkey ON public.users USING btree (user_id);

alter table "public"."ig_bio" add constraint "ig_bio_pkey" PRIMARY KEY using index "ig_bio_pkey";

alter table "public"."ig_followers" add constraint "ig_followers_pkey" PRIMARY KEY using index "ig_followers_pkey";

alter table "public"."ig_hashtags" add constraint "ig_hashtags_pkey" PRIMARY KEY using index "ig_hashtags_pkey";

alter table "public"."ig_mentions" add constraint "ig_mentions_pkey" PRIMARY KEY using index "ig_mentions_pkey";

alter table "public"."ig_post_attachment_info" add constraint "ig_post_attachment_info_pkey" PRIMARY KEY using index "ig_post_attachment_info_pkey";

alter table "public"."ig_post_comment_attachment_info" add constraint "ig_post_comment_attachment_info_pkey" PRIMARY KEY using index "ig_post_comment_attachment_info_pkey";

alter table "public"."ig_post_comment_likes" add constraint "ig_post_comment_likes_pkey" PRIMARY KEY using index "ig_post_comment_likes_pkey";

alter table "public"."ig_post_comment_text_content" add constraint "ig_post_comment_text_content_pkey" PRIMARY KEY using index "ig_post_comment_text_content_pkey";

alter table "public"."ig_post_comments" add constraint "ig_post_comments_pkey" PRIMARY KEY using index "ig_post_comments_pkey";

alter table "public"."ig_post_likes" add constraint "ig_post_likes_pkey" PRIMARY KEY using index "ig_post_likes_pkey";

alter table "public"."ig_post_text_content" add constraint "ig_post_text_content_pkey" PRIMARY KEY using index "ig_post_text_content_pkey";

alter table "public"."ig_posts" add constraint "ig_posts_pkey" PRIMARY KEY using index "ig_posts_pkey";

alter table "public"."ig_user_post_hashtag" add constraint "ig_user_post_hashtag_pkey" PRIMARY KEY using index "ig_user_post_hashtag_pkey";

alter table "public"."user_status" add constraint "user_status_pkey" PRIMARY KEY using index "user_status_pkey";

alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";

alter table "public"."ig_bio" add constraint "ig_bio_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."ig_bio" validate constraint "ig_bio_user_id_fkey";

alter table "public"."ig_followers" add constraint "ig_followers_check" CHECK ((leader_id <> user_id)) not valid;

alter table "public"."ig_followers" validate constraint "ig_followers_check";

alter table "public"."ig_followers" add constraint "ig_followers_leader_id_fkey" FOREIGN KEY (leader_id) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."ig_followers" validate constraint "ig_followers_leader_id_fkey";

alter table "public"."ig_followers" add constraint "ig_followers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."ig_followers" validate constraint "ig_followers_user_id_fkey";

alter table "public"."ig_followers" add constraint "ig_followers_user_id_leader_id_key" UNIQUE using index "ig_followers_user_id_leader_id_key";

alter table "public"."ig_hashtags" add constraint "ig_hashtags_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."ig_hashtags" validate constraint "ig_hashtags_created_by_fkey";

alter table "public"."ig_hashtags" add constraint "ig_hashtags_hashtag_name_created_by_key" UNIQUE using index "ig_hashtags_hashtag_name_created_by_key";

alter table "public"."ig_hashtags" add constraint "ig_hashtags_hashtag_name_key" UNIQUE using index "ig_hashtags_hashtag_name_key";

alter table "public"."ig_mentions" add constraint "ig_mentions_post_comment_id_fkey" FOREIGN KEY (post_comment_id) REFERENCES public.ig_post_comments(post_comment_id) ON DELETE CASCADE not valid;

alter table "public"."ig_mentions" validate constraint "ig_mentions_post_comment_id_fkey";

alter table "public"."ig_mentions" add constraint "ig_mentions_post_id_fkey" FOREIGN KEY (post_id) REFERENCES public.ig_posts(post_id) ON DELETE CASCADE not valid;

alter table "public"."ig_mentions" validate constraint "ig_mentions_post_id_fkey";

alter table "public"."ig_mentions" add constraint "ig_mentions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."ig_mentions" validate constraint "ig_mentions_user_id_fkey";

alter table "public"."ig_mentions" add constraint "ig_mentions_user_id_post_id_post_comment_id_key" UNIQUE using index "ig_mentions_user_id_post_id_post_comment_id_key";

alter table "public"."ig_post_attachment_info" add constraint "ig_post_attachment_info_bucket_id_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_attachment_info" validate constraint "ig_post_attachment_info_bucket_id_fkey";

alter table "public"."ig_post_attachment_info" add constraint "ig_post_attachment_info_object_id_fkey" FOREIGN KEY (object_id) REFERENCES storage.objects(id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_attachment_info" validate constraint "ig_post_attachment_info_object_id_fkey";

alter table "public"."ig_post_attachment_info" add constraint "ig_post_attachment_info_post_id_fkey" FOREIGN KEY (post_id) REFERENCES public.ig_posts(post_id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_attachment_info" validate constraint "ig_post_attachment_info_post_id_fkey";

alter table "public"."ig_post_comment_attachment_info" add constraint "ig_post_comment_attachment_info_bucket_id_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_comment_attachment_info" validate constraint "ig_post_comment_attachment_info_bucket_id_fkey";

alter table "public"."ig_post_comment_attachment_info" add constraint "ig_post_comment_attachment_info_object_id_fkey" FOREIGN KEY (object_id) REFERENCES storage.objects(id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_comment_attachment_info" validate constraint "ig_post_comment_attachment_info_object_id_fkey";

alter table "public"."ig_post_comment_attachment_info" add constraint "ig_post_comment_attachment_info_post_comment_id_fkey" FOREIGN KEY (post_comment_id) REFERENCES public.ig_post_comments(post_comment_id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_comment_attachment_info" validate constraint "ig_post_comment_attachment_info_post_comment_id_fkey";

alter table "public"."ig_post_comment_likes" add constraint "ig_post_comment_likes_post_comment_id_fkey" FOREIGN KEY (post_comment_id) REFERENCES public.ig_post_comments(post_comment_id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_comment_likes" validate constraint "ig_post_comment_likes_post_comment_id_fkey";

alter table "public"."ig_post_comment_likes" add constraint "ig_post_comment_likes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_comment_likes" validate constraint "ig_post_comment_likes_user_id_fkey";

alter table "public"."ig_post_comment_likes" add constraint "ig_post_comment_likes_user_id_post_comment_id_key" UNIQUE using index "ig_post_comment_likes_user_id_post_comment_id_key";

alter table "public"."ig_post_comment_text_content" add constraint "ig_post_comment_text_content_post_comment_id_fkey" FOREIGN KEY (post_comment_id) REFERENCES public.ig_post_comments(post_comment_id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_comment_text_content" validate constraint "ig_post_comment_text_content_post_comment_id_fkey";

alter table "public"."ig_post_comments" add constraint "ig_post_comments_check" CHECK (((is_deleted = false) OR (deleted_at IS NOT NULL))) not valid;

alter table "public"."ig_post_comments" validate constraint "ig_post_comments_check";

alter table "public"."ig_post_comments" add constraint "ig_post_comments_post_id_fkey" FOREIGN KEY (post_id) REFERENCES public.ig_posts(post_id) ON DELETE SET NULL not valid;

alter table "public"."ig_post_comments" validate constraint "ig_post_comments_post_id_fkey";

alter table "public"."ig_post_comments" add constraint "ig_post_comments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) not valid;

alter table "public"."ig_post_comments" validate constraint "ig_post_comments_user_id_fkey";

alter table "public"."ig_post_likes" add constraint "ig_post_likes_post_id_fkey" FOREIGN KEY (post_id) REFERENCES public.ig_posts(post_id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_likes" validate constraint "ig_post_likes_post_id_fkey";

alter table "public"."ig_post_likes" add constraint "ig_post_likes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."ig_post_likes" validate constraint "ig_post_likes_user_id_fkey";

alter table "public"."ig_post_likes" add constraint "ig_post_likes_user_id_post_id_key" UNIQUE using index "ig_post_likes_user_id_post_id_key";

alter table "public"."ig_post_text_content" add constraint "ig_post_text_content_post_id_fkey" FOREIGN KEY (post_id) REFERENCES public.ig_posts(post_id) not valid;

alter table "public"."ig_post_text_content" validate constraint "ig_post_text_content_post_id_fkey";

alter table "public"."ig_posts" add constraint "ig_posts_check" CHECK (((is_deleted = false) OR (deleted_at IS NOT NULL))) not valid;

alter table "public"."ig_posts" validate constraint "ig_posts_check";

alter table "public"."ig_posts" add constraint "ig_posts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."ig_posts" validate constraint "ig_posts_user_id_fkey";

alter table "public"."ig_user_post_hashtag" add constraint "ig_user_post_hashtag_hashtag_id_fkey" FOREIGN KEY (hashtag_id) REFERENCES public.ig_hashtags(hashtag_id) ON DELETE CASCADE not valid;

alter table "public"."ig_user_post_hashtag" validate constraint "ig_user_post_hashtag_hashtag_id_fkey";

alter table "public"."ig_user_post_hashtag" add constraint "ig_user_post_hashtag_hashtag_id_post_id_post_comment_id_key" UNIQUE using index "ig_user_post_hashtag_hashtag_id_post_id_post_comment_id_key";

alter table "public"."ig_user_post_hashtag" add constraint "ig_user_post_hashtag_post_comment_id_fkey" FOREIGN KEY (post_comment_id) REFERENCES public.ig_post_comments(post_comment_id) ON DELETE CASCADE not valid;

alter table "public"."ig_user_post_hashtag" validate constraint "ig_user_post_hashtag_post_comment_id_fkey";

alter table "public"."ig_user_post_hashtag" add constraint "ig_user_post_hashtag_post_id_fkey" FOREIGN KEY (post_id) REFERENCES public.ig_posts(post_id) ON DELETE CASCADE not valid;

alter table "public"."ig_user_post_hashtag" validate constraint "ig_user_post_hashtag_post_id_fkey";

alter table "public"."user_status" add constraint "user_status_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE not valid;

alter table "public"."user_status" validate constraint "user_status_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_owner()
 RETURNS TABLE(user_id uuid, clerk_user_id text)
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
        SELECT u1.user_id, u1.clerk_user_id
        FROM public.users AS u1
        WHERE u1.clerk_user_id = v_clerk_user_id
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

grant delete on table "public"."ig_followers" to "anon";

grant insert on table "public"."ig_followers" to "anon";

grant references on table "public"."ig_followers" to "anon";

grant select on table "public"."ig_followers" to "anon";

grant trigger on table "public"."ig_followers" to "anon";

grant truncate on table "public"."ig_followers" to "anon";

grant update on table "public"."ig_followers" to "anon";

grant delete on table "public"."ig_followers" to "authenticated";

grant insert on table "public"."ig_followers" to "authenticated";

grant references on table "public"."ig_followers" to "authenticated";

grant select on table "public"."ig_followers" to "authenticated";

grant trigger on table "public"."ig_followers" to "authenticated";

grant truncate on table "public"."ig_followers" to "authenticated";

grant update on table "public"."ig_followers" to "authenticated";

grant delete on table "public"."ig_followers" to "service_role";

grant insert on table "public"."ig_followers" to "service_role";

grant references on table "public"."ig_followers" to "service_role";

grant select on table "public"."ig_followers" to "service_role";

grant trigger on table "public"."ig_followers" to "service_role";

grant truncate on table "public"."ig_followers" to "service_role";

grant update on table "public"."ig_followers" to "service_role";

grant delete on table "public"."ig_hashtags" to "anon";

grant insert on table "public"."ig_hashtags" to "anon";

grant references on table "public"."ig_hashtags" to "anon";

grant select on table "public"."ig_hashtags" to "anon";

grant trigger on table "public"."ig_hashtags" to "anon";

grant truncate on table "public"."ig_hashtags" to "anon";

grant update on table "public"."ig_hashtags" to "anon";

grant delete on table "public"."ig_hashtags" to "authenticated";

grant insert on table "public"."ig_hashtags" to "authenticated";

grant references on table "public"."ig_hashtags" to "authenticated";

grant select on table "public"."ig_hashtags" to "authenticated";

grant trigger on table "public"."ig_hashtags" to "authenticated";

grant truncate on table "public"."ig_hashtags" to "authenticated";

grant update on table "public"."ig_hashtags" to "authenticated";

grant delete on table "public"."ig_hashtags" to "service_role";

grant insert on table "public"."ig_hashtags" to "service_role";

grant references on table "public"."ig_hashtags" to "service_role";

grant select on table "public"."ig_hashtags" to "service_role";

grant trigger on table "public"."ig_hashtags" to "service_role";

grant truncate on table "public"."ig_hashtags" to "service_role";

grant update on table "public"."ig_hashtags" to "service_role";

grant delete on table "public"."ig_mentions" to "anon";

grant insert on table "public"."ig_mentions" to "anon";

grant references on table "public"."ig_mentions" to "anon";

grant select on table "public"."ig_mentions" to "anon";

grant trigger on table "public"."ig_mentions" to "anon";

grant truncate on table "public"."ig_mentions" to "anon";

grant update on table "public"."ig_mentions" to "anon";

grant delete on table "public"."ig_mentions" to "authenticated";

grant insert on table "public"."ig_mentions" to "authenticated";

grant references on table "public"."ig_mentions" to "authenticated";

grant select on table "public"."ig_mentions" to "authenticated";

grant trigger on table "public"."ig_mentions" to "authenticated";

grant truncate on table "public"."ig_mentions" to "authenticated";

grant update on table "public"."ig_mentions" to "authenticated";

grant delete on table "public"."ig_mentions" to "service_role";

grant insert on table "public"."ig_mentions" to "service_role";

grant references on table "public"."ig_mentions" to "service_role";

grant select on table "public"."ig_mentions" to "service_role";

grant trigger on table "public"."ig_mentions" to "service_role";

grant truncate on table "public"."ig_mentions" to "service_role";

grant update on table "public"."ig_mentions" to "service_role";

grant delete on table "public"."ig_post_attachment_info" to "anon";

grant insert on table "public"."ig_post_attachment_info" to "anon";

grant references on table "public"."ig_post_attachment_info" to "anon";

grant select on table "public"."ig_post_attachment_info" to "anon";

grant trigger on table "public"."ig_post_attachment_info" to "anon";

grant truncate on table "public"."ig_post_attachment_info" to "anon";

grant update on table "public"."ig_post_attachment_info" to "anon";

grant delete on table "public"."ig_post_attachment_info" to "authenticated";

grant insert on table "public"."ig_post_attachment_info" to "authenticated";

grant references on table "public"."ig_post_attachment_info" to "authenticated";

grant select on table "public"."ig_post_attachment_info" to "authenticated";

grant trigger on table "public"."ig_post_attachment_info" to "authenticated";

grant truncate on table "public"."ig_post_attachment_info" to "authenticated";

grant update on table "public"."ig_post_attachment_info" to "authenticated";

grant delete on table "public"."ig_post_attachment_info" to "service_role";

grant insert on table "public"."ig_post_attachment_info" to "service_role";

grant references on table "public"."ig_post_attachment_info" to "service_role";

grant select on table "public"."ig_post_attachment_info" to "service_role";

grant trigger on table "public"."ig_post_attachment_info" to "service_role";

grant truncate on table "public"."ig_post_attachment_info" to "service_role";

grant update on table "public"."ig_post_attachment_info" to "service_role";

grant delete on table "public"."ig_post_comment_attachment_info" to "anon";

grant insert on table "public"."ig_post_comment_attachment_info" to "anon";

grant references on table "public"."ig_post_comment_attachment_info" to "anon";

grant select on table "public"."ig_post_comment_attachment_info" to "anon";

grant trigger on table "public"."ig_post_comment_attachment_info" to "anon";

grant truncate on table "public"."ig_post_comment_attachment_info" to "anon";

grant update on table "public"."ig_post_comment_attachment_info" to "anon";

grant delete on table "public"."ig_post_comment_attachment_info" to "authenticated";

grant insert on table "public"."ig_post_comment_attachment_info" to "authenticated";

grant references on table "public"."ig_post_comment_attachment_info" to "authenticated";

grant select on table "public"."ig_post_comment_attachment_info" to "authenticated";

grant trigger on table "public"."ig_post_comment_attachment_info" to "authenticated";

grant truncate on table "public"."ig_post_comment_attachment_info" to "authenticated";

grant update on table "public"."ig_post_comment_attachment_info" to "authenticated";

grant delete on table "public"."ig_post_comment_attachment_info" to "service_role";

grant insert on table "public"."ig_post_comment_attachment_info" to "service_role";

grant references on table "public"."ig_post_comment_attachment_info" to "service_role";

grant select on table "public"."ig_post_comment_attachment_info" to "service_role";

grant trigger on table "public"."ig_post_comment_attachment_info" to "service_role";

grant truncate on table "public"."ig_post_comment_attachment_info" to "service_role";

grant update on table "public"."ig_post_comment_attachment_info" to "service_role";

grant delete on table "public"."ig_post_comment_likes" to "anon";

grant insert on table "public"."ig_post_comment_likes" to "anon";

grant references on table "public"."ig_post_comment_likes" to "anon";

grant select on table "public"."ig_post_comment_likes" to "anon";

grant trigger on table "public"."ig_post_comment_likes" to "anon";

grant truncate on table "public"."ig_post_comment_likes" to "anon";

grant update on table "public"."ig_post_comment_likes" to "anon";

grant delete on table "public"."ig_post_comment_likes" to "authenticated";

grant insert on table "public"."ig_post_comment_likes" to "authenticated";

grant references on table "public"."ig_post_comment_likes" to "authenticated";

grant select on table "public"."ig_post_comment_likes" to "authenticated";

grant trigger on table "public"."ig_post_comment_likes" to "authenticated";

grant truncate on table "public"."ig_post_comment_likes" to "authenticated";

grant update on table "public"."ig_post_comment_likes" to "authenticated";

grant delete on table "public"."ig_post_comment_likes" to "service_role";

grant insert on table "public"."ig_post_comment_likes" to "service_role";

grant references on table "public"."ig_post_comment_likes" to "service_role";

grant select on table "public"."ig_post_comment_likes" to "service_role";

grant trigger on table "public"."ig_post_comment_likes" to "service_role";

grant truncate on table "public"."ig_post_comment_likes" to "service_role";

grant update on table "public"."ig_post_comment_likes" to "service_role";

grant delete on table "public"."ig_post_comment_text_content" to "anon";

grant insert on table "public"."ig_post_comment_text_content" to "anon";

grant references on table "public"."ig_post_comment_text_content" to "anon";

grant select on table "public"."ig_post_comment_text_content" to "anon";

grant trigger on table "public"."ig_post_comment_text_content" to "anon";

grant truncate on table "public"."ig_post_comment_text_content" to "anon";

grant update on table "public"."ig_post_comment_text_content" to "anon";

grant delete on table "public"."ig_post_comment_text_content" to "authenticated";

grant insert on table "public"."ig_post_comment_text_content" to "authenticated";

grant references on table "public"."ig_post_comment_text_content" to "authenticated";

grant select on table "public"."ig_post_comment_text_content" to "authenticated";

grant trigger on table "public"."ig_post_comment_text_content" to "authenticated";

grant truncate on table "public"."ig_post_comment_text_content" to "authenticated";

grant update on table "public"."ig_post_comment_text_content" to "authenticated";

grant delete on table "public"."ig_post_comment_text_content" to "service_role";

grant insert on table "public"."ig_post_comment_text_content" to "service_role";

grant references on table "public"."ig_post_comment_text_content" to "service_role";

grant select on table "public"."ig_post_comment_text_content" to "service_role";

grant trigger on table "public"."ig_post_comment_text_content" to "service_role";

grant truncate on table "public"."ig_post_comment_text_content" to "service_role";

grant update on table "public"."ig_post_comment_text_content" to "service_role";

grant delete on table "public"."ig_post_comments" to "anon";

grant insert on table "public"."ig_post_comments" to "anon";

grant references on table "public"."ig_post_comments" to "anon";

grant select on table "public"."ig_post_comments" to "anon";

grant trigger on table "public"."ig_post_comments" to "anon";

grant truncate on table "public"."ig_post_comments" to "anon";

grant update on table "public"."ig_post_comments" to "anon";

grant delete on table "public"."ig_post_comments" to "authenticated";

grant insert on table "public"."ig_post_comments" to "authenticated";

grant references on table "public"."ig_post_comments" to "authenticated";

grant select on table "public"."ig_post_comments" to "authenticated";

grant trigger on table "public"."ig_post_comments" to "authenticated";

grant truncate on table "public"."ig_post_comments" to "authenticated";

grant update on table "public"."ig_post_comments" to "authenticated";

grant delete on table "public"."ig_post_comments" to "service_role";

grant insert on table "public"."ig_post_comments" to "service_role";

grant references on table "public"."ig_post_comments" to "service_role";

grant select on table "public"."ig_post_comments" to "service_role";

grant trigger on table "public"."ig_post_comments" to "service_role";

grant truncate on table "public"."ig_post_comments" to "service_role";

grant update on table "public"."ig_post_comments" to "service_role";

grant delete on table "public"."ig_post_likes" to "anon";

grant insert on table "public"."ig_post_likes" to "anon";

grant references on table "public"."ig_post_likes" to "anon";

grant select on table "public"."ig_post_likes" to "anon";

grant trigger on table "public"."ig_post_likes" to "anon";

grant truncate on table "public"."ig_post_likes" to "anon";

grant update on table "public"."ig_post_likes" to "anon";

grant delete on table "public"."ig_post_likes" to "authenticated";

grant insert on table "public"."ig_post_likes" to "authenticated";

grant references on table "public"."ig_post_likes" to "authenticated";

grant select on table "public"."ig_post_likes" to "authenticated";

grant trigger on table "public"."ig_post_likes" to "authenticated";

grant truncate on table "public"."ig_post_likes" to "authenticated";

grant update on table "public"."ig_post_likes" to "authenticated";

grant delete on table "public"."ig_post_likes" to "service_role";

grant insert on table "public"."ig_post_likes" to "service_role";

grant references on table "public"."ig_post_likes" to "service_role";

grant select on table "public"."ig_post_likes" to "service_role";

grant trigger on table "public"."ig_post_likes" to "service_role";

grant truncate on table "public"."ig_post_likes" to "service_role";

grant update on table "public"."ig_post_likes" to "service_role";

grant delete on table "public"."ig_post_text_content" to "anon";

grant insert on table "public"."ig_post_text_content" to "anon";

grant references on table "public"."ig_post_text_content" to "anon";

grant select on table "public"."ig_post_text_content" to "anon";

grant trigger on table "public"."ig_post_text_content" to "anon";

grant truncate on table "public"."ig_post_text_content" to "anon";

grant update on table "public"."ig_post_text_content" to "anon";

grant delete on table "public"."ig_post_text_content" to "authenticated";

grant insert on table "public"."ig_post_text_content" to "authenticated";

grant references on table "public"."ig_post_text_content" to "authenticated";

grant select on table "public"."ig_post_text_content" to "authenticated";

grant trigger on table "public"."ig_post_text_content" to "authenticated";

grant truncate on table "public"."ig_post_text_content" to "authenticated";

grant update on table "public"."ig_post_text_content" to "authenticated";

grant delete on table "public"."ig_post_text_content" to "service_role";

grant insert on table "public"."ig_post_text_content" to "service_role";

grant references on table "public"."ig_post_text_content" to "service_role";

grant select on table "public"."ig_post_text_content" to "service_role";

grant trigger on table "public"."ig_post_text_content" to "service_role";

grant truncate on table "public"."ig_post_text_content" to "service_role";

grant update on table "public"."ig_post_text_content" to "service_role";

grant delete on table "public"."ig_posts" to "anon";

grant insert on table "public"."ig_posts" to "anon";

grant references on table "public"."ig_posts" to "anon";

grant select on table "public"."ig_posts" to "anon";

grant trigger on table "public"."ig_posts" to "anon";

grant truncate on table "public"."ig_posts" to "anon";

grant update on table "public"."ig_posts" to "anon";

grant delete on table "public"."ig_posts" to "authenticated";

grant insert on table "public"."ig_posts" to "authenticated";

grant references on table "public"."ig_posts" to "authenticated";

grant select on table "public"."ig_posts" to "authenticated";

grant trigger on table "public"."ig_posts" to "authenticated";

grant truncate on table "public"."ig_posts" to "authenticated";

grant update on table "public"."ig_posts" to "authenticated";

grant delete on table "public"."ig_posts" to "service_role";

grant insert on table "public"."ig_posts" to "service_role";

grant references on table "public"."ig_posts" to "service_role";

grant select on table "public"."ig_posts" to "service_role";

grant trigger on table "public"."ig_posts" to "service_role";

grant truncate on table "public"."ig_posts" to "service_role";

grant update on table "public"."ig_posts" to "service_role";

grant delete on table "public"."ig_user_post_hashtag" to "anon";

grant insert on table "public"."ig_user_post_hashtag" to "anon";

grant references on table "public"."ig_user_post_hashtag" to "anon";

grant select on table "public"."ig_user_post_hashtag" to "anon";

grant trigger on table "public"."ig_user_post_hashtag" to "anon";

grant truncate on table "public"."ig_user_post_hashtag" to "anon";

grant update on table "public"."ig_user_post_hashtag" to "anon";

grant delete on table "public"."ig_user_post_hashtag" to "authenticated";

grant insert on table "public"."ig_user_post_hashtag" to "authenticated";

grant references on table "public"."ig_user_post_hashtag" to "authenticated";

grant select on table "public"."ig_user_post_hashtag" to "authenticated";

grant trigger on table "public"."ig_user_post_hashtag" to "authenticated";

grant truncate on table "public"."ig_user_post_hashtag" to "authenticated";

grant update on table "public"."ig_user_post_hashtag" to "authenticated";

grant delete on table "public"."ig_user_post_hashtag" to "service_role";

grant insert on table "public"."ig_user_post_hashtag" to "service_role";

grant references on table "public"."ig_user_post_hashtag" to "service_role";

grant select on table "public"."ig_user_post_hashtag" to "service_role";

grant trigger on table "public"."ig_user_post_hashtag" to "service_role";

grant truncate on table "public"."ig_user_post_hashtag" to "service_role";

grant update on table "public"."ig_user_post_hashtag" to "service_role";

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
using (((auth.jwt() ->> 'role'::text) = 'authenticated'::text));



  create policy "objects_insert_policy"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((auth.jwt() ->> 'role'::text) = 'authenticated'::text));



  create policy "objects_select_policy"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((auth.jwt() ->> 'role'::text) = 'authenticated'::text));



  create policy "objects_update_policy"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((auth.jwt() ->> 'role'::text) = 'authenticated'::text));



