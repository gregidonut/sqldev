-- Canonical audited application-data reset for the SQLDev E2E harness.
--
-- This single file is the source of truth for both the local Cypress reset and
-- the staging host reset. Do not maintain a second table list anywhere.
--
-- Rules enforced by tests:
--   * exactly one BEGIN/COMMIT transaction
--   * bounded lock and statement timeouts
--   * one TRUNCATE listing only explicit application/test tables
--   * NO CASCADE (a new foreign key should fail this reset, not silently erase)
--   * NO RESTART IDENTITY (these tables use UUID primary keys)
--   * lookup/configuration tables such as *_permissions are preserved
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
TRUNCATE TABLE
  public.users,
  public.user_status,
  public.ig_posts,
  public.ig_bio,
  public.ig_followers,
  public.ig_hashtags,
  public.ig_mentions,
  public.ig_post_attachment_info,
  public.ig_post_comment_attachment_info,
  public.ig_post_comment_likes,
  public.ig_post_comment_text_content,
  public.ig_post_comments,
  public.ig_post_config,
  public.ig_post_likes,
  public.ig_post_text_content,
  public.ig_posts_roles,
  public.tds_todo_spaces,
  public.tds_todo_space_data,
  public.tds_todo_items,
  public.tds_todo_item_data,
  public.tds_todo_space_config,
  public.tds_todo_spaces_roles,
  public.d_storage_objects,
  public.d_storage_object_data,
  public.d_storage_object_config,
  public.d_storage_objects_roles,
  public.app_confirmation_challenges;
COMMIT;
