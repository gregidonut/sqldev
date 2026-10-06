package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type viewSpec struct {
	relation  string
	idColumn  string
	createRPC string
	updateRPC string
	create    []string
	update    []string
	requiredC []string
	requiredU []string
}

func viewSpecFor(name ViewName) (viewSpec, bool) {
	switch name {
	case IgPosts:
		return viewSpec{
			relation:  "ig_posts_view",
			idColumn:  "post_id",
			createRPC: "create_ig_post",
			updateRPC: "update_ig_post",
			create:    []string{"p_text_content", "p_public"},
			update:    []string{"p_post_id", "p_text_content"},
			requiredC: []string{"p_text_content"},
			requiredU: []string{"p_post_id", "p_text_content"},
		}, true
	case TdsTodoSpaces:
		return viewSpec{
			relation:  "tds_todo_spaces_view",
			idColumn:  "todo_space_id",
			createRPC: "create_tds_todo_space",
			updateRPC: "update_tds_todo_space",
			create:    []string{"p_name", "p_public"},
			update:    []string{"p_todo_space_id", "p_name"},
			requiredC: []string{"p_name"},
			requiredU: []string{"p_todo_space_id", "p_name"},
		}, true
	default:
		return viewSpec{}, false
	}
}

func (s *Server) ListView(ctx context.Context, request ListViewRequestObject) (ListViewResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return listViewFailure(err), nil
	}
	spec, ok := viewSpecFor(request.View)
	if !ok {
		return listViewFailure(errBadRequest), nil
	}
	raw, err := s.DB.List(ctx, token, spec.relation)
	if err != nil {
		return listViewFailure(err), nil
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return listViewFailure(err), nil
	}
	return ListView200JSONResponse(rows), nil
}

func (s *Server) GetViewItem(ctx context.Context, request GetViewItemRequestObject) (GetViewItemResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return getViewFailure(err), nil
	}
	spec, ok := viewSpecFor(request.View)
	if !ok {
		return getViewFailure(errBadRequest), nil
	}
	raw, err := s.DB.One(ctx, token, spec.relation, spec.idColumn, request.ItemId.String())
	if err != nil {
		return getViewFailure(err), nil
	}
	var row JsonObject
	if err := json.Unmarshal(raw, &row); err != nil {
		return getViewFailure(err), nil
	}
	return GetViewItem200JSONResponse(row), nil
}

func (s *Server) CreateViewItem(ctx context.Context, request CreateViewItemRequestObject) (CreateViewItemResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return createViewFailure(err), nil
	}
	spec, ok := viewSpecFor(request.View)
	if !ok {
		return createViewFailure(errBadRequest), nil
	}
	values, err := readForm(request.Body)
	if err != nil {
		return createViewFailure(err), nil
	}
	args, err := selectedArgs(values, spec.create)
	if err != nil {
		return createViewFailure(err), nil
	}
	if err := requireFields(args, spec.requiredC...); err != nil {
		return createViewFailure(err), nil
	}
	raw, err := s.DB.RPC(ctx, token, spec.createRPC, args)
	if err != nil {
		return createViewFailure(err), nil
	}
	if request.View == IgPosts {
		s.notifyPost(ctx, token, raw)
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return createViewFailure(err), nil
	}
	return CreateViewItem200JSONResponse(rows), nil
}

func (s *Server) UpdateViewItem(ctx context.Context, request UpdateViewItemRequestObject) (UpdateViewItemResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return updateViewFailure(err), nil
	}
	spec, ok := viewSpecFor(request.View)
	if !ok {
		return updateViewFailure(errBadRequest), nil
	}
	values, err := readForm(request.Body)
	if err != nil {
		return updateViewFailure(err), nil
	}
	args, err := selectedArgs(values, spec.update)
	if err != nil {
		return updateViewFailure(err), nil
	}
	if err := requireFields(args, spec.requiredU...); err != nil {
		return updateViewFailure(err), nil
	}
	raw, err := s.DB.RPC(ctx, token, spec.updateRPC, args)
	if err != nil {
		return updateViewFailure(err), nil
	}
	if request.View == IgPosts {
		s.notifyPost(ctx, token, raw)
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return updateViewFailure(err), nil
	}
	return UpdateViewItem200JSONResponse(rows), nil
}

func (s *Server) GetTodoTree(ctx context.Context, request GetTodoTreeRequestObject) (GetTodoTreeResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return todoTreeFailure(err), nil
	}
	raw, err := s.DB.RPC(ctx, token, "get_tds_todos_tree", map[string]any{
		"p_todo_space_id": request.TodoSpaceId.String(),
	})
	if err != nil {
		return todoTreeFailure(err), nil
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return todoTreeFailure(err), nil
	}
	return GetTodoTree200JSONResponse(rows), nil
}

func (s *Server) MoveTodoItems(ctx context.Context, request MoveTodoItemsRequestObject) (MoveTodoItemsResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return moveTodoFailure(err), nil
	}
	values, err := readForm(request.Body)
	if err != nil {
		return moveTodoFailure(err), nil
	}
	ids := values["p_todo_item_ids"]
	if len(ids) == 0 {
		return moveTodoFailure(fmt.Errorf("%w: p_todo_item_ids is required", errBadRequest)), nil
	}
	args := map[string]any{"p_todo_item_ids": ids}
	if parent := values.Get("p_new_parent_id"); parent != "" {
		args["p_new_parent_id"] = parent
	} else {
		args["p_new_parent_id"] = nil
	}
	raw, err := s.DB.RPC(ctx, token, "move_tds_todo_items", args)
	if err != nil {
		return moveTodoFailure(err), nil
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return moveTodoFailure(err), nil
	}
	return MoveTodoItems200JSONResponse(rows), nil
}

func (s *Server) CreateTodo(ctx context.Context, request CreateTodoRequestObject) (CreateTodoResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return createTodoFailure(err), nil
	}
	values, err := readForm(request.Body)
	if err != nil {
		return createTodoFailure(err), nil
	}
	args, err := selectedArgs(values, []string{"p_todo_space_id", "p_title", "p_description"})
	if err != nil {
		return createTodoFailure(err), nil
	}
	if _, ok := args["p_todo_space_id"]; !ok {
		args["p_todo_space_id"] = request.TodoSpaceId.String()
	}
	if err := requireFields(args, "p_todo_space_id", "p_title"); err != nil {
		return createTodoFailure(err), nil
	}
	raw, err := s.DB.RPC(ctx, token, "create_tds_todo", args)
	if err != nil {
		return createTodoFailure(err), nil
	}
	rows, err := decodeRows(raw)
	if err != nil {
		return createTodoFailure(err), nil
	}
	return CreateTodo200JSONResponse(rows), nil
}

func listViewFailure(err error) ListViewResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return ListView401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return ListView400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return ListView500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func getViewFailure(err error) GetViewItemResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return GetViewItem401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return GetViewItem400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	case http.StatusNotFound:
		return GetViewItem404JSONResponse{NotFoundJSONResponse: NotFoundJSONResponse{Message: message}}
	default:
		return GetViewItem500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func createViewFailure(err error) CreateViewItemResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return CreateViewItem401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return CreateViewItem403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return CreateViewItem400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return CreateViewItem500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func updateViewFailure(err error) UpdateViewItemResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return UpdateViewItem401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return UpdateViewItem403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return UpdateViewItem400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return UpdateViewItem500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func todoTreeFailure(err error) GetTodoTreeResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return GetTodoTree401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	default:
		return GetTodoTree500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func moveTodoFailure(err error) MoveTodoItemsResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return MoveTodoItems401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return MoveTodoItems403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return MoveTodoItems400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return MoveTodoItems500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func createTodoFailure(err error) CreateTodoResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return CreateTodo401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return CreateTodo403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return CreateTodo400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return CreateTodo500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}
