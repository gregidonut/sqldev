package sqldb

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
)

type callKind int

const (
	returnsTable callKind = iota
	returnsScalar
	returnsVoid
)

type functionSpec struct {
	args []string
	kind callKind
	cast map[string]string
}

var functions = map[string]functionSpec{
	"create_ig_post":                {args: []string{"p_text_content", "p_public"}},
	"update_ig_post":                {args: []string{"p_post_id", "p_text_content"}},
	"create_tds_todo_space":         {args: []string{"p_name", "p_public"}},
	"update_tds_todo_space":         {args: []string{"p_todo_space_id", "p_name"}},
	"get_tds_todos_tree":            {args: []string{"p_todo_space_id"}, kind: returnsScalar},
	"move_tds_todo_items":           {args: []string{"p_todo_item_ids", "p_new_parent_id"}},
	"create_tds_todo":               {args: []string{"p_todo_space_id", "p_title", "p_description"}},
	"get_d_storage_objects":         {args: []string{"p_tab"}, cast: map[string]string{"p_tab": "public.d_storage_objects_tab"}},
	"prepare_d_storage_upload":      {args: []string{"p_file_name"}},
	"commit_d_storage_upload":       {args: []string{"p_storage_object_id", "p_storage_object_data_id", "p_file_name"}},
	"abort_d_storage_upload":        {args: []string{"p_storage_object_id", "p_is_new_object"}, kind: returnsVoid},
	"get_d_storage_object_by_key":   {args: []string{"p_s3_object_key"}},
	"authorize_d_storage_object":    {args: []string{"p_requested_user_id", "p_requested_permission", "p_requested_storage_object_id"}, kind: returnsScalar, cast: map[string]string{"p_requested_permission": "public.d_storage_objects_permission"}},
	"notify_ig_posts_view_for_post": {args: []string{"p_post_id"}, kind: returnsVoid},
}

var relations = map[string]string{
	"ig_posts_view":        "post_id",
	"tds_todo_spaces_view": "todo_space_id",
}

// Session runs the queued database work inside one DBOS transaction.
type Session struct {
	tx      dbos.Tx
	claims  jobs.Claims
	applied bool
}

func New(tx dbos.Tx, claims jobs.Claims) *Session {
	return &Session{tx: tx, claims: claims}
}

func (s *Session) RPC(ctx context.Context, _, name string, args any) (json.RawMessage, error) {
	if err := s.apply(ctx); err != nil {
		return nil, err
	}
	if name == "set_owner" {
		var raw []byte
		if err := s.tx.QueryRow(ctx, `SELECT to_json(public.set_owner())`).Scan(&raw); err != nil {
			return nil, err
		}
		return raw, nil
	}
	values, ok := args.(map[string]any)
	if !ok || values == nil {
		values = map[string]any{}
	}
	query, bound, err := functionSQL(name, values)
	if err != nil {
		return nil, err
	}
	spec := functions[name]
	if spec.kind == returnsVoid {
		if _, err := s.tx.Exec(ctx, query, bound...); err != nil {
			return nil, err
		}
		return json.RawMessage("null"), nil
	}
	var raw []byte
	if err := s.tx.QueryRow(ctx, query, bound...).Scan(&raw); err != nil {
		return nil, err
	}
	if raw == nil {
		return json.RawMessage("null"), nil
	}
	return raw, nil
}

func (s *Session) List(ctx context.Context, _, relation string) (json.RawMessage, error) {
	if err := s.apply(ctx); err != nil {
		return nil, err
	}
	query, err := listSQL(relation)
	if err != nil {
		return nil, err
	}
	var raw []byte
	if err := s.tx.QueryRow(ctx, query).Scan(&raw); err != nil {
		return nil, err
	}
	if raw == nil {
		return json.RawMessage("[]"), nil
	}
	return raw, nil
}

func (s *Session) One(ctx context.Context, _, relation, column, value string) (json.RawMessage, error) {
	if err := s.apply(ctx); err != nil {
		return nil, err
	}
	query, err := oneSQL(relation, column)
	if err != nil {
		return nil, err
	}
	var raw []byte
	if err := s.tx.QueryRow(ctx, query, value).Scan(&raw); err != nil {
		return nil, fmt.Errorf("query %s: %w", relation, err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("not found")
	}
	return raw, nil
}

func (s *Session) apply(ctx context.Context) error {
	if s.applied {
		return nil
	}
	raw, err := json.Marshal(map[string]string{
		"sub":  s.claims.Subject,
		"role": s.claims.Role,
	})
	if err != nil {
		return err
	}
	if _, err := s.tx.Exec(ctx, `SELECT set_config('request.jwt.claims', $1, true)`, string(raw)); err != nil {
		return err
	}
	if _, err := s.tx.Exec(ctx, `SET LOCAL ROLE authenticated`); err != nil {
		return err
	}
	s.applied = true
	return nil
}

// Restore drops the caller's role and claims before DBOS checkpoints the step
// in the same transaction; authenticated cannot write the dbos schema.
func (s *Session) Restore(ctx context.Context) error {
	if !s.applied {
		return nil
	}
	if _, err := s.tx.Exec(ctx, `SET LOCAL ROLE NONE`); err != nil {
		return err
	}
	if _, err := s.tx.Exec(ctx, `SELECT set_config('request.jwt.claims', '', true)`); err != nil {
		return err
	}
	s.applied = false
	return nil
}

func functionSQL(name string, args map[string]any) (string, []any, error) {
	spec, ok := functions[name]
	if !ok || !identifier(name) {
		return "", nil, fmt.Errorf("unknown database function")
	}
	assignments := make([]string, 0, len(spec.args))
	values := make([]any, 0, len(spec.args))
	for _, arg := range spec.args {
		value, exists := args[arg]
		if !exists || value == nil {
			continue
		}
		if !identifier(arg) {
			return "", nil, fmt.Errorf("invalid argument")
		}
		values = append(values, value)
		rendered := fmt.Sprintf("%s := $%d", arg, len(values))
		if cast := spec.cast[arg]; cast != "" {
			rendered += "::" + cast
		}
		assignments = append(assignments, rendered)
	}
	call := "public." + name + "()"
	if len(assignments) > 0 {
		call = "public." + name + "(" + strings.Join(assignments, ", ") + ")"
	}
	switch spec.kind {
	case returnsVoid:
		return "SELECT " + call, values, nil
	case returnsScalar:
		return "SELECT to_json(" + call + ")", values, nil
	default:
		// The subquery keeps column names for single-column RETURNS TABLE functions,
		// which would otherwise aggregate as bare scalars.
		return "SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM (SELECT * FROM " + call + ") AS t", values, nil
	}
}

func listSQL(relation string) (string, error) {
	if _, ok := relations[relation]; !ok || !identifier(relation) {
		return "", fmt.Errorf("unknown relation")
	}
	return "SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM public." + relation + " AS t", nil
}

func oneSQL(relation, column string) (string, error) {
	allowed, ok := relations[relation]
	if !ok || column != allowed || !identifier(relation) || !identifier(column) {
		return "", fmt.Errorf("unknown relation")
	}
	return "SELECT to_jsonb(t) FROM public." + relation + " AS t WHERE t." + column + " = $1", nil
}

func identifier(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return false
		}
	}
	return true
}
