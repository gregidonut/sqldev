package sqldb

import "testing"

func TestFunctionSQLUsesParameters(t *testing.T) {
	query, args, err := functionSQL("create_ig_post", map[string]any{
		"p_text_content": "hello",
		"p_public":       true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if query != "SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM (SELECT * FROM public.create_ig_post(p_text_content := $1, p_public := $2)) AS t" {
		t.Fatalf("query = %s", query)
	}
	if len(args) != 2 {
		t.Fatalf("args = %#v", args)
	}
}

func TestFunctionSQLRejectsUnknownFunction(t *testing.T) {
	if _, _, err := functionSQL("drop_table", map[string]any{}); err == nil {
		t.Fatal("expected an unknown function to be rejected")
	}
}

func TestOneSQLRejectsUnlistedColumn(t *testing.T) {
	if _, err := oneSQL("ig_posts_view", "clerk_user_id"); err == nil {
		t.Fatal("expected the column to be rejected")
	}
}

func TestVisibilityFunctionsAreAllowlistedAsScalars(t *testing.T) {
	const object = "5b1f7f0e-0c4a-4f7e-9a63-2f4f6a1d9b11"
	cases := []struct {
		name  string
		args  map[string]any
		query string
		count int
	}{
		{
			"begin_d_storage_make_public",
			map[string]any{"p_storage_object_id": object, "p_expected_revision": int64(3), "p_request_id": "r"},
			"SELECT to_json(public.begin_d_storage_make_public(p_storage_object_id := $1, p_expected_revision := $2, p_request_id := $3))", 3,
		},
		{
			"make_d_storage_object_private",
			map[string]any{"p_storage_object_id": object, "p_expected_revision": int64(3), "p_request_id": "r"},
			"SELECT to_json(public.make_d_storage_object_private(p_storage_object_id := $1, p_expected_revision := $2, p_request_id := $3))", 3,
		},
		{
			"confirm_app_operation",
			map[string]any{
				"p_challenge_id": "c", "p_operation_kind": "k", "p_target_type": "t", "p_target_id": object,
				"p_expected_revision": int64(3), "p_proof": "p", "p_request_id": "r",
			},
			"SELECT to_json(public.confirm_app_operation(p_challenge_id := $1, p_operation_kind := $2, p_target_type := $3, p_target_id := $4, p_expected_revision := $5, p_proof := $6, p_request_id := $7))", 7,
		},
	}
	for _, c := range cases {
		query, args, err := functionSQL(c.name, c.args)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if query != c.query || len(args) != c.count {
			t.Errorf("%s:\n  query = %s\n  want  = %s\n  args  = %d", c.name, query, c.query, len(args))
		}
	}
}

func TestInternalConfirmationFunctionsAreNotCallable(t *testing.T) {
	for _, name := range []string{
		"app_confirmation_issue", "app_confirmation_classify", "app_confirmation_consume", "app_confirmation_lock",
		"app_confirmation_cleanup", "app_confirmation_proof_verifier", "d_storage_visibility_guard",
		"d_storage_apply_make_public", "d_storage_object_current_config",
		"app_confirmation_resolve_dialog_copy", "app_confirmation_text_is_blank",
	} {
		if _, _, err := functionSQL(name, map[string]any{}); err == nil {
			t.Errorf("%s must not be reachable through the job worker", name)
		}
	}
}
