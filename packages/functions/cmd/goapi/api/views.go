package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
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
	if _, ok := viewSpecFor(request.View); !ok {
		return listViewFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindListView, map[string]any{"view": request.View}, "")
	if err != nil {
		return listViewFailure(err), nil
	}
	return ListView202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) GetViewItem(ctx context.Context, request GetViewItemRequestObject) (GetViewItemResponseObject, error) {
	if _, ok := viewSpecFor(request.View); !ok {
		return getViewFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindGetViewItem, map[string]any{
		"view":   request.View,
		"itemId": request.ItemId.String(),
	}, "")
	if err != nil {
		return getViewFailure(err), nil
	}
	return GetViewItem202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) CreateViewItem(ctx context.Context, request CreateViewItemRequestObject) (CreateViewItemResponseObject, error) {
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
	receipt, err := s.submit(ctx, jobs.KindCreateViewItem, map[string]any{"view": request.View, "args": args}, request.Params.IdempotencyKey)
	if err != nil {
		return createViewFailure(err), nil
	}
	return CreateViewItem202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) UpdateViewItem(ctx context.Context, request UpdateViewItemRequestObject) (UpdateViewItemResponseObject, error) {
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
	receipt, err := s.submit(ctx, jobs.KindUpdateViewItem, map[string]any{"view": request.View, "args": args}, request.Params.IdempotencyKey)
	if err != nil {
		return updateViewFailure(err), nil
	}
	return UpdateViewItem202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) GetTodoTree(ctx context.Context, request GetTodoTreeRequestObject) (GetTodoTreeResponseObject, error) {
	receipt, err := s.submit(ctx, jobs.KindGetTodoTree, map[string]any{
		"todoSpaceId": request.TodoSpaceId.String(),
	}, "")
	if err != nil {
		return todoTreeFailure(err), nil
	}
	return GetTodoTree202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) MoveTodoItems(ctx context.Context, request MoveTodoItemsRequestObject) (MoveTodoItemsResponseObject, error) {
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
	receipt, err := s.submit(ctx, jobs.KindMoveTodoItems, map[string]any{"args": args}, request.Params.IdempotencyKey)
	if err != nil {
		return moveTodoFailure(err), nil
	}
	return MoveTodoItems202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) CreateTodo(ctx context.Context, request CreateTodoRequestObject) (CreateTodoResponseObject, error) {
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
	receipt, err := s.submit(ctx, jobs.KindCreateTodo, map[string]any{
		"todoSpaceId": request.TodoSpaceId.String(),
		"args":        args,
	}, request.Params.IdempotencyKey)
	if err != nil {
		return createTodoFailure(err), nil
	}
	return CreateTodo202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
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
