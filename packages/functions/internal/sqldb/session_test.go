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
